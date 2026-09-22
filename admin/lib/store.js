/**
 * admin/lib/store.js —— 纯内存业务逻辑层
 *
 * ★ 设计要点：本模块**不碰磁盘**。所有函数只操作传进来的内存表。
 *   好处是可以在测试里直接构造数据、断言结果，不需要临时目录、不需要清理。
 *   落盘由 repository.js 负责（写穿透）。
 *
 * 与小程序端的一致性铁律（来自项目记忆，任何改动都不能破）：
 *   1. routeKey 必须过 normCity（去「市/区/县/省」后缀），否则「济南市-广州市」
 *      与「济南-广州」会变成两条独立线路，搜索侧永远查不全。
 *   2. 时效/直达/频率等属性必须挂在关联表（route_companies），不能上提到
 *      companies 或 routes —— 同一家公司跑不同线路时效本就不同。
 *   3. companyCount 是冗余计数，必须在每次挂载/卸载关联后**立即重算**，
 *      否则线路详情的「N 家公司」会与列表条数对不上。
 *   4. 删除公司/线路时必须**级联删除**关联，否则留下悬空外键，
 *      小程序端会出现「点进线路却查不到公司」的死链。
 */

const common = require('../../utils/common');
const schema = require('../../shared/schema');
/**
 * ★ 字段校验一律走 shared/validate.js —— 与云函数 adminApi 同一份实现。
 *   以前校验写在本文件里，小程序端后台一旦各写一份，两边迟早会漂
 *   （一边拦得住一边拦不住），脏数据就从小程序端进来了。
 */
const validate = require('../../shared/validate');

/* 集合名 → 我们的文件/内存键名（与 shared/schema 的 COLLECTIONS 对应） */
const FILE_COMPANIES = schema.COLLECTIONS.COMPANIES;
const FILE_ROUTES = schema.COLLECTIONS.ROUTES;
const FILE_LINKS = schema.COLLECTIONS.ROUTE_COMPANIES;
const FILE_CORRECTIONS = schema.COLLECTIONS.CORRECTIONS;
/* 运营位两张表（2026-09-22 新增）：首页公告栏 + 优质线路推广 */
const FILE_ANNOUNCEMENTS = schema.COLLECTIONS.ANNOUNCEMENTS;
const FILE_FEATURED = schema.COLLECTIONS.FEATURED_ROUTES;

/**
 * 内存表（由 repository.loadAll / bootstrapFrom 填充）
 *
 * ★ 键名必须**等于集合名**（announcements / featured_routes）：
 *   repository.flush() 是按集合名去 snapshot 里取行的（`snap[n]`），
 *   键名对不上就是「改了内存但不落盘」，且不报任何错。
 */
const T = {
  companies: [],
  routes: [],
  route_companies: [],
  corrections: [],
  announcements: [],
  featured_routes: []
};

/* ============================================================
 * 装载 / 快照
 * ============================================================ */

/** 用外部数据整体替换内存表（深拷贝，防外部改动串进 store） */
function replaceAll(data) {
  T.companies = clone(data.companies || []);
  T.routes = clone(data.routes || []);
  T.route_companies = clone(data.route_companies || []);
  T.corrections = clone(data.corrections || []);
  T.announcements = clone(data.announcements || []);
  T.featured_routes = clone(data.featured_routes || []);
}

/** 取当前内存表的深拷贝（供落盘） */
function snapshot() {
  return {
    companies: clone(T.companies),
    routes: clone(T.routes),
    route_companies: clone(T.route_companies),
    corrections: clone(T.corrections),
    announcements: clone(T.announcements),
    featured_routes: clone(T.featured_routes)
  };
}

/** 直接暴露只读引用（给统计等只读用途，避免无谓拷贝） */
function tables() {
  return T;
}

function clone(v) {
  return JSON.parse(JSON.stringify(v === undefined ? null : v));
}

/* ============================================================
 * 工具
 * ============================================================ */

