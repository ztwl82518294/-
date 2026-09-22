/**
 * admin/lib/repository.js —— 写穿透层
 *
 * ★ 职责边界（很窄，但很重要）：
 *   - store.js 说「业务上发生了什么」
 *   - db.js 说「JSON 怎么落盘」
 *   - repository.js 负责把两者接起来：**调 store 改内存 → 按需落盘**
 *
 * ★ 写穿透的约定（与小程序端 / 云函数的写法保持一致）：
 *   凡是能让用户看到数据变化的操作（增删改、审核、导入），
 *   调用 `commit(...)` 完成「改 + 存」；纯查询走 `store.*` 直读内存。
 *
 * ★ 为什么不一有改动就整库落盘：
 *   导入 1000 条时每行落盘一次 = 几千次文件写，慢且容易撞 rename。
 *   所以导入走 `transaction()`：过程中只改内存，结束后统一落一次。
 */

const db = require('./db');
const store = require('./store');

const FILES = [
  store.FILE_COMPANIES, store.FILE_ROUTES, store.FILE_LINKS, store.FILE_CORRECTIONS,
  store.FILE_ANNOUNCEMENTS, store.FILE_FEATURED
];

/**
 * ★ 「已装载」标志 —— 这道护栏防的是一次**会清空运营数据的事故**。
 *
 * 背景：`flush()` 是把内存表的**全量快照**覆盖写到文件（不是增量追加）。
 * 如果内存还没从磁盘装载就执行写操作，内存里是空数组，
 * 覆盖写下去就是把整个数据文件抹成 `[]`。
 *
 * 这个坑很隐蔽：
 *   - 开发者写个脚本 `repo.createCompany({...})` 想插一条数据，
 *     忘了先 `loadAll()`，结果**整个公司的数据都没了**，而且不报任何错；
 *   - 启动流程里 `loadAll()` 若抛错被外层 catch 吞掉，也是同样后果。
 *
 * 所以这里加一道硬护栏：没装载过就**禁止落盘**，并抛出明确错误。
 * 宁可开发时报错，也不能让运营数据静默消失。
 */
let loaded = false;

/** 从磁盘装载全部表到内存（启动时调一次） */
function loadAll() {
  store.replaceAll({
    companies: db.read(store.FILE_COMPANIES),
    routes: db.read(store.FILE_ROUTES),
    route_companies: db.read(store.FILE_LINKS),
    corrections: db.read(store.FILE_CORRECTIONS),
    announcements: db.read(store.FILE_ANNOUNCEMENTS),
    featured_routes: db.read(store.FILE_FEATURED)
  });
  loaded = true;
  return store.tables();
}

/** 首次生成：把 seed 产出的表结构落盘并装载 */
function bootstrapFrom(tables) {
  db.write(store.FILE_COMPANIES, tables.companies || []);
  db.write(store.FILE_ROUTES, tables.routes || []);
  db.write(store.FILE_LINKS, tables.routeCompanies || tables.route_companies || []);
  db.write(store.FILE_CORRECTIONS, []);
  db.write(store.FILE_ANNOUNCEMENTS, tables.announcements || []);
  db.write(store.FILE_FEATURED, tables.featuredRoutes || tables.featured_routes || []);
  store.replaceAll({
    companies: tables.companies || [],
    routes: tables.routes || [],
    route_companies: tables.routeCompanies || tables.route_companies || [],
    corrections: [],
    announcements: tables.announcements || [],
    featured_routes: tables.featuredRoutes || tables.featured_routes || []
  });
  loaded = true;
  return true;
}

/** 是否已装载（测试用于断言护栏生效） */
function isLoaded() {
  return loaded;
}

/**
 * 落盘指定的表（默认全部）
 * @param {string[]} names 需要落盘的集合名
 */
function flush(names) {
  /*
   * ★ 未装载禁止落盘。见文件顶部 `loaded` 的说明：
   *   未装载时内存是空表，覆盖写会把运营数据抹成 `[]`。
   */
  if (!loaded) {
    throw new Error(
      '拒绝落盘：数据尚未装载。请先调用 repository.loadAll()（或 bootstrapFrom）。\n' +
      '  原因：flush 是全量覆盖写，未装载时内存为空，会把数据文件清空。'
    );
  }
  const list = Array.isArray(names) && names.length ? names : FILES;
  const snap = store.snapshot();
  list.forEach((n) => {
    const rows = snap[n];
    if (rows === undefined) return;
    db.write(n, rows);
  });
  return list.length;
}

/**
 * 写穿透：执行一个会改数据的函数，成功后落盘
 *
 * ★ 只在「成功」时落盘：结果里带 ok:false 就不写文件，
 *   避免「校验失败却把中间态写进磁盘」。
 *
 * @param {string[]} names 需要落盘的表
 * @param {function} fn 改数据的函数，返回 {ok:boolean, ...}
 */
