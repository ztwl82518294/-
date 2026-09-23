/**
 * adminApi —— 小程序端后台的**唯一数据通道**
 *
 * ★★ 为什么必须走云函数，不能让小程序直接读写数据库：
 *   1. 云数据库默认权限是「仅创建者可读写」，管理员根本读不到别人创建的数据；
 *   2. 项目硬规定：**小程序页面里不允许出现 .collection(**（静态断言守着），
 *      所有数据访问必须经 utils/db.js；管理类操作更是必须收口到服务端；
 *   3. 最重要的 —— **身份必须在服务端校验**。若在前端判断「是不是管理员」，
 *      任何人改一下本地状态就能进后台。这里在云函数里比对 openid 白名单，
 *      前端拿不到也改不了。
 *
 * ★ 本云函数与桌面后台（admin/）共用同一套校验：
 *   shared/validate.js（字段校验）、shared/import.js（导入解析）、
 *   utils/common.js（routeKey 归一）、utils/search.js（公司搜索打分）。
 *   这些文件是**副本**，由 `node scripts/sync-cloud-shared.js` 同步，
 *   改了主仓库忘记同步会导致「本地能跑、云端旧逻辑」，所以自检里有 --check 那一步。
 *
 * ★ 异常一律不抛穿：统一返回 { ok:false, code, message }，
 *   避免把数据库堆栈暴露给调用方。
 */

const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const schema = require('./shared/schema');
const common = require('./utils/common');
const search = require('./utils/search');
const validate = require('./shared/validate');
const importer = require('./shared/import');

const C = schema.COLLECTIONS;

/* ============================================================
 * 管理员白名单
 * ============================================================ */

/**
 * ★★ 小程序端后台的管理员 openid 白名单。
 *
 * 怎么拿到自己的 openid：用微信打开小程序 → 进入后台管理页 →
 * 非管理员会直接显示自己的 openid → 复制填进下面这个数组 → 重新上传部署本云函数。
 *
 * ★ 白名单为空时**一律拒绝**（而不是放行）—— 留空就等着被人进后台改数据。
 * ★ openid 在同一个小程序里是固定的，换手机、重装微信都不变。
 */
const ADMIN_OPENIDS = [
  /*
   * ★★ 注意：行首带 // 的不算数（注释会被忽略）。往这里追加时**别留着 //** ——
   *    曾经就是因为「把示例行改了内容、却没删注释符」，看起来填好了、白名单其实还是空的。
   *    判据：`node scripts/check-deploy.js` 会报告「已配置 N 个管理员」。
   */
  'oxWBc15BpD7x2BR7O5u1O7TjBnGo'
];

/* ============================================================
 * 常量
 * ============================================================ */

/** 页面上的 type → 真实集合名 */
const COLLECTION_OF = {
  companies: C.COMPANIES,
  routes: C.ROUTES,
  links: C.ROUTE_COMPANIES,
  announcements: C.ANNOUNCEMENTS,
  featured: C.FEATURED_ROUTES,
  corrections: C.CORRECTIONS
};

const TYPES = Object.keys(COLLECTION_OF);

/** 云函数单次 get 上限（小程序端是 20，云函数是 100） */
const GET_LIMIT = 100;
/** 拉取全表的兜底轮数：100 × 60 = 6000 条，远超本项目数据量 */
const MAX_ROUNDS = 60;
/** 列表分页上限（防止前端传个巨大的 pageSize 拖垮云函数） */
const MAX_PAGE_SIZE = 50;
/** 文本框在服务端再截一次（前端 maxlength 可绕过） */
const TEXT_MAX = 500;
/** 超过这个天数没更新算「陈旧数据」 */
const STALE_MS = 90 * 24 * 60 * 60 * 1000;

/* ============================================================
 * 返回约定
 * ============================================================ */

function ok(data) {
  return Object.assign({ ok: true }, data || {});
}

function fail(code, message, extra) {
  return Object.assign({ ok: false, code: code, message: message }, extra || {});
}

/* ============================================================
 * 数据库小工具
 * ============================================================ */

/**
 * 拉取整张表
 * ★ 云函数里单次 get 最多 100 条，必须自己翻页。不翻页会「明明有 120 条只看到 100 」，
 *   而且不报错 —— 这类静默截断最难查。
 */