/** 生成本地 id（不需要全局唯一，单机后台够用） */
function nextId(prefix, list) {
  let max = 0;
  list.forEach((x) => {
    const m = String(x._id || '').match(/(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  });
  const n = String(max + 1).padStart(3, '0');
  return prefix + n;
}

/** 线路 id 由 routeKey 派生（保证同一线路只有一条记录） */
function routeIdOf(routeKey) {
  return 'route_' + String(routeKey).replace(/-/g, '_');
}

function normCity(v) {
  return common.normCity(v);
}

/* ============================================================
 * 线路：派生与计数维护
 * ============================================================ */

/**
 * 规范化一条线路记录
 * ★ routeKey 一律重新派生，不接受调用方传入 —— 这是防「脏 key」的唯一闸口。
 */
function normalizeRoute(input) {
  const fromCity = String((input && input.fromCity) || '').trim();
  const toCity = String((input && input.toCity) || '').trim();
  const routeKey = common.buildRouteKey(fromCity, toCity);
  return {
    _id: (input && input._id) || routeIdOf(routeKey),
    fromCity: fromCity,
    fromProvince: String((input && input.fromProvince) || '').trim(),
    toCity: toCity,
    toProvince: String((input && input.toProvince) || '').trim(),
    routeKey: routeKey,
    companyCount: Number((input && input.companyCount) || 0),
    createdAt: Number((input && input.createdAt) || Date.now()),
    updatedAt: Number((input && input.updatedAt) || Date.now())
  };
}

/**
 * 重算全部线路的 companyCount
 * ★ 每次增删关联后必须调用。宁可靠重算也不要靠 +=1/ -=1，
 *   因为导入、级联删除、手工编辑都会改关联数，增量维护迟早会漂。
 */
function recountRoutes() {
  const cnt = {};
  T.route_companies.forEach((l) => {
    cnt[l.routeId] = (cnt[l.routeId] || 0) + 1;
  });
  T.routes.forEach((r) => {
    r.companyCount = cnt[r._id] || 0;
  });
  return T.routes;
}

/**
 * 确保线路存在（不存在则创建），返回线路
 * ★ 这是「按 routeKey 去重」的落点：同名线路无论被导入多少次，只留一条。
 */
function ensureRoute(fromCity, toCity, extra) {
  const key = common.buildRouteKey(fromCity, toCity);
  if (!key) return null;
  let r = T.routes.find((x) => x.routeKey === key);
  if (r) {
    // 补齐可能缺失的省份（导入时可能没带）
    const e = extra || {};
    if (!r.fromProvince && e.fromProvince) r.fromProvince = e.fromProvince;
    if (!r.toProvince && e.toProvince) r.toProvince = e.toProvince;
    return r;
  }
  r = normalizeRoute(
    Object.assign({ fromCity: fromCity, toCity: toCity }, extra || {})
  );
  T.routes.push(r);
  return r;
}

/* ============================================================
 * 公司：增删改查
 * ============================================================ */

/**
 * 规范化公司记录
 * @param {object} input
 * @param {boolean} isNew 新建时补 _id / createdAt
 */
function normalizeCompany(input, isNew) {
  const now = Date.now();
  const raw = input || {};
  const stations = normalizeStations(raw.departureStations);
  const arrStations = normalizeStations(raw.arrivalStations);

  return {
    _id: isNew ? nextId('comp_', T.companies) : raw._id,
    name: String(raw.name || '').trim(),
    shortName: String(raw.shortName || '').trim(),
    initial: String(raw.initial || '').trim().toLowerCase(),
    pinyin: String(raw.pinyin || '').trim().toLowerCase(),
    phone: String(raw.phone || '').trim(),
    backupPhone: String(raw.backupPhone || '').trim(),
    address: String(raw.address || '').trim(),
    city: String(raw.city || '').trim(),
    province: String(raw.province || '').trim(),
    scale: String(raw.scale || 'small').trim(),
    intro: String(raw.intro || '').trim(),
    verified: raw.verified === true || raw.verified === 'true' || raw.verified === 'on',
    departureStations: stations,
    arrivalStations: arrStations,
    viewCount: Number(raw.viewCount || 0),
    createdAt: Number(raw.createdAt || now),
    updatedAt: isNew ? now : now   // 任何编辑都刷新（PRD：数据更新时间必须展示）
  };
}

/**
 * 发站/到站归一
 * 接受两种形态：[{address,phone}] 或 "地址 | 电话1,电话2" 字符串，
 * 统一存成数组形态 —— 与小程序端 utils/common.js 的 parseStations 同口径。
 */
function normalizeStations(v) {
  if (Array.isArray(v)) {
    return v
      .map((s) => {
        if (typeof s === 'string') {
          const p = common.parseStationRow(s);
          return p ? { address: p.address, phone: p.phone } : null;
        }
        if (s && typeof s === 'object') {
          return { address: String(s.address || '').trim(), phone: String(s.phone || '').trim() };
        }
        return null;
      })
      .filter((s) => s && (s.address || s.phone));
  }
  if (typeof v === 'string' && v.trim()) {
    const p = common.parseStationRow(v);
    return p ? [{ address: p.address, phone: p.phone }] : [];
  }
  return [];
}

/** 校验公司数据（返回错误字段列表，空数组 = 通过） */
function validateCompany(c) {
  return validate.validateCompany(c, { companies: T.companies });
}

function listCompanies(kw, page, pageSize) {
  const q = String(kw || '').trim();
  const size = Number(pageSize) || 20;
  const p = Math.max(1, Number(page) || 1);
  let rows = T.companies.slice();

  if (q) {
    // ★ 与小程序端 scoreCompany 同口径（都走 utils/search 的打分）
    const search = require('../../utils/search');
    rows = search.searchCompanies(rows, q);
  } else {
    rows.sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
  }

  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const slice = rows.slice((p - 1) * size, p * size);
  return { rows: slice, total: total, page: p, pages: pages, pageSize: size };
}

function getCompany(id) {
  return T.companies.find((c) => c._id === id) || null;
}

function createCompany(input) {
  const c = normalizeCompany(input, true);
  const errs = validateCompany(c);
  if (errs.length) return { ok: false, errors: errs };
  T.companies.push(c);
  return { ok: true, company: c };
}

function updateCompany(id, input) {
  const idx = T.companies.findIndex((c) => c._id === id);
  if (idx < 0) return { ok: false, errors: [{ field: '_id', message: '公司不存在' }] };
  const merged = normalizeCompany(Object.assign({}, T.companies[idx], input, { _id: id }), false);
  merged.createdAt = T.companies[idx].createdAt;   // 不因编辑而改创建时间
  const errs = validateCompany(merged);
  if (errs.length) return { ok: false, errors: errs };
  T.companies[idx] = merged;
  // 公司改名后，纠错记录里的 targetSummary 快照会过期 —— 不追溯修改，
  // 因为纠错是历史凭证，快照本就应保留提交时的样子。
  return { ok: true, company: merged };
}

/**
 * 删除公司
 * ★ 级联删除该公司的全部线路关联，然后重算 companyCount。
 */
function deleteCompany(id) {
  const idx = T.companies.findIndex((c) => c._id === id);
  if (idx < 0) return { ok: false, message: '公司不存在' };
  const removed = T.companies.splice(idx, 1)[0];
  const before = T.route_companies.length;
  T.route_companies = T.route_companies.filter((l) => l.companyId !== id);
  const cascaded = before - T.route_companies.length;
  recountRoutes();
  return { ok: true, company: removed, cascadedLinks: cascaded };
}

/* ============================================================
 * 线路：增删改查
 * ============================================================ */

function validateRoute(r, ignoreId) {
  return validate.validateRoute(r, { routes: T.routes, ignoreId: ignoreId || null });
}

function listRoutes(kw, page, pageSize) {
  const q = String(kw || '').trim().toLowerCase();
  const size = Number(pageSize) || 20;
  const p = Math.max(1, Number(page) || 1);
  let rows = T.routes.slice();

  if (q) {
    rows = rows.filter((r) => {
      const hay = (r.routeKey + ' ' + r.fromCity + ' ' + r.toCity + ' ' +
        (r.fromProvince || '') + ' ' + (r.toProvince || '')).toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  // 公司多的线路排前面（更主流），再按更新时间
  rows.sort((a, b) => {
    if ((b.companyCount || 0) !== (a.companyCount || 0)) return (b.companyCount || 0) - (a.companyCount || 0);
    return (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0);
  });

  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / size));
  return { rows: rows.slice((p - 1) * size, p * size), total: total, page: p, pages: pages, pageSize: size };
}

function getRoute(id) {
  return T.routes.find((r) => r._id === id) || null;
}

function createRoute(input) {
  const r = normalizeRoute(input);
  // 唯一性校验已含在 validateRoute 里（ctx.routes）—— 不在这里另写一遍，防止两边口径漂移
  const errs = validateRoute(r);
  if (errs.length) return { ok: false, errors: errs };
  T.routes.push(r);
  return { ok: true, route: r };
}

function updateRoute(id, input) {
  const idx = T.routes.findIndex((r) => r._id === id);
  if (idx < 0) return { ok: false, errors: [{ field: '_id', message: '线路不存在' }] };
  const old = T.routes[idx];
  const merged = normalizeRoute(Object.assign({}, old, input, { _id: id }));
  merged.createdAt = old.createdAt;
  const errs = validateRoute(merged, id);
  if (errs.length) return { ok: false, errors: errs };
  T.routes[idx] = merged;

  // ★ 改城市会换 routeKey，必须同步所有关联的 routeId / routeKey，
  //   否则关联会指向一个不存在的线路 —— 小程序端直接死链。
  if (merged._id !== old._id || merged.routeKey !== old.routeKey) {
    const newId = merged._id;
    T.route_companies.forEach((l) => {
      if (l.routeId === old._id) {
        l.routeId = newId;
        l.routeKey = merged.routeKey;
      }
    });
    // 若 _id 变了，删掉旧记录并保证新记录在表内（normalizeRoute 已按 key 派生 _id）
    if (newId !== old._id) {
      T.routes = T.routes.filter((r) => r._id !== old._id || r === merged);
      // 若新 _id 与已有记录撞了（理论上 routeKey 唯一则不会），以新记录为准
      T.routes = T.routes.filter((r, i) => r._id !== newId || r === merged || i === T.routes.indexOf(merged));
      if (T.routes.indexOf(merged) < 0) T.routes.push(merged);
    }
    recountRoutes();
  }
  return { ok: true, route: merged };
}

/** 删除线路：级联删除关联 */
function deleteRoute(id) {
  const idx = T.routes.findIndex((r) => r._id === id);
  if (idx < 0) return { ok: false, message: '线路不存在' };
  const removed = T.routes.splice(idx, 1)[0];
  const before = T.route_companies.length;
  T.route_companies = T.route_companies.filter((l) => l.routeId !== id);
  const cascaded = before - T.route_companies.length;
  recountRoutes();
  return { ok: true, route: removed, cascadedLinks: cascaded };
}

/* ============================================================
 * 关联（线路公司）：承载时效 / 直达 / 频率
 * ============================================================ */

function normalizeLink(input) {
  const now = Date.now();
  const raw = input || {};
  const freq = String(raw.frequency || '').trim();
  const allowedFreq = schema.FREQUENCY_OPTIONS.map((o) => o.value);
  const days = raw.transitDays === '' || raw.transitDays === null || raw.transitDays === undefined
    ? null : Number(raw.transitDays);

  return {
    _id: raw._id || nextId('rc_', T.route_companies),
    routeId: String(raw.routeId || '').trim(),
    companyId: String(raw.companyId || '').trim(),
    routeKey: String(raw.routeKey || '').trim(),
    transitDays: days,
    isDirect: raw.isDirect === true || raw.isDirect === 'true' || raw.isDirect === 'on',
    frequency: allowedFreq.indexOf(freq) >= 0 ? freq : '',
    priceNote: String(raw.priceNote || '').trim(),
    remark: String(raw.remark || '').trim(),
    createdAt: Number(raw.createdAt || now),
    updatedAt: now
  };
}

function validateLink(l) {
  return validate.validateLink(l, {
    routes: T.routes,
    companies: T.companies,
    links: T.route_companies
  });
}

/** 列表：支持按公司名 / 线路关键字搜索 */
function listLinks(kw, page, pageSize) {
  const q = String(kw || '').trim().toLowerCase();
  const size = Number(pageSize) || 20;
  const p = Math.max(1, Number(page) || 1);
  const cMap = {};
  T.companies.forEach((c) => { cMap[c._id] = c; });

  let rows = T.route_companies.map((l) => ({
    link: l,
    route: T.routes.find((r) => r._id === l.routeId) || null,
    company: cMap[l.companyId] || null
  }));

  if (q) {
    rows = rows.filter((x) => {
      const hay = [
        x.company ? x.company.name + ' ' + x.company.shortName : '',
        x.route ? x.route.routeKey : '',
        x.link.priceNote || '',
        x.link.remark || ''
      ].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  rows.sort((a, b) => (Number(b.link.updatedAt) || 0) - (Number(a.link.updatedAt) || 0));
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / size));
  return { rows: rows.slice((p - 1) * size, p * size), total: total, page: p, pages: pages, pageSize: size };
}

function getLink(id) {
  return T.route_companies.find((l) => l._id === id) || null;
}

function createLink(input) {
  const l = normalizeLink(input);
  // routeKey 由线路派生，不接受前端传
  const r = T.routes.find((x) => x._id === l.routeId);
  if (r) l.routeKey = r.routeKey;
  const errs = validateLink(l);
  if (errs.length) return { ok: false, errors: errs };
  T.route_companies.push(l);
  recountRoutes();
  return { ok: true, link: l };
}

function updateLink(id, input) {
  const idx = T.route_companies.findIndex((l) => l._id === id);
  if (idx < 0) return { ok: false, errors: [{ field: '_id', message: '关联不存在' }] };
  const old = T.route_companies[idx];
  const merged = normalizeLink(Object.assign({}, old, input, { _id: id }));
  const r = T.routes.find((x) => x._id === merged.routeId);
  if (r) merged.routeKey = r.routeKey;
  merged.createdAt = old.createdAt;
  const errs = validateLink(merged);
  if (errs.length) return { ok: false, errors: errs };
  T.route_companies[idx] = merged;
  recountRoutes();
  return { ok: true, link: merged };
}

function deleteLink(id) {
  const idx = T.route_companies.findIndex((l) => l._id === id);
  if (idx < 0) return { ok: false, message: '关联不存在' };
  const removed = T.route_companies.splice(idx, 1)[0];
  recountRoutes();
  return { ok: true, link: removed };
}

/* ============================================================
 * 纠错队列
 * ============================================================ */

const CORRECTION_STATUS = ['pending', 'accepted', 'rejected', 'hold'];

function listCorrections(filter, page, pageSize) {
  const f = filter || {};
  const size = Number(pageSize) || 20;
  const p = Math.max(1, Number(page) || 1);
  let rows = T.corrections.slice();

  if (f.status) rows = rows.filter((c) => c.status === f.status);
  if (f.targetId) rows = rows.filter((c) => c.targetId === f.targetId);
  if (f.targetType) rows = rows.filter((c) => c.targetType === f.targetType);

  // 待审的按提交时间倒序（新反馈先看），已处理的也按时间倒序
  rows.sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));

  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / size));
  return { rows: rows.slice((p - 1) * size, p * size), total: total, page: p, pages: pages, pageSize: size };
}

