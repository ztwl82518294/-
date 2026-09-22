/**
 * shared/import.js —— 跨端共用的「批量导入」解析与行校验
 *
 * ★ 为什么抽出来：桌面后台（admin/lib/importer.js）与云函数 adminApi 都要做
 *   「CSV 文本 → 内部字段 → 逐行校验 → 预览」。若各写一套，会出现同一个文件
 *   在电脑上能导入、在手机上报错（或反之）这种最难排查的问题。
 *
 * ★ 本模块**只做纯计算**：字符串进、对象出，不碰文件、不碰数据库。
 *   xlsx 解析（zip + inflate）留在 admin/lib/importer.js —— 那是 Node 侧的事，
 *   云函数里用不到（小程序端只能拿到文本文件）。
 */

const common = require('../utils/common');
const schema = require('./schema');

/* ============================================================
 * 字段映射
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

/**
 * 按映射把二维数组转成内部字段对象
 * @param {string[]} headers
 * @param {Array<Array<string>>} rows
 * @param {string[]} [mapping] 与 headers 等长，值为内部字段名或 ''（忽略该列）
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

/** CSV 文本 → 内部字段对象数组（自动识别表头） */
function parseCsvToRows(text) {
  const grid = parseCsv(text);
  if (grid.length < 2) return { headers: grid.length ? grid[0] : [], rows: [] };
  const headers = grid[0].map((h) => String(h || '').trim());
  return { headers: headers, mapping: autoMap(headers), rows: mapRows(headers, grid.slice(1)) };
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

/* ============================================================
 * 行校验（导入预览）
 * ============================================================ */

const FREQUENCY_VALUES = schema.FREQUENCY_OPTIONS.map((o) => o.value);

/**
 * 校验一批「公司+线路」扁平行，返回错误预览（不写任何数据）
 *
 * ★ 为什么先校验再导入：PRD B3 要求「明确标出错误行与原因，拒绝或跳过，
 *   不污染数据库」。所以导入是两阶段：preview → confirm。
 *
 * @param {Array<object>} rows 已按字段映射转成内部字段名的行
 * @param {object} [ctx] { companies, routes } —— 只用于统计「新公司 / 新线路」数量，
 *                       不传则该统计为 0（校验结果不受影响）
 * @returns {{valid:Array, invalid:Array, summary:object}}
 */
function validateImportRows(rows, ctx) {
  const list = Array.isArray(rows) ? rows : [];
  const valid = [];
  const invalid = [];
  const seenCompany = {};   // 同一文件内公司名去重
  const seenPair = {};      // 同一文件内「公司@线路」去重
  const companies = (ctx && ctx.companies) || [];
  const routes = (ctx && ctx.routes) || [];

  list.forEach((row, i) => {
    const lineNo = i + 2;   // 第 1 行是表头，数据从第 2 行起
    const errs = [];

    const name = String(row.name || '').trim();
    const fromCity = String(row.fromCity || '').trim();
    const toCity = String(row.toCity || '').trim();
    const phone = String(row.phone || '').trim();
    const frequency = String(row.frequency || '').trim();

    if (!name) errs.push('公司全称缺失');
    if (!fromCity) errs.push('出发城市缺失');
    if (!toCity) errs.push('到达城市缺失');
    if (fromCity && toCity && common.normCity(fromCity) === common.normCity(toCity)) {
      errs.push('出发与到达是同一城市');
    }
    if (phone && !common.isPhoneLike(phone)) {
      errs.push('电话格式不正确（' + phone + '）');
    }
    if (row.transitDays !== '' && row.transitDays !== null && row.transitDays !== undefined) {
      const d = Number(row.transitDays);
      if (!isFinite(d) || d < 0 || d > 60) errs.push('时效不合法（' + row.transitDays + '）');
    }
    // 频率：空值允许（视为未知），但填了就必须在枚举内
    if (frequency && FREQUENCY_VALUES.indexOf(frequency) < 0) {
      errs.push('发车频率取值不合法（' + frequency + '）');
    }

    const routeKey = common.buildRouteKey(fromCity, toCity);
    const pairKey = name + '@' + routeKey;
    if (name && routeKey && seenPair[pairKey]) {
      errs.push('与第 ' + seenPair[pairKey] + ' 行重复（同公司同线路）');
    }

    if (errs.length) {
      invalid.push({ lineNo: lineNo, row: row, errors: errs });
      return;
    }

    if (!seenPair[pairKey]) seenPair[pairKey] = lineNo;
    if (!seenCompany[name]) seenCompany[name] = lineNo;
    valid.push({ lineNo: lineNo, row: row, routeKey: routeKey });
  });

  const names = Object.keys(seenCompany);
  const validKeys = {};
  valid.forEach((v) => { validKeys[v.routeKey] = true; });

  return {
    valid: valid,
    invalid: invalid,
    summary: {
      total: list.length,
      validCount: valid.length,
      invalidCount: invalid.length,
      newCompanies: names.filter((n) => !companies.some((c) => c.name === n)).length,
      existingCompanies: names.filter((n) => companies.some((c) => c.name === n)).length,
      newRoutes: Object.keys(validKeys).filter((k) => !routes.some((r) => r.routeKey === k)).length
    }
  };
}

module.exports = {
  FIELD_LABELS,
  HEADER_ALIASES,
  guessField,
  autoMap,
  parseCsv,
  mapRows,
  parseCsvToRows,
  templateCsv,
  toBool,
  toFrequency,
  toNumber,
  validateImportRows
};
