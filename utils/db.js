/**
 * 云数据库访问封装（小程序端）
 *
 * 职责：
 *   - 统一集合名（从 shared/schema 取，避免各处硬编码字符串）
 *   - 统一分页（默认每页 20，最大 50 —— 小程序单次返回有上限）
 *   - 统一错误处理（网络/权限异常不得把页面搞崩，一律降级为空结果）
 *
 * ★ 所有页面取数都必须经过这里，不要直接 wx.cloud.database()。
 *   原因：分页参数、集合名、错误兜底只有一份实现，改口径时不会漏页。
 */

const { COLLECTIONS } = require('../shared/schema');
const common = require('./common');

const PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

/** 云开发是否可用（app.js 初始化成功才为 true） */
function available() {
  return !!(wx.cloud && typeof wx.cloud.database === 'function');
}

/** 取数据库实例；不可用时抛错，由调用方兜底 */
function db() {
  if (!available()) {
    const e = new Error('云开发未初始化');
    e.code = 'CLOUD_UNAVAILABLE';
    throw e;
  }
  return wx.cloud.database();
}

/** 取集合引用 */
function coll(name) {
  return db().collection(name);
}

/** 归一每页条数：非法值退回默认，超上限截断 */
function normLimit(n) {
  const v = Number(n);
  if (!v || !isFinite(v) || v <= 0) return PAGE_SIZE;
  return Math.min(Math.floor(v), MAX_PAGE_SIZE);
}

/**
 * 统一执行一次查询，失败降级。
 * @returns {{ok:boolean, raw:any, err:any}}
 *   ok=false 时 raw 为 null，页面直接走空态，不弹错误
 *
 * ★ 注意：这里刻意**不**把结果归一成数组。
 *   collection.get() 返回 { data: [...] }
 *   doc().get()     返回 { data: {...} }   ← 是对象不是数组
 *   若在此处强制 `res.data || []`，doc 查询会被包成 [{...}]，
 *   调用方再做 Array.isArray 判断就永远为真，单条查询会静默变成数组。
 *   归一由各自的调用方负责（listData / getById）。
 */
async function safeGet(builder) {
  try {
    const res = await builder.get();
    return { ok: true, raw: res, err: null };
  } catch (e) {
    // 集合不存在（首次部署未建表）与网络异常都走这里
    return { ok: false, raw: null, err: e };
  }
}

/** 取「列表」形态的结果（collection.get()） */
async function listData(builder) {
  const r = await safeGet(builder);
  if (!r.ok) return { ok: false, data: [], err: r.err };
  const d = r.raw && r.raw.data;
  return { ok: true, data: Array.isArray(d) ? d : [], err: null };
}

/** 取「单条」形态的结果（doc().get()） */
async function docData(builder) {
  const r = await safeGet(builder);
  if (!r.ok) return { ok: false, data: null, err: r.err };
  const d = r.raw && r.raw.data;
  return { ok: true, data: (d && !Array.isArray(d)) ? d : null, err: null };
}

/**
 * 分页查询
 * @param {string} name 集合名
 * @param {object} opt  { where, orderBy:[field,dir], skip, limit }
 */
async function list(name, opt) {
  const o = opt || {};
  let q = coll(name);
  if (o.where) q = q.where(o.where);
  if (o.orderBy) q = q.orderBy(o.orderBy[0], o.orderBy[1]);
  const limit = normLimit(o.limit);
  const skip = Math.max(0, Number(o.skip) || 0);
  return listData(q.skip(skip).limit(limit));
}

/** 按 _id 取单条；不存在返回 null（不抛错） */
async function getById(name, id) {
  if (!id) return null;
  const r = await docData(coll(name).doc(String(id)));
  return r.ok ? r.data : null;
}

/** 计数（失败返回 0） */
async function count(name, where) {
  try {
    let q = coll(name);
    if (where) q = q.where(where);
    const res = await q.count();
    return (res && res.total) || 0;
  } catch (e) {
    return 0;
  }
}

/* ============================================================
 * 业务查询（把「怎么查」收在这里，页面只关心「查什么」）
 * ============================================================ */

/**
 * 按出发地 + 目的地查线路（精确路由）
 * @returns routes 文档或 null
 */
async function findRoute(fromCity, toCity) {
  const key = common.buildRouteKey(fromCity, toCity);
  if (!key) return null;
  const r = await listData(coll(COLLECTIONS.ROUTES).where({ routeKey: key }).limit(1));
  return r.ok ? (r.data[0] || null) : null;
}

/**
 * 取某条线路下的全部公司关联（含公司档案）
 *
 * 分两步查而不是用聚合：云开发联表查询在客户端不支持，
 * 且数据量小（单线路几十家），两次往返比聚合更可控。
 */
async function listRouteCompanies(routeId) {
  if (!routeId) return [];
  const r = await listData(
    coll(COLLECTIONS.ROUTE_COMPANIES).where({ routeId: String(routeId) }).limit(MAX_PAGE_SIZE)
  );
  if (!r.ok || !r.data.length) return [];

  const links = r.data;
  const ids = links.map((x) => x.companyId).filter(Boolean);
  if (!ids.length) return [];

  // 用 in 一次取回公司档案
  const cRes = await listData(
    coll(COLLECTIONS.COMPANIES).where({ _id: db().command.in(ids) }).limit(MAX_PAGE_SIZE)
  );
  const byId = {};
  (cRes.data || []).forEach((c) => { byId[c._id] = c; });

  return links
    .map((link) => ({ link, company: byId[link.companyId] || null }))
    .filter((x) => x.company);
}