/** 各状态计数（用于队列页的 tab 数字） */
function correctionCounts() {
  const out = { pending: 0, accepted: 0, rejected: 0, hold: 0, all: T.corrections.length };
  T.corrections.forEach((c) => {
    if (out[c.status] !== undefined) out[c.status]++;
  });
  return out;
}

/**
 * 审核一条纠错
 * @param {string} id
 * @param {string} status pending / accepted / rejected / hold
 * @param {string} note 审核备注
 *
 * ★ 采纳**不自动改数据**：PRD B6 说「采纳一条纠错并修改数据」，
 *   这里把「改数据」留给管理员点编辑进去改 —— 因为纠错内容通常是自然语言
 *   （「这个电话打不通」），机器无法据此确定新号码是什么。强行自动改会改错。
 *   所以采纳的语义是「这条反馈有效，已人工修正」，管理员在备注里记录改了什么。
 */
function reviewCorrection(id, status, note) {
  if (CORRECTION_STATUS.indexOf(status) < 0) {
    return { ok: false, message: '状态不合法' };
  }
  const c = T.corrections.find((x) => x._id === id);
  if (!c) return { ok: false, message: '纠错记录不存在' };
  c.status = status;
  c.reviewNote = String(note || '').trim();
  c.reviewedAt = Date.now();
  return { ok: true, correction: c };
}

