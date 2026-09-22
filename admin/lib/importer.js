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

/* ============================================================
 * 字段映射（PRD B2：显示字段映射界面）
 * ============================================================ */

/**
 * 内部字段 → 中文标签
 * 顺序即导入模板的推荐列顺序。
 */
const FIELD_LABELS = [
  { key: 'name', label: '公司全称', required: true, hint: '必填，用于公司去重' },
  { key: 'shortName', label: '公司简称', required: false, hint: '搜索用' },
  { key: 'pinyin', label: '拼音全拼', required: false, hint: '如 jinanlutong' },
  { key: 'initial', label: '首字母', required: false, hint: '如 jnlt' },
  { key: 'phone', label: '主电话', required: true, hint: '必填，支持座机/手机/400' },
  { key: 'backupPhone', label: '备用电话', required: false },
  { key: 'address', label: '公司地址', required: false },
  { key: 'city', label: '所在城市', required: false, hint: '留空则用出发城市' },
  { key: 'province', label: '所在省份', required: false },
  { key: 'scale', label: '规模', required: false, hint: 'large / medium / small' },
  { key: 'intro', label: '公司简介', required: false },
  { key: 'verified', label: '是否已核实', required: false, hint: '填 true/false' },
  { key: 'fromCity', label: '出发城市', required: true },
  { key: 'fromProvince', label: '出发省份', required: false },
  { key: 'toCity', label: '到达城市', required: true },
  { key: 'toProvince', label: '到达省份', required: false },
  { key: 'transitDays', label: '时效（天）', required: false, hint: '数字，留空表示未知' },
  { key: 'isDirect', label: '是否直达', required: false, hint: '填 true/false' },
  { key: 'frequency', label: '发车频率', required: false, hint: 'daily / weekday / weekly / irregular' }
];

/** 表头文字 → 内部字段名的别名表（容忍运营写自然语言表头） */
const HEADER_ALIASES = {};
FIELD_LABELS.forEach((f) => {
  HEADER_ALIASES[f.label] = f.key;
  HEADER_ALIASES[f.key] = f.key;
  HEADER_ALIASES[f.key.toLowerCase()] = f.key;
});

// 常见写法补充
const EXTRA_ALIASES = {
  '公司名称': 'name',
  '公司名': 'name',
  '名称': 'name',
  '简称': 'shortName',
  '全拼': 'pinyin',
  '电话': 'phone',
  '联系电话': 'phone',
  '手机': 'phone',
  '备用电话': 'backupPhone',
  '第二电话': 'backupPhone',
  '地址': 'address',
  '详细地址': 'address',
  '城市': 'city',
  '省份': 'province',
  '省': 'province',
  '规模': 'scale',
  '简介': 'intro',
  '介绍': 'intro',
  '已核实': 'verified',
  '核实': 'verified',
  '出发地': 'fromCity',
  '发货城市': 'fromCity',
  '起点': 'fromCity',
  '目的地': 'toCity',
  '到达地': 'toCity',
  '收货城市': 'toCity',
  '终点': 'toCity',
  '时效': 'transitDays',
  '天数': 'transitDays',
  '运输天数': 'transitDays',
  '直达': 'isDirect',
  '是否直达': 'isDirect',
  '频率': 'frequency',
  '发车': 'frequency'
};
Object.keys(EXTRA_ALIASES).forEach((k) => { HEADER_ALIASES[k] = EXTRA_ALIASES[k]; });

/** 猜表头 → 字段名（找不到返回 ''） */
function guessField(header) {
  const h = String(header || '').trim();
  if (!h) return '';
  if (HEADER_ALIASES[h]) return HEADER_ALIASES[h];
  // 去掉括号注释再试一次：「时效（天）」→「时效」
  const stripped = h.replace(/[（(].*?[）)]/g, '').trim();
  if (HEADER_ALIASES[stripped]) return HEADER_ALIASES[stripped];
  return '';
}

/** 按表头自动生成映射建议 */
function autoMap(headers) {
  return headers.map((h) => guessField(h));
}

/* ============================================================
 * 值归一
 * ============================================================ */

const TRUE_WORDS = ['true', '是', 'y', 'yes', '1', '√', '对', '有'];
const FALSE_WORDS = ['false', '否', 'n', 'no', '0', '×', 'x', '无', '没有'];