/**
 * 某线路的关联总数（用于判断是否需要分页）
 * 计数失败返回 0，调用方据此退回「一次取满」的保守行为。
 */
async function countRouteCompanies(routeId) {
  if (!routeId) return 0;
  try {
    const res = await coll(COLLECTIONS.ROUTE_COMPANIES).where({ routeId: String(routeId) }).count();
    return Number((res && res.total) || 0);
  } catch (err) {
    return 0;
  }
}

/**
 * 某线路的关联，**分页**返回
 *
 * 为什么要这个：热门线路（如 济南→广州）可能挂着上百家公司，
 * 一次全取回来既慢又浪费。列表页改为「先取首页 + 触底再取下一页」。
 *
 * ★ 展开成扁平行需要公司档案，故按 `routeId` 查公司 id 后批量回填，
 *   口径与 listRouteCompanies 完全一致，只是多了一层 skip/limit。
 *
 * @param {string} routeId
 * @param {number} page  从 0 开始
 * @param {number} size  每页条数（上限 MAX_PAGE_SIZE）
 * @returns {{ rows: Array, hasMore: boolean }}
 */
async function pageRouteCompanies(routeId, page, size) {
  if (!routeId) return { rows: [], hasMore: false };

  const n = Math.max(1, Math.min(Number(size) || PAGE_SIZE, MAX_PAGE_SIZE));
  const skip = Math.max(0, Number(page) || 0) * n;

  const r = await listData(
    coll(COLLECTIONS.ROUTE_COMPANIES)
      .where({ routeId: String(routeId) })
      .skip(skip)
      .limit(n)
  );
  if (!r.ok || !r.data.length) return { rows: [], hasMore: false };

  const links = r.data;
  const ids = links.map((x) => x.companyId).filter(Boolean);
  if (!ids.length) return { rows: [], hasMore: false };

  const cRes = await listData(
    coll(COLLECTIONS.COMPANIES).where({ _id: db().command.in(ids) }).limit(MAX_PAGE_SIZE)
  );
  const byId = {};
  (cRes.data || []).forEach((c) => { byId[c._id] = c; });

  const rows = links
    .map((link) => ({ link, company: byId[link.companyId] || null }))
    .filter((x) => x.company);

  // 页面没取满 ⇒ 到底了（比再发一次 count 便宜）
  return { rows: rows, hasMore: links.length >= n };
}

/** 取某公司的全部线路关联 */
async function listCompanyRoutes(companyId) {
  if (!companyId) return [];
  const r = await listData(
    coll(COLLECTIONS.ROUTE_COMPANIES).where({ companyId: String(companyId) }).limit(MAX_PAGE_SIZE)
  );
  if (!r.ok || !r.data.length) return [];

  const links = r.data;

  /*
   * ★ 不写 `[...new Set(...)]`：数组展开在小程序端（增强编译 → SWC）
   *   可能被编译成对 @swc/runtime 辅助模块的 require，本环境没装 ⇒ 报错白屏。
   *   这里用「Set 去重 + push」，行为等价且不需要任何编译辅助函数。
   */
  const seenKey = new Set();
  const keys = [];
  links.forEach((x) => {
    if (x.routeKey && !seenKey.has(x.routeKey)) {
      seenKey.add(x.routeKey);
      keys.push(x.routeKey);
    }
  });
  if (!keys.length) return [];

  const rRes = await listData(
    coll(COLLECTIONS.ROUTES).where({ routeKey: db().command.in(keys) }).limit(MAX_PAGE_SIZE)
  );
  const byKey = {};
  (rRes.data || []).forEach((x) => { byKey[x.routeKey] = x; });

  return links
    .map((link) => ({ link, route: byKey[link.routeKey] || null }))
    .filter((x) => x.route);
}

/** 热门城市（isHot=true，按 sortOrder） */
async function listHotCities(limit) {
  const r = await listData(
    coll(COLLECTIONS.CITIES).where({ isHot: true }).orderBy('sortOrder', 'asc').limit(normLimit(limit || 20))
  );
  return r.data;
}

/** 热门线路：按 companyCount 倒序取前 N 条 */
async function listHotRoutes(limit) {
  const r = await listData(
    coll(COLLECTIONS.ROUTES).orderBy('companyCount', 'desc').limit(normLimit(limit || 6))
  );
  return r.data;
}

/** 最近更新的公司（首页「最近更新」区块） */
async function listRecentCompanies(limit) {
  const r = await listData(
    coll(COLLECTIONS.COMPANIES).orderBy('updatedAt', 'desc').limit(normLimit(limit || 5))
  );
  return r.data;
}

module.exports = {
  PAGE_SIZE,
  MAX_PAGE_SIZE,
  available,
  db,
  coll,
  normLimit,
  safeGet,
  listData,
  docData,
  list,
  getById,
  count,
  findRoute,
  listRouteCompanies,
  countRouteCompanies,
  pageRouteCompanies,
  listCompanyRoutes,
  listHotCities,
  listHotRoutes,
  listRecentCompanies
};