function getCorrection(id) {
  return T.corrections.find((c) => c._id === id) || null;
}

/** 删除（清理无效反馈用） */
function deleteCorrection(id) {
  const idx = T.corrections.findIndex((c) => c._id === id);
  if (idx < 0) return { ok: false, message: '不存在' };
  const removed = T.corrections.splice(idx, 1)[0];
  return { ok: true, correction: removed };
}

/**
 * 从云数据库导出的纠错批量并入（供人工把线上反馈拉回本地处理）
 * 按 _id 去重，不覆盖已审核状态
 */
function mergeCorrections(rows) {
  if (!Array.isArray(rows)) return { added: 0, skipped: 0 };
  let added = 0;
  let skipped = 0;
  rows.forEach((r) => {
    if (!r || !r._id) { skipped++; return; }
    if (T.corrections.some((c) => c._id === r._id)) { skipped++; return; }
    T.corrections.push(Object.assign({ status: 'pending' }, r));
    added++;
  });
  return { added: added, skipped: skipped };
}

/* ============================================================
 * 运营位：公告 / 优质线路推广（2026-09-22 新增）
 *
 * ★ 这两张表是**纯运营内容**，不参与线路查询。但有三条硬校验不能省：
 *   1. 公告的 link 必须是以 / 开头的小程序页面路径 —— 外链在小程序里
 *      点了没反应（个人主体配不了业务域名），写了就是死按钮；
 *   2. 推广位的 routeKey 必须真实存在于 routes —— 否则首页会出现一张
 *      点进去是空页的卡片，比不显示更糟；
 *   3. 同一条线路只能有一个推广位 —— 否则首页会并排出现两张一样的卡。
 * ============================================================ */

