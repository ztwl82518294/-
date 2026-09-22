/**
 * admin/lib/importer.js —— Excel / CSV 导入（PRD 模块 06 + 验收 B2 / B3 / C1）
 *
 * ★ 零依赖读取 XLSX：.xlsx 本质是个 zip，里面 sheet1.xml 存单元格。
 *   我们只需要「读出二维字符串表」这一件事，用 zlib.inflateRawSync 手动解
 *   zip 的 deflate 流即可 —— 不需要引入 xlsx / exceljs。
 *   代价是不支持 .xls（老二进制格式）与公式计算，但导入模板本就该是纯值。
 *
 * ★ 两阶段导入（PRD B3 的核心）：
 *     阶段 1 parse()    → 读出原始二维表（不认识业务）
 *     阶段 2 mapRows()  → 按字段映射转成内部字段名（不认识业务对错）
 *     阶段 3 preview()  → 交给 store.validateImportRows 做业务校验
 *   这样「错误预览」看到的错因是真正的业务规则（缺电话、格式错、重复），
 *   而不是「解析失败」这种技术噪音。
 */

const zlib = require('zlib');
const path = require('path');

/**
 * ★ 字段映射 / 值归一 / CSV 解析 / 行校验 全部委托给 shared/import.js
 *   —— 云函数 adminApi 用的是同一份实现。以前这些写在本文件里，小程序端后台
 *   若要再写一套，就会出现「同一个文件在电脑上能导入、在手机上报错」这种
 *   最难排查的口径漂移。本文件只保留 Node 侧独有的 xlsx 解析。
 */
const sharedImport = require('../../shared/import');

const FIELD_LABELS = sharedImport.FIELD_LABELS;
const HEADER_ALIASES = sharedImport.HEADER_ALIASES;
const guessField = sharedImport.guessField;
const autoMap = sharedImport.autoMap;
const parseCsv = sharedImport.parseCsv;
const mapRows = sharedImport.mapRows;
const templateCsv = sharedImport.templateCsv;
const toBool = sharedImport.toBool;
const toFrequency = sharedImport.toFrequency;
const toNumber = sharedImport.toNumber;

/* ============================================================
 * XLSX 解析（零依赖）
 * ============================================================ */

/**
 * 从 zip 里取出指定文件的内容
 * ★ 只实现「读」，且只认 store 方式（deflate）；xlsx 由 Excel 生成时几乎都是这种。
 *   用中央目录定位而不是从本地头顺序扫 —— 局部头可能带 data descriptor
 *   使长度字段为 0，那样会读错。
 */
function unzipEntry(buf, wantName) {
  // 1. 找 End of Central Directory（EOCD）
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 xlsx（找不到 zip 结束标记）');

  const entryCount = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);

  for (let n = 0; n < entryCount; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;   // 中央目录签名
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.slice(off + 46, off + 46 + nameLen).toString('utf8');

    if (name === wantName) {
      // 读局部头，拿到「文件名/扩展字段」长度才能定位实际数据
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const data = buf.slice(dataStart, dataStart + compSize);
      if (method === 0) return data.toString('utf8');
      if (method === 8) return zlib.inflateRawSync(data).toString('utf8');
      throw new Error('不支持的压缩方式：' + method);
    }

    off += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

/** 解析 xl/sharedStrings.xml，得到共享字符串数组 */
function parseSharedStrings(xml) {
  if (!xml) return [];
  const out = [];
  // <si> 里可能是 <t>文字</t>，也可能被 <r> 切成多段
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = siRe.exec(xml))) {
    const inner = m[1];
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let t;
    let text = '';
    while ((t = tRe.exec(inner))) text += t[1];
    out.push(decodeXml(text));
  }
  return out;
}

