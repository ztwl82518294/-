/**
 * 通用工具函数 —— 小程序端与后台端共用
 *
 * 这里的函数是整个项目的地基：线路主键（routeKey）、时间展示（相对时间）、
 * 金额/文本归一都靠它。改动前先确认所有调用方。
 */

/* ============================================================
 * 文本归一
 * ============================================================ */

/**
 * 城市名归一：去掉「市 / 区 / 县 / 省」后缀，统一为短名。
 * 用于 routeKey 构造与城市比对，保证「济南市」与「济南」视为同一城市。
 */
function normCity(name) {
  return String(name || '')
    .trim()
    .replace(/[省市区县]$/g, '');
}

/**
 * 通用文本归一：去空白、全角转半角、统一大小写。
 * 用于公司名模糊搜索。
 */
function normText(s) {
  return String(s || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .toLowerCase();
}

/**
 * ★ 线路主键：`出发城市-到达城市`（双向唯一标识）。
 *
 * 这是 routes 表的去重依据，也是 route_companies 的冗余索引。
 * 注意：构造前必须过 normCity，否则「济南市-广州市」与「济南-广州」会变成两条线路。
 */
function buildRouteKey(fromCity, toCity) {
  const a = normCity(fromCity);
  const b = normCity(toCity);
  if (!a || !b) return '';
  return a + '-' + b;
}

/** routeKey 反解 → { fromCity, toCity } */
function parseRouteKey(key) {
  const parts = String(key || '').split('-');
  if (parts.length !== 2) return { fromCity: '', toCity: '' };
  return { fromCity: parts[0], toCity: parts[1] };
}

/* ============================================================
 * 线路名展示
 * ============================================================ */

/** 线路展示名：`济南 → 广州` */
function routeTitle(fromCity, toCity) {
  const a = normCity(fromCity);
  const b = normCity(toCity);
  if (!a || !b) return '';
  return a + ' → ' + b;
}

/** 线路全称（含省）：`山东省济南 → 广东省广州` */
function routeFullTitle(fromProvince, fromCity, toProvince, toCity) {
  const a = [normCity(fromProvince), normCity(fromCity)].filter(Boolean).join('');
  const b = [normCity(toProvince), normCity(toCity)].filter(Boolean).join('');
  if (!a || !b) return '';
  return a + ' → ' + b;
}

/* ============================================================
 * 时间处理
 * ============================================================ */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * ★ 相对时间文案：把 updatedAt 转成「3天前更新」。
 *
 * 这是 PRD 贯穿性要求第 2 条（数据更新时间标注）与验收 A8 的实现。
 * 口径：
 *   - 缺失 / 非法    → ''（调用方条件渲染，不显示占位）
 *   - < 1 分钟       → 刚刚更新
 *   - < 1 小时       → N分钟前更新
 *   - < 1 天         → N小时前更新
 *   - < 30 天        → N天前更新
 *   - < 12 个月      → N个月前更新
 *   - 其它           → N年前更新
 *   - 未来时间（时钟偏差或脏数据）→ 按「刚刚更新」处理，不显示负数
 */
function relativeTime(ts, now) {
  const t = Number(ts);
  if (!t || !isFinite(t) || t <= 0) return '';
  const base = Number(now) || Date.now();
  const diff = base - t;
  if (diff < 60 * 1000) return '刚刚更新';

  const min = Math.floor(diff / (60 * 1000));
  if (min < 60) return min + '分钟前更新';

  const hour = Math.floor(diff / (60 * 60 * 1000));
  if (hour < 24) return hour + '小时前更新';

  const day = Math.floor(diff / DAY_MS);
  if (day < 30) return day + '天前更新';

  const month = Math.floor(day / 30);
  if (month < 12) return month + '个月前更新';

  return Math.floor(day / 365) + '年前更新';
}

/** 是否超过 N 天未更新（数据质量看板用） */
function isStale(ts, days, now) {
  const t = Number(ts);
  if (!t || !isFinite(t)) return true; // 没有时间的算陈旧
  const base = Number(now) || Date.now();
  return base - t > (Number(days) || 90) * DAY_MS;
}

/** 时间戳 → `2026-09-19` */
function formatDate(ts) {
  const t = Number(ts);
  if (!t || !isFinite(t)) return '';
  const d = new Date(t);
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/* ============================================================
 * 电话号码处理
 * ============================================================ */

const PHONE_SPLIT = /[,，、;；/\s]+/;

/**
 * 号码串 → 数组（去空、去重、保序）。
 * 保持录入顺序，不做排序 —— 用户报障明确要求「电话不需要排序」。
 */
function splitPhones(v) {
  if (!v) return [];
    const raw = Array.isArray(v) ? v : String(v).split(PHONE_SPLIT);
    const seen = new Set();
    const out = [];
    /*
     * ★ 不用 `for (const x of raw)`：小程序端开了「增强编译」走 SWC，
     *   for...of 可能编译成对 @swc/runtime 辅助模块的 require，
     *   本环境没装 ⇒ 直接报错白屏。用下标循环最稳（见 pages/index/index.js 的注释）。
     */
    for (let i = 0; i < raw.length; i++) {
      const t = String(raw[i] || '').trim();
      if (!t || seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
    return out;
}

/** 号码是否像电话号码（纯数字/加号/横杠/括号，且位数够） */
function isPhoneLike(s) {
  const t = String(s || '').trim();
  if (!t) return false;
  if (!/^[0-9+\-()（）\s]+$/.test(t)) return false;
  return t.replace(/\D/g, '').length >= 7;
}

/* ============================================================
 * 站点（发站 / 到站）处理
 * ============================================================ */

/**
 * 站点归一：统一为 `[{ address, phone }]`。
 *
 * 兼容三种历史形态（导入数据来源不一，必须都能吃）：
 *   1. 对象数组  [{ address, phone }] 或 [{ addr, phone }]   ← 标准形态
 *   2. 字符串数组 ['地址 | 电话1,电话2', ...]                 ← 表格粘贴
 *   3. 整段字符串 '地址1 | 电话\n地址2 | 电话'                ← 直接贴一大段
 *
 * 只有电话没有地址时，address 留空 —— 前端据此不渲染地址行
 * （不显示「地址未填写」占位，站点编号仍保留）。
 */
const ROW_SPLIT = /[\r\n;；]+/;
const CELL_SPLIT = /[|｜\t]+/;

function parseStationRow(s) {
  const text = String(s || '').trim();
  if (!text) return { address: '', phone: '' };
  const parts = text.split(CELL_SPLIT).map((x) => x.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return { address: parts[0], phone: parts.slice(1).join(',') };
  }
  const one = parts[0] || '';
  return isPhoneLike(one) ? { address: '', phone: one } : { address: one, phone: '' };
}

function parseStations(v) {
  if (!v) return [];
  if (Array.isArray(v)) {
    return v
      .map((x) => {
        if (x && typeof x === 'object') {
          return {
            address: String(x.address || x.addr || '').trim(),
            phone: String(x.phone || x.tel || '').trim()
          };
        }
        return parseStationRow(x);
      })
      .filter((r) => r.address || r.phone);
  }
  return String(v).split(ROW_SPLIT).map(parseStationRow).filter((r) => r.address || r.phone);
}

/* ============================================================
 * 枚举展示
 * ============================================================ */

const SCALE_LABELS = { small: '小型', medium: '中型', large: '大型' };
const FREQUENCY_LABELS = {
  daily: '天天发车',
  weekday: '工作日发车',
  weekly: '每周发车',
  irregular: '不固定'
};

/** 规模文案，未知值返回空串（调用方条件渲染） */
function scaleLabel(v) {
  return SCALE_LABELS[v] || '';
}

/** 发车频率文案，未知值返回空串 */
function frequencyLabel(v) {
  return FREQUENCY_LABELS[v] || '';
}

/**
 * 时效文案：数字天 → `2天`
 * 支持 `2` / `2天` / `24小时` 等形态，非数字原样返回。
 */
function transitLabel(v) {
  if (v === 0) return '当天';
  if (v === null || v === undefined || v === '') return '';
  const s = String(v).trim();
  const n = Number(s.replace(/[^\d.]/g, ''));
  if (!s || !isFinite(n)) return s;
  if (/天/.test(s)) return s;
  if (/小时|时/.test(s)) return s;
  if (n === 0) return '当天';
  return n + '天';
}

/* ============================================================
 * 其它
 * ============================================================ */

/** 数组安全取值 */
function first(arr, def) {
  return Array.isArray(arr) && arr.length ? arr[0] : def;
}

/** 判断是否非空字符串 */
function hasText(v) {
  return typeof v === 'string' ? v.trim().length > 0 : v !== null && v !== undefined && v !== '';
}

/** 深拷贝（纯 JSON，数据来自云库，无需处理 Date/RegExp） */
function clone(o) {
  return o === null || o === undefined ? o : JSON.parse(JSON.stringify(o));
}

module.exports = {
  normCity,
  normText,
  buildRouteKey,
  parseRouteKey,
  routeTitle,
  routeFullTitle,
  relativeTime,
  isStale,
  formatDate,
  splitPhones,
  isPhoneLike,
  parseStationRow,
  parseStations,
  scaleLabel,
  frequencyLabel,
  transitLabel,
  first,
  hasText,
  clone,
  DAY_MS,
  PHONE_SPLIT
};