const ANNOUNCEMENT_LEVEL_VALUES = validate.LEVEL_VALUES;

/** 排序：sortOrder 升序（越小越靠前），同序按更新时间倒序 */
function sortByOrder(list) {
  return list.slice().sort((a, b) => {
    const sa = Number(a.sortOrder) || 0;
    const sb = Number(b.sortOrder) || 0;
    if (sa !== sb) return sa - sb;
    return (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0);
  });
}

function listAnnouncements() {
  return sortByOrder(T.announcements);
}

function getAnnouncement(id) {
  return T.announcements.find((x) => x._id === id) || null;
}

function validateAnnouncement(input) {
  return validate.validateAnnouncement(input);
}

function createAnnouncement(input) {
  const errors = validateAnnouncement(input);
  if (errors.length) return { ok: false, errors: errors };

  const now = Date.now();
  const row = {
    _id: nextId('ann_', T.announcements),
    title: String(input.title).trim(),
    content: String(input.content).trim(),
    level: String(input.level || 'info').trim(),
    link: String(input.link || '').trim(),
    enabled: input.enabled === false ? false : true,
    sortOrder: Number(input.sortOrder) || 10,
    startAt: Number(input.startAt) || 0,
    endAt: Number(input.endAt) || 0,
    createdAt: now,
    updatedAt: now
  };
  T.announcements.push(row);
  return { ok: true, announcement: row };
}