function decodeXml(s) {
  return String(s || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

/** A1 → [row, col]（0 基） */
function refToPos(ref) {
  const m = String(ref).match(/^([A-Z]+)(\d+)$/);
  if (!m) return null;
  const col = m[1].split('').reduce((a, c) => a * 26 + (c.charCodeAt(0) - 64), 0) - 1;
  return [Number(m[2]) - 1, col];
}

/**
 * 解析 sheet xml 为二维数组
 * @param {string} xml sheet1.xml 内容
 * @param {string[]} shared sharedStrings
 * @param {number} maxCols 上限（防恶意表格撑爆内存）
 */
function parseSheet(xml, shared, maxCols) {
  const cols = maxCols || 60;
  const rows = [];
  const rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;
  let rm;

  while ((rm = rowRe.exec(xml))) {
    const rowAttr = rm[1];
    const inner = rm[2];
    const rIdx = Number((rowAttr.match(/\br="(\d+)"/) || [])[1]);
    const rowNo = isFinite(rIdx) && rIdx > 0 ? rIdx - 1 : rows.length;
    const arr = [];

    const cellRe = /<c\b([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g;
    let cm;
    let cursor = 0;
    while ((cm = cellRe.exec(inner))) {
      const attrs = cm[1];
      const body = cm[3] || '';
      const refM = attrs.match(/\br="([A-Z]+\d+)"/);
      let col = cursor;
      if (refM) {
        const pos = refToPos(refM[1]);
        if (pos) col = pos[1];
      }
      cursor = col + 1;
      if (col >= cols) continue;

      const type = (attrs.match(/\bt="([^"]+)"/) || [])[1] || '';
      let val = '';

      if (type === 'inlineStr') {
        const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
        let t;
        while ((t = tRe.exec(body))) val += t[1];
        val = decodeXml(val);
      } else {
        const vM = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
        const raw = vM ? vM[1] : '';
        if (type === 's') {
          val = shared[Number(raw)] !== undefined ? shared[Number(raw)] : '';
        } else if (type === 'b') {
          val = raw === '1' ? 'true' : 'false';
        } else {
          val = decodeXml(raw);
        }
      }
      arr[col] = val;
    }

    // 补齐空洞
    for (let i = 0; i < arr.length; i++) if (arr[i] === undefined) arr[i] = '';
    rows[rowNo] = arr;
  }

  // 去掉中间的空行（稀疏数组）
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]) out.push(rows[i]);
    else if (out.length) out.push([]);   // 保留尾部空行位置，便于报行号
  }
  return out.filter((r) => r.some((c) => String(c).trim() !== ''));
}

/* ============================================================
 * 统一入口
 * ============================================================ */

/**
 * 解析上传的文件为二维表
 * @param {Buffer} buf
 * @param {string} filename 用于按扩展名分流
 * @returns {{headers:string[], rows:Array<Array<string>>, format:string}}
 */
function parse(buf, filename) {
  const name = String(filename || '').toLowerCase();

  if (name.endsWith('.csv') || name.endsWith('.txt')) {
    const text = buf.toString('utf8');
    const table = parseCsv(text);
    if (!table.length) return { headers: [], rows: [], format: 'csv' };
    const headers = table[0].map((h) => String(h).trim());
    return { headers: headers, rows: table.slice(1), format: 'csv' };
  }

  if (name.endsWith('.xlsx')) {
    const sharedXml = unzipEntry(buf, 'xl/sharedStrings.xml');
    const sheetXml = unzipEntry(buf, 'xl/worksheets/sheet1.xml');
    if (sheetXml === null) throw new Error('xlsx 里找不到第一个工作表');
    const table = parseSheet(sheetXml, parseSharedStrings(sharedXml), 60);
    if (!table.length) return { headers: [], rows: [], format: 'xlsx' };
    const headers = table[0].map((h) => String(h).trim());
    return { headers: headers, rows: table.slice(1), format: 'xlsx' };
  }

  if (name.endsWith('.xls')) {
    throw new Error('不支持 .xls 老格式，请在 Excel 里另存为 .xlsx 或 .csv');
  }

  throw new Error('只支持 .xlsx 与 .csv 文件');
}

module.exports = {
  FIELD_LABELS, HEADER_ALIASES, guessField, autoMap,
  parse, parseCsv, parseSheet, parseSharedStrings, unzipEntry,
  mapRows, templateCsv,
  toBool, toFrequency, toNumber
};
