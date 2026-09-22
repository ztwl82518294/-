/**
 * 搜索与匹配（小程序端本地匹配 + 云端结果归一）
 *
 * 为什么要有这一层：
 *   云数据库的 where 只支持精确匹配与简单正则，做不了「简称 / 全拼 / 首字母 /
 *   错别字容错」这类模糊匹配。所以策略是：
 *     - 云端只做粗筛（拿一批候选）
 *     - 本地做精排（用本文件的打分函数排序）
 *   这样既省请求又保证排序符合直觉。
 *
 * ★ 匹配口径必须与后台端 admin/lib/validate.js 保持一致，
 *   否则同一关键词在小程序与后台搜出的结果会不同。
 */

const common = require('./common');

/* ============================================================
 * 公司名匹配
 * ============================================================ */

/**
 * 公司匹配打分（分数越高越靠前，0 表示不匹配）
 *
 * 匹配维度（按优先级，先命中先返回）：
 *   100 全称完全相等
 *    95 简称完全相等
 *    90 全称以关键词开头
 *    85 简称以关键词开头
 *    —— 以下仅当关键词长度 ≥ 2 ——
 *    80 全称包含关键词
 *    75 简称包含关键词
 *    70 拼音以关键词开头
 *    65 拼音包含关键词
 *    60 首字母命中（前缀或包含）
 *    ★ 输入长度为 1 时，只允许精确/前缀命中，不做包含 ——
 *      否则「南」会命中几百家公司。单字分支到此结束，不再往下走。
 *
 * @param {object} company
 * @param {string} kw 原始关键词
 */
function scoreCompany(company, kw) {
  if (!company) return 0;
  const raw = String(kw || '').trim();
  if (!raw) return 0;

  const q = common.normText(raw);
  if (!q) return 0;

  const name = common.normText(company.name);
  const short = common.normText(company.shortName);
  const pinyin = common.normText(company.pinyin);
  const initial = common.normText(company.initial);

  if (name === q) return 100;
  if (short && short === q) return 95;
  if (name.indexOf(q) === 0) return 90;
  if (short && short.indexOf(q) === 0) return 85;

  // ★ 单字只做「前缀」，一律不做「包含」——否则「南」会命中几百家。
  //   单字时拼音/首字母同样只认前缀，且到此为止直接返回。
  if (q.length < 2) {
    if (pinyin.indexOf(q) === 0) return 70;
    if (initial && initial.indexOf(q) === 0) return 60;
    return 0;
  }

  if (name.indexOf(q) >= 0) return 80;
  if (short && short.indexOf(q) >= 0) return 75;
  if (pinyin.indexOf(q) === 0) return 70;
  if (pinyin.indexOf(q) >= 0) return 65;
  if (initial && initial.indexOf(q) === 0) return 60;
  if (initial && initial.indexOf(q) >= 0) return 60;

  return 0;
}

/**
 * 公司列表按关键词排序过滤
 * @returns 新数组（不改原数组），附带 _score
 */
function searchCompanies(list, kw) {
  const arr = Array.isArray(list) ? list : [];
  const q = String(kw || '').trim();
  if (!q) return arr.slice();
  return arr
    .map((c) => Object.assign({}, c, { _score: scoreCompany(c, q) }))
    .filter((c) => c._score > 0)
    .sort((a, b) => {
      if (b._score !== a._score) return b._score - a._score;
      // 同分按更新时间倒序，新的靠前
      return (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0);
    });
}

/* ============================================================
 * 城市匹配
 * ============================================================ */

/**
 * 城市匹配打分
 *   100 名称完全相等（济南 = 济南）
 *    90 名称以关键词开头（济 → 济南；但单字这里也放行，因为城市数量少）
 *    80 拼音完全相等（jinan）
 *    70 拼音以关键词开头
 *    60 首字母命中（jn）
 *    50 名称包含
 */
function scoreCity(city, kw) {
  if (!city) return 0;
  const raw = String(kw || '').trim();
  if (!raw) return 0;

  const q = common.normText(raw);
  const name = common.normText(city.name);
  const pinyin = common.normText(city.pinyin);
  const initial = common.normText(city.initial);

  if (name === q) return 100;
  if (name.indexOf(q) === 0) return 90;
  if (pinyin === q) return 80;
  if (pinyin.indexOf(q) === 0) return 70;
  if (initial === q) return 60;
  if (q.length >= 2 && name.indexOf(q) >= 0) return 50;
  return 0;
}

/** 城市列表搜索（用于两级选择器的输入框） */
function searchCities(list, kw) {
  const arr = Array.isArray(list) ? list : [];
  const q = String(kw || '').trim();
  if (!q) return arr.slice();
  return arr
    .map((c) => Object.assign({}, c, { _score: scoreCity(c, q) }))
    .filter((c) => c._score > 0)
    .sort((a, b) => {
      if (b._score !== a._score) return b._score - a._score;
      return (Number(a.sortOrder) || 999) - (Number(b.sortOrder) || 999);
    });
}

/* ============================================================
 * 首页搜索框：自动判断搜城市还是搜公司
 * ============================================================ */

/**
 * 判断关键词类型
 * @returns 'city' | 'company' | 'both' | 'empty'
 *
 * 判定顺序很关键：先看是否命中城市（城市字典是封闭集合，误判率低），
 * 命中城市时仍返回 'both'，因为「济南」既可能是城市也可能是公司名开头。
 */