function updateAnnouncement(id, input) {
  const row = T.announcements.find((x) => x._id === id);
  if (!row) return { ok: false, errors: [{ field: '_id', message: '公告不存在' }] };

  const merged = Object.assign({}, row, input || {}, { _id: id });
  const errors = validateAnnouncement(merged);
  if (errors.length) return { ok: false, errors: errors };

  row.title = String(merged.title).trim();
  row.content = String(merged.content).trim();
  row.level = String(merged.level || 'info').trim();
  row.link = String(merged.link || '').trim();
  row.enabled = merged.enabled === false ? false : true;
  row.sortOrder = Number(merged.sortOrder) || 10;
  row.startAt = Number(merged.startAt) || 0;
  row.endAt = Number(merged.endAt) || 0;
  row.updatedAt = Date.now();
  return { ok: true, announcement: row };
}

function deleteAnnouncement(id) {
  const idx = T.announcements.findIndex((x) => x._id === id);
  if (idx < 0) return { ok: false, message: '公告不存在' };
  const removed = T.announcements.splice(idx, 1)[0];
  return { ok: true, announcement: removed };
}

function listFeatured() {
  return sortByOrder(T.featured_routes);
}

function getFeatured(id) {
  return T.featured_routes.find((x) => x._id === id) || null;
}

function validateFeatured(input, ignoreId) {
  return validate.validateFeatured(input, {
    routes: T.routes,
    featured: T.featured_routes,
    ignoreId: ignoreId || null
  });
}

function createFeatured(input) {
  const errors = validateFeatured(input, null);
  if (errors.length) return { ok: false, errors: errors };

  const fromCity = String(input.fromCity).trim();
  const toCity = String(input.toCity).trim();
  const now = Date.now();
  const row = {
    _id: nextId('feat_', T.featured_routes),
    routeKey: common.buildRouteKey(fromCity, toCity),
    fromCity: fromCity,
    toCity: toCity,
    tag: String(input.tag).trim(),
    reason: String(input.reason || '').trim(),
    enabled: input.enabled === false ? false : true,
    sortOrder: Number(input.sortOrder) || 10,
    createdAt: now,
    updatedAt: now
  };
  T.featured_routes.push(row);
  return { ok: true, featured: row };
}

function updateFeatured(id, input) {
  const row = T.featured_routes.find((x) => x._id === id);
  if (!row) return { ok: false, errors: [{ field: '_id', message: '推广位不存在' }] };

  const merged = Object.assign({}, row, input || {}, { _id: id });
  const errors = validateFeatured(merged, id);
  if (errors.length) return { ok: false, errors: errors };

  row.fromCity = String(merged.fromCity).trim();
  row.toCity = String(merged.toCity).trim();
  row.routeKey = common.buildRouteKey(row.fromCity, row.toCity);
  row.tag = String(merged.tag).trim();
  row.reason = String(merged.reason || '').trim();
  row.enabled = merged.enabled === false ? false : true;
  row.sortOrder = Number(merged.sortOrder) || 10;
  row.updatedAt = Date.now();
  return { ok: true, featured: row };
}

function deleteFeatured(id) {
  const idx = T.featured_routes.findIndex((x) => x._id === id);
  if (idx < 0) return { ok: false, message: '推广位不存在' };
  const removed = T.featured_routes.splice(idx, 1)[0];
  return { ok: true, featured: removed };
}

/* ============================================================
 * 数据质量看板（PRD B8）
 * ============================================================ */

const STALE_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * 质量统计
 * ★ 这里的口径必须与 PRD B8 一致：「缺电话条数、超 90 天未更新条数」。
 */