async function fetchAll(name) {
  let out = [];
  let skip = 0;
  for (let i = 0; i < MAX_ROUNDS; i++) {
    const res = await db.collection(name).skip(skip).limit(GET_LIMIT).get();
    const data = (res && res.data) || [];
    out = out.concat(data);
    if (data.length < GET_LIMIT) break;
    skip += data.length;
  }
  return out;
}

/** 按字段批量删除（级联删关联时用） */
async function removeWhere(name, field, value) {
  const where = {};
  where[field] = value;
  const res = await db.collection(name).where(where).remove();
  return (res && res.stats && res.stats.removed) || 0;
}

/** update 的 data 里不能带 _id */
function withoutId(row) {
  const out = {};
  Object.keys(row).forEach((k) => {
    if (k === '_id') return;
    out[k] = row[k];
  });
  return out;
}

function clip(v, max) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * 从映射表里取值，**只认自有属性**
 *
 * ★★ 不能写成 `map[key]` 再判真假：'constructor' / '__proto__' / 'toString'
 *   这些键不在表里，但会顺着原型链取到真值 ⇒ 白名单被绕过，
 *   攻击者传 action=constructor 就能让分发逻辑调用到 Object 构造函数。
 *   与 submitCorrection 里 TYPE_MAP 的修法是同一个坑。
 */
function pick(map, key) {
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null;
}

function num(v, dft) {
  const n = Number(v);
  return isFinite(n) ? n : (dft === undefined ? 0 : dft);
}

function newId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/* ============================================================
 * 归一（与桌面后台 admin/lib/store.js 同口径）
 * ============================================================ */

function normalizeStations(v) {
  if (Array.isArray(v)) {
    const out = [];
    for (let i = 0; i < v.length; i++) {
      const s = v[i];
      let item = null;
      if (typeof s === 'string') {
        item = common.parseStationRow(s);
      } else if (s && typeof s === 'object') {
        const address = String(s.address || '').trim();
        const phone = String(s.phone || '').trim();
        if (address || phone) item = { address: address, phone: phone };
      }
      if (item) out.push(item);
    }
    return out;
  }
  if (typeof v === 'string' && v.trim()) {
    const p = common.parseStationRow(v);
    return p ? [{ address: p.address, phone: p.phone }] : [];
  }
  return [];
}

function normalizeCompany(input, id) {
  const raw = input || {};
  const now = Date.now();
  return {
    _id: id || newId('comp_'),
    name: clip(raw.name, 100).trim(),
    shortName: clip(raw.shortName, 60).trim(),
    initial: clip(raw.initial, 30).trim().toLowerCase(),
    pinyin: clip(raw.pinyin, 60).trim().toLowerCase(),
    phone: clip(raw.phone, 40).trim(),
    backupPhone: clip(raw.backupPhone, 40).trim(),
    address: clip(raw.address, 200).trim(),
    city: clip(raw.city, 40).trim(),
    province: clip(raw.province, 40).trim(),
    scale: String(raw.scale || 'small').trim(),
    intro: clip(raw.intro, TEXT_MAX).trim(),
    verified: raw.verified === true || raw.verified === 'true',
    departureStations: normalizeStations(raw.departureStations),
    arrivalStations: normalizeStations(raw.arrivalStations),
    viewCount: num(raw.viewCount, 0),
    createdAt: num(raw.createdAt, now),
    updatedAt: now
  };
}

function normalizeRoute(input) {
  const raw = input || {};
  const now = Date.now();
  const fromCity = String(raw.fromCity || '').trim();
  const toCity = String(raw.toCity || '').trim();
  const routeKey = common.buildRouteKey(fromCity, toCity);
  return {
    // ★ routeKey 一律重新派生、_id 由 routeKey 派生 —— 不采信前端传入，防脏 key
    _id: 'route_' + routeKey.replace(/-/g, '_'),
    fromCity: fromCity,
    fromProvince: String(raw.fromProvince || '').trim(),
    toCity: toCity,
    toProvince: String(raw.toProvince || '').trim(),
    routeKey: routeKey,
    companyCount: num(raw.companyCount, 0),
    createdAt: num(raw.createdAt, now),
    updatedAt: now
  };
}