function detectKeywordType(kw, cityList) {
  const q = String(kw || '').trim();
  if (!q) return 'empty';

  const cityHit = searchCities(cityList || [], q).length > 0;
  // 公司无法本地判定（不在本地），只按形态猜：
  // 含「物流|货运|运输|快运|供应链|有限公司」等词则认为更像公司名
  const looksCompany = /(物流|货运|运输|快运|供应链|有限公司|分公司|专线)/.test(q);

  // 命中城市就交结果页两路都试 —— 因为「济南」既可能是城市，也可能是
  // 「济南xx物流」的开头，本地无从分辨，让调用方两侧都查最稳。
  if (cityHit) return 'both';
  if (looksCompany) return 'company';
  return 'company';
}

/* ============================================================
 * 线路筛选
 * ============================================================ */

/**
 * 线路-公司关联行的筛选
 * @param {Array} rows [{ link, company }]
 * @param {object} filter { direct:bool, daily:bool, maxDays:number|null }
 */
function filterRows(rows, filter) {
  const arr = Array.isArray(rows) ? rows : [];
  const f = filter || {};
  return arr.filter(({ link }) => {
    if (!link) return false;
    if (f.direct && link.isDirect !== true) return false;
    if (f.daily && link.frequency !== 'daily') return false;
    if (f.maxDays != null && f.maxDays !== '') {
      const d = Number(link.transitDays);
      // 时效缺失的行在开启时效筛选时被排除（无法证明满足条件）
      if (!isFinite(d) || d <= 0) return false;
      if (d > Number(f.maxDays)) return false;
    }
    return true;
  });
}

/**
 * 线路-公司关联行的排序
 * @param {Array} rows
 * @param {string} sort 'composite' | 'updated' | 'scale' | 'transit'
 */
const SCALE_RANK = { large: 3, medium: 2, small: 1 };

function sortRows(rows, sort) {
  const arr = (Array.isArray(rows) ? rows : []).slice();
  const mode = sort || 'composite';

  const scaleOf = (r) => SCALE_RANK[(r.company && r.company.scale) || ''] || 0;
  const transitOf = (r) => {
    const d = Number(r.link && r.link.transitDays);
    return isFinite(d) && d > 0 ? d : Infinity; // 无时效排最后
  };

  arr.sort((a, b) => {
    if (mode === 'updated') {
      const x = Number((a.link && a.link.updatedAt) || 0);
      const y = Number((b.link && b.link.updatedAt) || 0);
      return y - x;
    }
    if (mode === 'scale') {
      return scaleOf(b) - scaleOf(a);
    }
    if (mode === 'transit') {
      const d = transitOf(a) - transitOf(b);
      if (d !== 0) return d;
      return scaleOf(b) - scaleOf(a);
    }
    // composite：已核实优先 → 直达优先 → 规模 → 时效 → 更新时间
    const va = (a.company && a.company.verified ? 1 : 0);
    const vb = (b.company && b.company.verified ? 1 : 0);
    if (va !== vb) return vb - va;

    const da = (a.link && a.link.isDirect ? 1 : 0);
    const db2 = (b.link && b.link.isDirect ? 1 : 0);
    if (da !== db2) return db2 - da;

    const sa = scaleOf(a);
    const sb = scaleOf(b);
    if (sa !== sb) return sb - sa;

    const ta = transitOf(a);
    const tb = transitOf(b);
    if (ta !== tb) return ta - tb;

    return Number((b.link && b.link.updatedAt) || 0) - Number((a.link && a.link.updatedAt) || 0);
  });

  return arr;
}

/* ============================================================
 * 公司详情：线路按出发城市分组
 * ============================================================ */

/**
 * 把该公司线路按「出发城市」分组
 * @param {Array} rows [{ link, route }]
 * @returns [{ city, province, routes:[{link,route}] }]
 *
 * 组内按到达城市 sortOrder？无此信息，改为按 route 的 companyCount 倒序
 * （跑得公司多的线路更主流），再按 toCity 拼音稳定排序。
 */
function groupRoutesByFromCity(rows) {
  const arr = Array.isArray(rows) ? rows : [];
  const groups = {};
  const order = [];

  arr.forEach((row) => {
    const route = row.route || {};
    const city = route.fromCity || '未知';
    if (!groups[city]) {
      groups[city] = { city, province: route.fromProvince || '', routes: [] };
      order.push(city);
    }
    groups[city].routes.push(row);
  });

  const list = order.map((city) => {
    const g = groups[city];
    g.routes.sort((a, b) => {
      const x = Number((a.route && a.route.companyCount) || 0);
      const y = Number((b.route && b.route.companyCount) || 0);
      if (y !== x) return y - x;
      return String((a.route && a.route.toCity) || '').localeCompare(String((b.route && b.route.toCity) || ''), 'zh');
    });
    return g;
  });

  // 出发城市按拼音排序，济南这类省会无法判定优先级，故用拼音稳定即可
  list.sort((a, b) => String(a.city).localeCompare(String(b.city), 'zh'));
  return list;
}

module.exports = {
  scoreCompany,
  searchCompanies,
  scoreCity,
  searchCities,
  detectKeywordType,
  filterRows,
  sortRows,
  groupRoutesByFromCity,
  SCALE_RANK
};