function qualityStats(now) {
  const base = Number(now) || Date.now();

  const noPhone = T.companies.filter((c) => !c.phone);
  const noBackupPhone = T.companies.filter((c) => !c.backupPhone);
  const noStation = T.companies.filter((c) => !c.departureStations || !c.departureStations.length);
  const noAddress = T.companies.filter((c) => !c.address);
  const noIntro = T.companies.filter((c) => !c.intro);
  const notVerified = T.companies.filter((c) => !c.verified);
  const staleCompanies = T.companies.filter((c) => !c.updatedAt || base - Number(c.updatedAt) > STALE_MS);

  // 线路侧：时效缺失是必须盯的 —— 它直接影响「时效筛选」能不能用
  const noTransit = T.route_companies.filter((l) => {
    const d = Number(l.transitDays);
    return !isFinite(d) || d <= 0;
  });
  const noPrice = T.route_companies.filter((l) => !l.priceNote);
  const staleLinks = T.route_companies.filter((l) => !l.updatedAt || base - Number(l.updatedAt) > STALE_MS);

  // 一致性异常（这些是 bug，不是数据质量问题，单独列）
  const realCount = {};
  T.route_companies.forEach((l) => { realCount[l.routeId] = (realCount[l.routeId] || 0) + 1; });
  const countMismatch = T.routes.filter((r) => (realCount[r._id] || 0) !== r.companyCount);

  const orphanLinks = T.route_companies.filter(
    (l) => !T.routes.some((r) => r._id === l.routeId) || !T.companies.some((c) => c._id === l.companyId)
  );
  const emptyRoutes = T.routes.filter((r) => !(r.companyCount >= 1));

  const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);

  return {
    generatedAt: base,
    companies: {
      total: T.companies.length,
      noPhone: noPhone.length, noPhonePct: pct(noPhone.length, T.companies.length),
      noBackupPhone: noBackupPhone.length,
      noStation: noStation.length,
      noAddress: noAddress.length,
      noIntro: noIntro.length,
      notVerified: notVerified.length,
      stale: staleCompanies.length
    },
    routes: {
      total: T.routes.length,
      empty: emptyRoutes.length,
      countMismatch: countMismatch.length
    },
    links: {
      total: T.route_companies.length,
      noTransit: noTransit.length, noTransitPct: pct(noTransit.length, T.route_companies.length),
      noPrice: noPrice.length,
      stale: staleLinks.length,
      orphan: orphanLinks.length
    },
    corrections: correctionCounts(),
    /** 上线的硬门槛：这些必须为 0 */
    blocking: {
      countMismatch: countMismatch.length,
      orphan: orphanLinks.length,
      emptyRoutes: emptyRoutes.length
    },
    /** 明细，便于看板直接列出「是哪几条」 */
    details: {
      noPhone: noPhone.map((c) => ({ id: c._id, name: c.name })),
      staleCompanies: staleCompanies.map((c) => ({ id: c._id, name: c.name, updatedAt: c.updatedAt })),
      noTransit: noTransit.map((l) => ({ id: l._id, routeKey: l.routeKey })),
      countMismatch: countMismatch.map((r) => ({
        id: r._id, routeKey: r.routeKey, declared: r.companyCount, actual: realCount[r._id] || 0
      })),
      orphan: orphanLinks.map((l) => ({ id: l._id, routeId: l.routeId, companyId: l.companyId }))
    }
  };
}

/* ============================================================
 * 批量导入（PRD B2 / B3）
 * ============================================================ */

/**
 * 校验一批「公司+线路」扁平行，返回错误预览（不写任何数据）
 *
 * ★ 为什么先校验再导入：PRD B3 要求「明确标出错误行与原因，拒绝或跳过，
 *   不污染数据库」。所以导入是两阶段：preview → confirm。
 *
 * @param {Array<object>} rows 已按字段映射转成内部字段名的行
 * @returns {{valid:Array, invalid:Array, summary:object}}
 */
function validateImportRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const valid = [];
  const invalid = [];
  const seenCompany = {};   // 同一文件内公司名去重
  const seenPair = {};      // 同一文件内「公司@线路」去重

  list.forEach((row, i) => {
    const lineNo = i + 2;   // Excel 第 1 行是表头，数据从第 2 行起
    const errs = [];

    const name = String(row.name || '').trim();
    const fromCity = String(row.fromCity || '').trim();
    const toCity = String(row.toCity || '').trim();
    const phone = String(row.phone || '').trim();
    const frequency = String(row.frequency || '').trim();

    if (!name) errs.push('公司全称缺失');
    if (!fromCity) errs.push('出发城市缺失');
    if (!toCity) errs.push('到达城市缺失');
    if (fromCity && toCity && normCity(fromCity) === normCity(toCity)) {
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
    if (frequency && schema.FREQUENCY_OPTIONS.map((o) => o.value).indexOf(frequency) < 0) {
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

  return {
    valid: valid,
    invalid: invalid,
    summary: {
      total: list.length,
      validCount: valid.length,
      invalidCount: invalid.length,
      newCompanies: Object.keys(seenCompany).filter((n) => !T.companies.some((c) => c.name === n)).length,
      existingCompanies: Object.keys(seenCompany).filter((n) => T.companies.some((c) => c.name === n)).length,
      newRoutes: valid.filter((v) => !T.routes.some((r) => r.routeKey === v.routeKey)).length
    }
  };
}

/**
 * 执行导入（在 validateImportRows 通过的行上）
 * ★ 逐行独立：某行后续失败不影响已成功的行，返回值里报告每行结果。
 *   （PRD C1：导入 1000 条以上无丢失；独立处理才不会一行坏掉全批作废。）
 */
function applyImportRows(validRows) {
  const list = Array.isArray(validRows) ? validRows : [];
  const result = { created: 0, links: 0, updated: 0, failed: [] };

  // 先按公司聚合，避免同一公司多行时反复新建
  list.forEach((item) => {
    try {
      const row = item.row;
      const name = String(row.name || '').trim();

      let comp = T.companies.find((c) => c.name === name);
      if (!comp) {
        const created = createCompany({
          name: name,
          shortName: String(row.shortName || '').trim(),
          initial: String(row.initial || '').trim(),
          pinyin: String(row.pinyin || '').trim(),
          phone: String(row.phone || '').trim(),
          backupPhone: String(row.backupPhone || '').trim(),
          address: String(row.address || '').trim(),
          city: String(row.city || '').trim() || String(row.fromCity || '').trim(),
          province: String(row.province || '').trim(),
          scale: String(row.scale || 'small').trim(),
          intro: String(row.intro || '').trim(),
          verified: row.verified === true || row.verified === 'true'
        });
        if (!created.ok) {
          result.failed.push({ lineNo: item.lineNo, message: created.errors.map((e) => e.message).join('；') });
          return;
        }
        comp = created.company;
        result.created++;
      } else {
        result.updated++;
      }

      const route = ensureRoute(item.row.fromCity, item.row.toCity, {
        fromProvince: String(item.row.fromProvince || '').trim(),
        toProvince: String(item.row.toProvince || '').trim()
      });
      if (!route) {
        result.failed.push({ lineNo: item.lineNo, message: '线路无法建立（城市名归一后为空）' });
        return;
      }

      const created2 = createLink({
        routeId: route._id,
        companyId: comp._id,
        transitDays: item.row.transitDays,
        isDirect: item.row.isDirect,
        frequency: item.row.frequency,
        priceNote: String(item.row.priceNote || '').trim(),
        remark: String(item.row.remark || '').trim()
      });
      if (!created2.ok) {
        result.failed.push({ lineNo: item.lineNo, message: created2.errors.map((e) => e.message).join('；') });
        return;
      }
      result.links++;
    } catch (e) {
      result.failed.push({ lineNo: item.lineNo, message: (e && e.message) || String(e) });
    }
  });

  recountRoutes();
  return result;
}

module.exports = {
  // 常量
  FILE_COMPANIES, FILE_ROUTES, FILE_LINKS, FILE_CORRECTIONS,
  FILE_ANNOUNCEMENTS, FILE_FEATURED,
  STALE_MS, CORRECTION_STATUS,
  // 装载
  replaceAll, snapshot, tables,
  // 工具
  nextId, routeIdOf, recountRoutes, ensureRoute, normalizeStations, normalizeCompany,
  // 公司
  listCompanies, getCompany, createCompany, updateCompany, deleteCompany,
  // 线路
  listRoutes, getRoute, createRoute, updateRoute, deleteRoute, normalizeRoute,
  // 关联
  listLinks, getLink, createLink, updateLink, deleteLink, normalizeLink,
  // 纠错
  listCorrections, correctionCounts, reviewCorrection, getCorrection, deleteCorrection, mergeCorrections,
  // 运营位：公告 / 优质线路推广
  listAnnouncements, getAnnouncement, createAnnouncement, updateAnnouncement, deleteAnnouncement,
  validateAnnouncement, ANNOUNCEMENT_LEVEL_VALUES,
  listFeatured, getFeatured, createFeatured, updateFeatured, deleteFeatured, validateFeatured,
  // 质量
  qualityStats,
  // 导入
  validateImportRows, applyImportRows
};