function normalizeLink(input, id) {
  const raw = input || {};
  const now = Date.now();
  const freq = String(raw.frequency || '').trim();
  const allowed = validate.FREQUENCY_VALUES;
  const days = raw.transitDays === '' || raw.transitDays === null || raw.transitDays === undefined
    ? null : Number(raw.transitDays);
  return {
    _id: id || newId('rc_'),
    routeId: String(raw.routeId || '').trim(),
    companyId: String(raw.companyId || '').trim(),
    routeKey: String(raw.routeKey || '').trim(),
    transitDays: days,
    isDirect: raw.isDirect === true || raw.isDirect === 'true',
    frequency: allowed.indexOf(freq) >= 0 ? freq : '',
    priceNote: clip(raw.priceNote, 100).trim(),
    remark: clip(raw.remark, TEXT_MAX).trim(),
    createdAt: num(raw.createdAt, now),
    updatedAt: now
  };
}

function normalizeAnnouncement(input, id) {
  const raw = input || {};
  const now = Date.now();
  return {
    _id: id || newId('ann_'),
    title: clip(raw.title, 60).trim(),
    content: clip(raw.content, TEXT_MAX).trim(),
    level: String(raw.level || 'info').trim(),
    link: String(raw.link || '').trim(),
    enabled: raw.enabled === false ? false : true,
    sortOrder: num(raw.sortOrder, 10),
    startAt: num(raw.startAt, 0),
    endAt: num(raw.endAt, 0),
    createdAt: num(raw.createdAt, now),
    updatedAt: now
  };
}

function normalizeFeatured(input, id) {
  const raw = input || {};
  const now = Date.now();
  const fromCity = String(raw.fromCity || '').trim();
  const toCity = String(raw.toCity || '').trim();
  return {
    _id: id || newId('feat_'),
    routeKey: common.buildRouteKey(fromCity, toCity),
    fromCity: fromCity,
    toCity: toCity,
    tag: clip(raw.tag, 16).trim(),
    reason: clip(raw.reason, 80).trim(),
    enabled: raw.enabled === false ? false : true,
    sortOrder: num(raw.sortOrder, 10),
    createdAt: num(raw.createdAt, now),
    updatedAt: now
  };
}

/* ============================================================
 * 级联维护
 * ============================================================ */

/**
 * 重算全部线路的 companyCount
 * ★ 与桌面后台同口径：增量 +=1/-=1 迟早会漂（导入、级联删除、手工编辑都会改），
 *   所以一律重算。
 */
async function recountRoutes() {
  const routes = await fetchAll(C.ROUTES);
  const links = await fetchAll(C.ROUTE_COMPANIES);
  const cnt = {};
  links.forEach((l) => { cnt[l.routeId] = (cnt[l.routeId] || 0) + 1; });

  let changed = 0;
  for (let i = 0; i < routes.length; i++) {
    const r = routes[i];
    const actual = cnt[r._id] || 0;
    if (r.companyCount === actual) continue;
    await db.collection(C.ROUTES).doc(r._id).update({ data: { companyCount: actual } });
    changed++;
  }
  return changed;
}

/* ============================================================
 * 各表的保存 / 删除
 * ============================================================ */

async function saveCompany(id, input) {
  const companies = await fetchAll(C.COMPANIES);
  const row = normalizeCompany(input, id);

  const errs = validate.validateCompany(row, { companies: companies });
  if (errs.length) return fail('INVALID', '数据未通过校验', { errors: errs });

  if (id) {
    const old = findById(companies, id);
    if (!old) return fail('NOT_FOUND', '公司不存在');
    row.createdAt = old.createdAt;         // 编辑不改创建时间
    await db.collection(C.COMPANIES).doc(id).update({ data: withoutId(row) });
  } else {
    await db.collection(C.COMPANIES).add({ data: row });
  }
  return ok({ id: row._id, company: row });
}

async function removeCompany(id) {
  await db.collection(C.COMPANIES).doc(id).remove();
  const cascaded = await removeWhere(C.ROUTE_COMPANIES, 'companyId', id);
  // ★ 级联删完必须重算，否则线路详情的「N 家公司」会与列表条数对不上
  await recountRoutes();
  return ok({ id: id, cascadedLinks: cascaded });
}