function commit(names, fn) {
  const result = fn();
  if (result && result.ok === false) return result;
  flush(names);
  return result;
}

/**
 * 事务：过程中不落盘，结束后统一落一次
 * 用于批量导入这种「多次改动」的场景。
 */
function transaction(names, fn) {
  const result = fn();
  flush(names);
  return result;
}

/* ============================================================
 * 对上层暴露的「业务 + 落盘」组合操作
 * 页面/API 只调这里，不直接调 store 的写方法 —— 防止有人忘了落盘。
 * ============================================================ */

const ALL = FILES;
const COMPANY_RELATED = [store.FILE_COMPANIES, store.FILE_LINKS, store.FILE_ROUTES];
const ROUTE_RELATED = [store.FILE_ROUTES, store.FILE_LINKS];

/* ---------- 公司 ---------- */
function createCompany(input) {
  return commit(ALL, () => store.createCompany(input));
}
function updateCompany(id, input) {
  return commit(ALL, () => store.updateCompany(id, input));
}
function deleteCompany(id) {
  // 级联删了关联 → 线路计数也变了，三张表都要落
  return commit(COMPANY_RELATED, () => store.deleteCompany(id));
}

/* ---------- 线路 ---------- */
function createRoute(input) {
  return commit(ROUTE_RELATED, () => store.createRoute(input));
}
function updateRoute(id, input) {
  return commit(ALL, () => store.updateRoute(id, input));
}
function deleteRoute(id) {
  return commit(ROUTE_RELATED, () => store.deleteRoute(id));
}

/* ---------- 关联 ---------- */
function createLink(input) {
  return commit(ALL, () => store.createLink(input));
}
function updateLink(id, input) {
  return commit(ALL, () => store.updateLink(id, input));
}
function deleteLink(id) {
  return commit(ALL, () => store.deleteLink(id));
}

/* ---------- 纠错 ---------- */
function reviewCorrection(id, status, note) {
  return commit([store.FILE_CORRECTIONS], () => store.reviewCorrection(id, status, note));
}
function deleteCorrection(id) {
  return commit([store.FILE_CORRECTIONS], () => store.deleteCorrection(id));
}
function mergeCorrections(rows) {
  return commit([store.FILE_CORRECTIONS], () => store.mergeCorrections(rows));
}

/* ---------- 运营位：公告 ---------- */
function createAnnouncement(input) {
  return commit([store.FILE_ANNOUNCEMENTS], () => store.createAnnouncement(input));
}
function updateAnnouncement(id, input) {
  return commit([store.FILE_ANNOUNCEMENTS], () => store.updateAnnouncement(id, input));
}
function deleteAnnouncement(id) {
  return commit([store.FILE_ANNOUNCEMENTS], () => store.deleteAnnouncement(id));
}

/* ---------- 运营位：优质线路推广 ---------- */
function createFeatured(input) {
  return commit([store.FILE_FEATURED], () => store.createFeatured(input));
}
function updateFeatured(id, input) {
  return commit([store.FILE_FEATURED], () => store.updateFeatured(id, input));
}
function deleteFeatured(id) {
  return commit([store.FILE_FEATURED], () => store.deleteFeatured(id));
}

/* ---------- 导入（走事务，只落一次） ---------- */
function applyImport(validRows) {
  return transaction(ALL, () => store.applyImportRows(validRows));
}

/* ---------- 只读查询：直接透传 store，不落盘 ---------- */
const read = {
  listCompanies: store.listCompanies,
  getCompany: store.getCompany,
  listRoutes: store.listRoutes,
  getRoute: store.getRoute,
  listLinks: store.listLinks,
  getLink: store.getLink,
  listCorrections: store.listCorrections,
  correctionCounts: store.correctionCounts,
  getCorrection: store.getCorrection,
  listAnnouncements: store.listAnnouncements,
  getAnnouncement: store.getAnnouncement,
  listFeatured: store.listFeatured,
  getFeatured: store.getFeatured,
  listRouteOptions: store.listRoutes,
  qualityStats: store.qualityStats,
  validateImportRows: store.validateImportRows,
  recountRoutes: store.recountRoutes,
  tables: store.tables,
  snapshot: store.snapshot
};

module.exports = Object.assign({}, read, {
  loadAll,
  bootstrapFrom,
  isLoaded,
  flush,
  commit,
  transaction,
  createCompany,
  updateCompany,
  deleteCompany,
  createRoute,
  updateRoute,
  deleteRoute,
  createLink,
  updateLink,
  deleteLink,
  reviewCorrection,
  deleteCorrection,
  mergeCorrections,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  createFeatured,
  updateFeatured,
  deleteFeatured,
  applyImport,
  FILES,
  ALL
});