function toBool(v) {
  const s = String(v === null || v === undefined ? '' : v).trim().toLowerCase();
  if (TRUE_WORDS.indexOf(s) >= 0) return true;
  if (FALSE_WORDS.indexOf(s) >= 0) return false;
  return null;   // 无法判断，交给业务校验
}

/** 频率：容忍中文写法 */
function toFrequency(v) {
  const s = String(v === null || v === undefined ? '' : v).trim().toLowerCase();
  if (!s) return '';
  if (/^(daily|每天|天天|每日|天天发车|每天发车)$/.test(s)) return 'daily';
  if (/^(weekday|工作日|周一到周五|周一至周五)$/.test(s)) return 'weekday';
  if (/^(weekly|每周|周一|每周一|一周一次)$/.test(s)) return 'weekly';
  if (/^(irregular|不定期|不固定|随时|滚动发车)$/.test(s)) return 'irregular';
  return s;   // 未知取值原样返回，由业务校验报错
}

/** 数字：空 → null，非数字原样保留（由业务校验报错） */
function toNumber(v) {
  const s = String(v === null || v === undefined ? '' : v).trim();
  if (!s) return null;
  const n = Number(s.replace(/[天日]/g, ''));
  return isFinite(n) ? n : s;
}

/* ============================================================
 * CSV 解析
 * ============================================================ */

/**
 * 解析 CSV 文本为二维数组
 * ★ 手写状态机而不是 split(',')：因为字段里可能含逗号（地址很常见），
 *   那时整个字段会被引号包起来，split 会把一行拆散。
 */
function parseCsv(text) {
  const src = String(text || '').replace(/^\uFEFF/, '');   // 去 BOM
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;

  while (i < src.length) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 2; continue; }  // 转义的双引号
        inQuotes = false; i++; continue;
      }
      cell += ch; i++; continue;
    }

    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { row.push(cell); cell = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = []; cell = ''; i++; continue;
    }
    cell += ch; i++;
  }

  // 收尾：最后一行没换行也算
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

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

/**
 * 按映射把二维行转成内部字段对象
 * @param {string[]} headers
 * @param {Array<Array<string>>} rows
 * @param {string[]} mapping 与 headers 等长，值为内部字段名或 ''（忽略该列）
 * @returns {Array<object>}
 */
function mapRows(headers, rows, mapping) {
  const map = Array.isArray(mapping) && mapping.length ? mapping : autoMap(headers);

  return rows.map((r) => {
    const obj = {};
    headers.forEach((_, i) => {
      const field = map[i];
      if (!field) return;
      const raw = r[i] === undefined ? '' : r[i];
      obj[field] = String(raw === null || raw === undefined ? '' : raw).trim();
    });

    // 类型归一（在业务校验之前做，让错误预览更准）
    if ('transitDays' in obj) obj.transitDays = toNumber(obj.transitDays);
    if ('isDirect' in obj) {
      const b = toBool(obj.isDirect);
      obj.isDirect = b === null ? false : b;
    }
    if ('verified' in obj) {
      const b = toBool(obj.verified);
      obj.verified = b === null ? false : b;
    }
    if ('frequency' in obj) obj.frequency = toFrequency(obj.frequency);
    if (obj.scale) {
      const s = String(obj.scale).trim().toLowerCase();
      obj.scale = ['large', 'medium', 'small'].indexOf(s) >= 0 ? s : 'small';
    }
    return obj;
  });
}

/** 生成导入模板（CSV，带表头与一行示例） */
function templateCsv() {
  const headers = FIELD_LABELS.map((f) => f.label);
  const example = [
    '示例物流有限公司', '示例物流', 'shiliwuliu', 'slwl',
    '0531-88880000', '13800000000', '济南市天桥区示例物流园 1 号',
    '济南', '山东省', 'medium', '示例简介', 'true',
    '济南', '山东省', '广州', '广东省', '2', 'true', 'daily'
  ];
  const esc = (v) => {
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return '\uFEFF' + headers.map(esc).join(',') + '\n' + example.map(esc).join(',') + '\n';
}

module.exports = {
  FIELD_LABELS, HEADER_ALIASES, guessField, autoMap,
  parse, parseCsv, parseSheet, parseSharedStrings, unzipEntry,
  mapRows, templateCsv,
  toBool, toFrequency, toNumber
};