async function saveRoute(id, input) {
  const routes = await fetchAll(C.ROUTES);
  const row = normalizeRoute(input);

  const errs = validate.validateRoute(row, { routes: routes, ignoreId: id || null });
  if (errs.length) return fail('INVALID', '数据未通过校验', { errors: errs });

  if (id) {
    const old = findById(routes, id);
    if (!old) return fail('NOT_FOUND', '线路不存在');
    row.createdAt = old.createdAt;

    /*
     * ★ 改城市会同时换 routeKey 与 _id，必须同步所有关联的 routeId / routeKey，
     *   否则关联指向一个不存在的线路 —— 小程序端直接死链。
     * ★ _id 变了不能只 update（会写入一个 _id 与主键冲突的文档），
     *   要「删旧 + 建新」。
     */
    if (old._id !== row._id) {
      await db.collection(C.ROUTES).doc(old._id).remove();
      await db.collection(C.ROUTES).add({ data: row });
      const links = await fetchAll(C.ROUTE_COMPANIES);
      for (let i = 0; i < links.length; i++) {
        if (links[i].routeId !== old._id) continue;
        await db.collection(C.ROUTE_COMPANIES).doc(links[i]._id)
          .update({ data: { routeId: row._id, routeKey: row.routeKey } });
      }
      await recountRoutes();
    } else if (old.routeKey !== row.routeKey) {
      await db.collection(C.ROUTES).doc(id).update({ data: withoutId(row) });
      const links = await fetchAll(C.ROUTE_COMPANIES);
      for (let i = 0; i < links.length; i++) {
        if (links[i].routeId !== id) continue;
        await db.collection(C.ROUTE_COMPANIES).doc(links[i]._id)
          .update({ data: { routeKey: row.routeKey } });
      }
    } else {
      await db.collection(C.ROUTES).doc(id).update({ data: withoutId(row) });
    }
  } else {
    await db.collection(C.ROUTES).add({ data: row });
  }
  return ok({ id: row._id, route: row });
}

async function removeRoute(id) {
  await db.collection(C.ROUTES).doc(id).remove();
  const cascaded = await removeWhere(C.ROUTE_COMPANIES, 'routeId', id);
  await recountRoutes();
  return ok({ id: id, cascadedLinks: cascaded });
}

async function saveLink(id, input) {
  const routes = await fetchAll(C.ROUTES);
  const companies = await fetchAll(C.COMPANIES);
  const links = await fetchAll(C.ROUTE_COMPANIES);

  const row = normalizeLink(input, id);
  // ★ routeKey 由线路现场派生，不采信前端传入（防「关联写的 key 与线路对不上」）
  const route = findById(routes, row.routeId);
  row.routeKey = route ? route.routeKey : '';

  const errs = validate.validateLink(row, { routes: routes, companies: companies, links: links });
  if (errs.length) return fail('INVALID', '数据未通过校验', { errors: errs });

  if (id) {
    const old = findById(links, id);
    if (!old) return fail('NOT_FOUND', '关联不存在');
    row.createdAt = old.createdAt;
    await db.collection(C.ROUTE_COMPANIES).doc(id).update({ data: withoutId(row) });
  } else {
    await db.collection(C.ROUTE_COMPANIES).add({ data: row });
  }
  await recountRoutes();
  return ok({ id: row._id, link: row });
}

async function removeLink(id) {
  await db.collection(C.ROUTE_COMPANIES).doc(id).remove();
  await recountRoutes();
  return ok({ id: id });
}

async function saveAnnouncement(id, input) {
  const row = normalizeAnnouncement(input, id);
  const errs = validate.validateAnnouncement(row);
  if (errs.length) return fail('INVALID', '数据未通过校验', { errors: errs });

  if (id) {
    row.createdAt = num(input && input.createdAt, Date.now());
    await db.collection(C.ANNOUNCEMENTS).doc(id).update({ data: withoutId(row) });
  } else {
    await db.collection(C.ANNOUNCEMENTS).add({ data: row });
  }
  return ok({ id: row._id, announcement: row });
}

async function saveFeatured(id, input) {
  const routes = await fetchAll(C.ROUTES);
  const featured = await fetchAll(C.FEATURED_ROUTES);
  const row = normalizeFeatured(input, id);

  const errs = validate.validateFeatured(row, {
    routes: routes,
    featured: featured,
    ignoreId: id || null
  });
  if (errs.length) return fail('INVALID', '数据未通过校验', { errors: errs });

  if (id) {
    row.createdAt = num(input && input.createdAt, Date.now());
    await db.collection(C.FEATURED_ROUTES).doc(id).update({ data: withoutId(row) });
  } else {
    await db.collection(C.FEATURED_ROUTES).add({ data: row });
  }
  return ok({ id: row._id, featured: row });
}

/** 纠错：只允许改审核状态与备注（内容是用户提交的凭证，不改） */
async function reviewCorrection(id, status, note) {
  const allowed = [
    schema.CORRECTION_STATUS.PENDING,
    schema.CORRECTION_STATUS.ACCEPTED,
    schema.CORRECTION_STATUS.REJECTED,
    schema.CORRECTION_STATUS.HOLD
  ];
  if (allowed.indexOf(status) < 0) return fail('INVALID', '状态不合法');

  const mine = await db.collection(C.CORRECTIONS).doc(id).get().catch(() => null);
  if (!mine || !mine.data) return fail('NOT_FOUND', '纠错记录不存在');

  await db.collection(C.CORRECTIONS).doc(id).update({
    data: {
      status: status,
      rejectReason: clip(note, 200),
      handledAt: Date.now(),
      handledBy: 'admin'
    }
  });
  return ok({ id: id, status: status });
}

/* ============================================================
 * 列表
 * ============================================================ */

function findById(list, id) {
  for (let i = 0; i < list.length; i++) if (list[i]._id === id) return list[i];
  return null;
}

async function listCompanies(kw, page, pageSize) {
  const rows = await fetchAll(C.COMPANIES);
  const q = String(kw || '').trim();
  let list = q ? search.searchCompanies(rows, q) : rows.slice();

  if (!q) {
    list.sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
  }
  return paginate(list, page, pageSize);
}

async function listRoutes(kw, page, pageSize) {
  const rows = await fetchAll(C.ROUTES);
  const q = String(kw || '').trim().toLowerCase();
  let list = rows;
  if (q) {
    list = rows.filter((r) => {
      const hay = (r.routeKey + ' ' + r.fromCity + ' ' + r.toCity + ' ' +
        (r.fromProvince || '') + ' ' + (r.toProvince || '')).toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  // 公司多的排前面（更主流），再按更新时间 —— 与桌面后台同口径
  list = list.slice().sort((a, b) => {
    if ((b.companyCount || 0) !== (a.companyCount || 0)) return (b.companyCount || 0) - (a.companyCount || 0);
    return (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0);
  });
  return paginate(list, page, pageSize);
}

async function listLinks(kw, page, pageSize) {
  const routes = await fetchAll(C.ROUTES);
  const companies = await fetchAll(C.COMPANIES);
  const links = await fetchAll(C.ROUTE_COMPANIES);
  const rMap = {};
  const cMap = {};
  routes.forEach((r) => { rMap[r._id] = r; });
  companies.forEach((c) => { cMap[c._id] = c; });

  const q = String(kw || '').trim().toLowerCase();
  let list = links.map((l) => ({
    link: l,
    route: rMap[l.routeId] || null,
    company: cMap[l.companyId] || null
  }));

  if (q) {
    list = list.filter((x) => {
      const hay = ((x.route && x.route.routeKey) || '') + ' ' +
        ((x.company && x.company.name) || '') + ' ' + (x.link.remark || '');
      return hay.toLowerCase().indexOf(q) >= 0;
    });
  }
  list.sort((a, b) => (Number(b.link.updatedAt) || 0) - (Number(a.link.updatedAt) || 0));
  return paginate(list, page, pageSize);
}

async function listAnnouncements(page, pageSize) {
  const rows = await fetchAll(C.ANNOUNCEMENTS);
  return paginate(sortByOrder(rows), page, pageSize);
}

async function listFeatured(page, pageSize) {
  const rows = await fetchAll(C.FEATURED_ROUTES);
  return paginate(sortByOrder(rows), page, pageSize);
}

async function listCorrections(filter, page, pageSize) {
  const f = filter || {};
  let rows = await fetchAll(C.CORRECTIONS);
  if (f.status) rows = rows.filter((c) => c.status === f.status);
  if (f.targetId) rows = rows.filter((c) => c.targetId === f.targetId);
  if (f.targetType) rows = rows.filter((c) => c.targetType === f.targetType);
  rows.sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
  return paginate(rows, page, pageSize);
}

function sortByOrder(list) {
  return list.slice().sort((a, b) => {
    const sa = Number(a.sortOrder) || 0;
    const sb = Number(b.sortOrder) || 0;
    if (sa !== sb) return sa - sb;
    return (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0);
  });
}

function paginate(list, page, pageSize) {
  const size = Math.min(Math.max(1, num(pageSize, 20)), MAX_PAGE_SIZE);
  const p = Math.max(1, num(page, 1));
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / size));
  return {
    rows: list.slice((p - 1) * size, p * size),
    total: total,
    page: p,
    pages: pages,
    pageSize: size
  };
}

/* ============================================================
 * 总览 / 质量看板
 * ============================================================ */

async function overview() {
  const companies = await fetchAll(C.COMPANIES);
  const routes = await fetchAll(C.ROUTES);
  const links = await fetchAll(C.ROUTE_COMPANIES);
  const corrections = await fetchAll(C.CORRECTIONS);
  const announcements = await fetchAll(C.ANNOUNCEMENTS);
  const featured = await fetchAll(C.FEATURED_ROUTES);

  let pending = 0;
  corrections.forEach((c) => { if (c.status === schema.CORRECTION_STATUS.PENDING) pending++; });

  const q = computeQuality(companies, routes, links, corrections, Date.now());

  return ok({
    counts: {
      companies: companies.length,
      routes: routes.length,
      links: links.length,
      corrections: corrections.length,
      pendingCorrections: pending,
      announcements: announcements.length,
      featured: featured.length
    },
    blocking: q.blocking
  });
}

/**
 * 质量统计（与桌面后台 admin/lib/store.js 的 qualityStats 同口径）
 * 纯计算，不查库 —— 便于单测直接喂数组。
 */
function computeQuality(companies, routes, links, corrections, now) {
  const base = Number(now) || Date.now();
  const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);

  const noPhone = companies.filter((c) => !c.phone);
  const staleCompanies = companies.filter((c) => !c.updatedAt || base - Number(c.updatedAt) > STALE_MS);
  const noTransit = links.filter((l) => {
    const d = Number(l.transitDays);
    return !isFinite(d) || d <= 0;
  });

  const realCount = {};
  links.forEach((l) => { realCount[l.routeId] = (realCount[l.routeId] || 0) + 1; });
  const countMismatch = routes.filter((r) => (realCount[r._id] || 0) !== r.companyCount);
  const emptyRoutes = routes.filter((r) => !(r.companyCount >= 1));
  const orphanLinks = links.filter(
    (l) => !findById(routes, l.routeId) || !findById(companies, l.companyId)
  );

  const counts = { pending: 0, accepted: 0, rejected: 0, hold: 0, all: corrections.length };
  corrections.forEach((c) => { if (counts[c.status] !== undefined) counts[c.status]++; });

  return {
    companies: {
      total: companies.length,
      noPhone: noPhone.length,
      noPhonePct: pct(noPhone.length, companies.length),
      stale: staleCompanies.length
    },
    routes: {
      total: routes.length,
      empty: emptyRoutes.length,
      countMismatch: countMismatch.length
    },
    links: {
      total: links.length,
      noTransit: noTransit.length,
      noTransitPct: pct(noTransit.length, links.length),
      orphan: orphanLinks.length
    },
    corrections: counts,
    /** 上线的硬门槛：这些必须为 0 */
    blocking: {
      countMismatch: countMismatch.length,
      orphan: orphanLinks.length,
      emptyRoutes: emptyRoutes.length
    },
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

async function quality() {
  const companies = await fetchAll(C.COMPANIES);
  const routes = await fetchAll(C.ROUTES);
  const links = await fetchAll(C.ROUTE_COMPANIES);
  const corrections = await fetchAll(C.CORRECTIONS);
  return ok({ quality: computeQuality(companies, routes, links, corrections, Date.now()) });
}

/* ============================================================
 * 批量导入（两阶段：预览 → 确认）
 * ============================================================ */

/**
 * 预览：解析 CSV → 行校验 → 返回错误行（**不写任何数据**）
 * ★ 与桌面后台共用 shared/import.js 的解析与校验，口径一致。
 */
async function importPreview(text) {
  const parsed = importer.parseCsvToRows(text);
  if (!parsed.rows.length) {
    return fail('EMPTY', '没有解析出任何数据行，请检查文件内容');
  }
  const companies = await fetchAll(C.COMPANIES);
  const routes = await fetchAll(C.ROUTES);
  const check = importer.validateImportRows(parsed.rows, { companies: companies, routes: routes });
  return ok({
    headers: parsed.headers,
    mapping: parsed.mapping,
    valid: check.valid,
    invalid: check.invalid,
    summary: check.summary
  });
}

/**
 * 确认导入
 * ★ 逐行独立：某行失败不影响已成功的行（PRD C1：导入不该一行坏掉全批作废）。
 */
async function importCommit(text) {
  const parsed = importer.parseCsvToRows(text);
  if (!parsed.rows.length) return fail('EMPTY', '没有解析出任何数据行');

  const companies = await fetchAll(C.COMPANIES);
  const routes = await fetchAll(C.ROUTES);
  const links = await fetchAll(C.ROUTE_COMPANIES);

  const check = importer.validateImportRows(parsed.rows, { companies: companies, routes: routes });
  const result = { created: 0, links: 0, updated: 0, failed: [] };

  for (let i = 0; i < check.valid.length; i++) {
    const item = check.valid[i];
    const row = item.row;
    const name = String(row.name || '').trim();

    try {
      let comp = companies.filter((c) => c.name === name)[0] || null;
      if (!comp) {
        const built = normalizeCompany({
          name: name,
          shortName: row.shortName,
          initial: row.initial,
          pinyin: row.pinyin,
          phone: row.phone,
          backupPhone: row.backupPhone,
          address: row.address,
          city: row.city || row.fromCity,
          province: row.province,
          scale: row.scale,
          intro: row.intro,
          verified: row.verified
        }, null);
        const errs = validate.validateCompany(built, { companies: companies });
        if (errs.length) {
          result.failed.push({ lineNo: item.lineNo, message: errs.map((e) => e.message).join('；') });
          continue;
        }
        await db.collection(C.COMPANIES).add({ data: built });
        companies.push(built);
        comp = built;
        result.created++;
      } else {
        result.updated++;
      }

      // 线路：按 routeKey 去重，不存在则建
      let route = routes.filter((r) => r.routeKey === item.routeKey)[0] || null;
      if (!route) {
        route = normalizeRoute({
          fromCity: row.fromCity,
          toCity: row.toCity,
          fromProvince: row.fromProvince,
          toProvince: row.toProvince
        });
        if (!route.routeKey) {
          result.failed.push({ lineNo: item.lineNo, message: '线路无法建立（城市名归一后为空）' });
          continue;
        }
        await db.collection(C.ROUTES).add({ data: route });
        routes.push(route);
      }

      const built2 = normalizeLink({
        routeId: route._id,
        companyId: comp._id,
        transitDays: row.transitDays,
        isDirect: row.isDirect,
        frequency: row.frequency || '',
        priceNote: row.priceNote,
        remark: row.remark
      }, null);
      const errs2 = validate.validateLink(built2, {
        routes: routes, companies: companies, links: links
      });
      if (errs2.length) {
        result.failed.push({ lineNo: item.lineNo, message: errs2.map((e) => e.message).join('；') });
        continue;
      }
      await db.collection(C.ROUTE_COMPANIES).add({ data: built2 });
      links.push(built2);
      result.links++;
    } catch (e) {
      result.failed.push({ lineNo: item.lineNo, message: '写入失败' });
    }
  }

  await recountRoutes();
  return ok({ result: result, summary: check.summary });
}

/* ============================================================
 * action 分发
 * ============================================================ */

const SAVE = {
  companies: saveCompany,
  routes: saveRoute,
  links: saveLink,
  announcements: saveAnnouncement,
  featured: saveFeatured
};

const REMOVE = {
  companies: removeCompany,
  routes: removeRoute,
  links: removeLink,
  announcements: removeAnnouncement,
  featured: removeFeatured,
  corrections: removeCorrection
};

const LIST = {
  companies: (e) => listCompanies(e.kw, e.page, e.pageSize),
  routes: (e) => listRoutes(e.kw, e.page, e.pageSize),
  links: (e) => listLinks(e.kw, e.page, e.pageSize),
  announcements: (e) => listAnnouncements(e.page, e.pageSize),
  featured: (e) => listFeatured(e.page, e.pageSize),
  corrections: (e) => listCorrections({ status: e.status, targetId: e.targetId, targetType: e.targetType }, e.page, e.pageSize)
};

async function removeAnnouncement(id) {
  await db.collection(C.ANNOUNCEMENTS).doc(id).remove();
  return ok({ id: id });
}

async function removeFeatured(id) {
  await db.collection(C.FEATURED_ROUTES).doc(id).remove();
  return ok({ id: id });
}

async function removeCorrection(id) {
  await db.collection(C.CORRECTIONS).doc(id).remove();
  return ok({ id: id });
}

async function handleGet(e) {
  const type = String(e.type || '');
  const col = pick(COLLECTION_OF, type);
  if (!col) return fail('BAD_TYPE', '未知的数据类型');
  const id = String(e.id || '');
  if (!id) return fail('BAD_ID', '缺少 id');
  const res = await db.collection(col).doc(id).get().catch(() => null);
  if (!res || !res.data) return fail('NOT_FOUND', '记录不存在');
  return ok({ row: res.data });
}

async function handleSave(e) {
  const type = String(e.type || '');
  const save = pick(SAVE, type);
  if (!save) return fail('BAD_TYPE', '未知的数据类型');
  const id = String(e.id || '');
  return save(id || null, e.data || {});
}

async function handleRemove(e) {
  const type = String(e.type || '');
  const rm = pick(REMOVE, type);
  if (!rm) return fail('BAD_TYPE', '未知的数据类型');
  const id = String(e.id || '');
  if (!id) return fail('BAD_ID', '缺少 id');
  return rm(id);
}

async function handleList(e) {
  const type = String(e.type || '');
  const lister = pick(LIST, type);
  if (!lister) return fail('BAD_TYPE', '未知的数据类型');
  const paged = await lister(e);
  return ok(paged);
}

/** 选项数据：给编辑页的下拉用（线路列表、公司列表） */
async function options() {
  const routes = await fetchAll(C.ROUTES);
  const companies = await fetchAll(C.COMPANIES);
  return ok({
    routes: routes.map((r) => ({ id: r._id, label: r.routeKey })),
    companies: companies.map((c) => ({ id: c._id, label: c.name }))
  });
}

const ACTIONS = {
  whoami: async () => null,          // 特殊：不校验管理员，下面单独处理
  overview: overview,
  quality: quality,
  options: options,
  list: handleList,
  get: handleGet,
  save: handleSave,
  remove: handleRemove,
  review: (e) => reviewCorrection(String(e.id || ''), String(e.status || ''), e.note),
  importPreview: (e) => importPreview(String(e.text || '')),
  importCommit: (e) => importCommit(String(e.text || ''))
};

/* ============================================================
 * 入口
 * ============================================================ */

function adminCheck(openid) {
  if (!ADMIN_OPENIDS.length) {
    return fail('NOT_CONFIGURED', '尚未配置管理员：请在云函数 adminApi/index.js 的 ADMIN_OPENIDS 里填入管理员 openid 后重新上传部署');
  }
  if (ADMIN_OPENIDS.indexOf(openid) < 0) {
    return fail('NOT_ADMIN', '你没有后台管理权限');
  }
  return null;
}

exports.main = async (event) => {
  const e = event || {};
  const openid = (cloud.getWXContext() || {}).OPENID || '';

  if (!openid) return fail('NO_OPENID', '无法识别身份，请重新进入小程序');

  const action = String(e.action || '').trim();
  const handler = pick(ACTIONS, action);
  if (!handler) return fail('BAD_ACTION', '不支持的操作：' + action);

  /*
   * whoami 是唯一不校验管理员的 action —— 页面要靠它显示「你的 openid 是 xxx」，
   * 否则用户无从得知该把哪个字符串填进白名单。
   */
  if (action === 'whoami') {
    const denied = adminCheck(openid);
    return ok({ openid: openid, isAdmin: !denied, code: denied ? denied.code : 'ADMIN' });
  }

  const denied = adminCheck(openid);
  if (denied) return denied;

  try {
    const res = await handler(e);
    return res || ok({});
  } catch (err) {
    // ★ 不抛穿：把堆栈返回给前端等于暴露数据库结构
    return fail('INTERNAL', '操作失败，请重试');
  }
};

/**
 * 暴露白名单引用，供单元测试注入管理员。
 * ★ 云端唯一入口是 exports.main，外部无法调用到这里；数组是引用，
 *   测试里 push 进去即可，不必在源码里留测试专用分支。
 */
module.exports.ADMIN_OPENIDS = ADMIN_OPENIDS;
