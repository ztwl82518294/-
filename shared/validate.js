/**
 * shared/validate.js —— 跨端共用的字段校验
 *
 * ★ 为什么抽出来：小程序端后台（云函数 adminApi）与桌面后台（admin/lib/store.js）
 *   必须给出**一模一样**的错误提示。以前校验只写在 store.js 里，云函数若要另写一份，
 *   两边迟早会漂（一边拦得住、一边拦不住）⇒ 脏数据从小程序端进来。
 *
 * ★ 设计取舍：一个函数同时做「字段校验」与「查表校验」，查表部分靠**可选的 ctx**。
 *   - 不传 ctx：只校验这条记录本身（字段级）。
 *   - 传 ctx（{ companies, routes, links, featured, ignoreId }）：连唯一性 / 外键存在性一起查。
 *   之所以不拆成两个函数，是为了**保持错误顺序与管理员看到的一致** ——
 *   「线路不存在」必须紧跟在「必须选择线路」后面，拆开就会跑到最后面去。
 *
 * ★ ctx 里传的是**数组**，不是数据库连接。云函数里查完库把结果塞进来即可，
 *   本模块不碰数据库 —— 这样它能在 Node 单元测试里直接跑。
 *
 * 部署提醒：云函数只上传自己的目录，用到本文件时要在云函数目录内放一份副本
 * （连同 shared/schema.js 与 utils/common.js，三者都是自包含的）。
 */

const common = require('../utils/common');
const schema = require('./schema');

/* ---- 枚举取值（从 schema 派生，不手抄） ---- */
const SCALE_VALUES = schema.SCALE_OPTIONS.map((o) => o.value);
const FREQUENCY_VALUES = schema.FREQUENCY_OPTIONS.map((o) => o.value);
const LEVEL_VALUES = schema.ANNOUNCEMENT_LEVELS.map((o) => o.value);

/** 长度上限：集中放这里，云函数与后台共用同一套数字，前端提示也引它 */
const LIMITS = {
  TITLE_MAX: 40,      // 公告标题（公告栏一行要显示完）
  TAG_MAX: 8,         // 推广位角标
  REASON_MAX: 60,     // 推广理由
  TRANSIT_DAYS_MAX: 60,
  CONTENT_MAX: 500,   // 公告正文
  INTRO_MAX: 200      // 公司简介
};

function err(field, message) {
  return { field: field, message: message };
}

function s(v) {
  return v === undefined || v === null ? '' : String(v);
}

/* ============================================================
 * 公司
 * ============================================================ */

/**
 * @param {object} c   已归一的公司记录
 * @param {object} [ctx] { companies: 全量公司数组 }
 */
function validateCompany(c, ctx) {
  const errs = [];
  if (!c.name) errs.push(err('name', '公司全称必填'));
  if (!c.city) errs.push(err('city', '所在城市必填'));

  if (!c.phone) errs.push(err('phone', '主电话必填'));
  else if (!common.isPhoneLike(c.phone)) {
    errs.push(err('phone', '主电话格式不正确'));
  }
  if (c.backupPhone && !common.isPhoneLike(c.backupPhone)) {
    errs.push(err('backupPhone', '备用电话格式不正确'));
  }
  if (SCALE_VALUES.indexOf(c.scale) < 0) {
    errs.push(err('scale', '规模取值不合法'));
  }

  const companies = (ctx && ctx.companies) || null;
  if (companies && companies.some((x) => x._id !== c._id && x.name === c.name)) {
    errs.push(err('name', '已存在同名公司'));
  }
  return errs;
}

/* ============================================================
 * 线路
 * ============================================================ */

/**
 * @param {object} r   已归一的线路记录（routeKey 应已派生）
 * @param {object} [ctx] { routes: 全量线路数组, ignoreId: 编辑时排除自身 }
 *
 * ★ 唯一性用 ctx.ignoreId 排除自身，**不能用 r._id**：
 *   线路 _id 是由 routeKey 派生的（`route_济南_广州`），新建一条已存在的线路时，
 *   新记录的 _id 与老记录**完全相同** ⇒ 用 `x._id !== r._id` 排除会把老记录也排掉，
 *   重复线路就永远拦不住了（这条断言在 admin.test.js 里守着）。
 */
function validateRoute(r, ctx) {
  const errs = [];
  const routeKey = r.routeKey === undefined || r.routeKey === null
    ? common.buildRouteKey(r.fromCity, r.toCity)
    : r.routeKey;

  if (!r.fromCity) errs.push(err('fromCity', '出发城市必填'));
  if (!r.toCity) errs.push(err('toCity', '到达城市必填'));
  if (r.fromCity && r.toCity && routeKey === '') {
    errs.push(err('toCity', '城市名归一后为空，请检查输入'));
  }
  if (r.fromCity && r.toCity && common.normCity(r.fromCity) === common.normCity(r.toCity)) {
    errs.push(err('toCity', '出发与到达不能是同一城市'));
  }

  const routes = (ctx && ctx.routes) || null;
  const ignoreId = (ctx && ctx.ignoreId) || null;
  if (routes && routeKey && routes.some((x) => x._id !== ignoreId && x.routeKey === routeKey)) {
    errs.push(err('toCity', '该线路已存在（' + routeKey + '）'));
  }
  return errs;
}

/* ============================================================
 * 关联（线路 × 公司）—— 承载时效 / 直达 / 频率
 * ============================================================ */

/**
 * @param {object} l   已归一的关联记录
 * @param {object} [ctx] { routes, companies, links }
 */
function validateLink(l, ctx) {
  const errs = [];
  const routes = (ctx && ctx.routes) || null;
  const companies = (ctx && ctx.companies) || null;
  const links = (ctx && ctx.links) || null;

  if (!l.routeId) errs.push(err('routeId', '必须选择线路'));
  else if (routes && !routes.some((r) => r._id === l.routeId)) {
    errs.push(err('routeId', '线路不存在'));
  }

  if (!l.companyId) errs.push(err('companyId', '必须选择公司'));
  else if (companies && !companies.some((c) => c._id === l.companyId)) {
    errs.push(err('companyId', '公司不存在'));
  }

  if (l.transitDays != null) {
    if (!isFinite(l.transitDays) || l.transitDays < 0) {
      errs.push(err('transitDays', '时效必须是非负数字（留空表示未知）'));
    } else if (l.transitDays > LIMITS.TRANSIT_DAYS_MAX) {
      errs.push(err('transitDays', '时效最多 60 天'));
    }
  }
  if (!l.frequency) errs.push(err('frequency', '请选择发车频率'));

  if (links && links.some((x) => x._id !== l._id && x.routeId === l.routeId && x.companyId === l.companyId)) {
    errs.push(err('companyId', '该公司已挂在这条线路上，请直接编辑原记录'));
  }
  return errs;
}

/* ============================================================
 * 公告（首页公告栏）
 * ============================================================ */

/**
 * ★ link 只允许空串或本小程序页面路径。外链在小程序里点了没反应
 *   （个人主体配不了业务域名），硬填就是死按钮 —— 必须在写入前拦掉。
 */
function validateAnnouncement(input) {
  const errors = [];
  const title = s(input && input.title).trim();
  const content = s(input && input.content).trim();
  const level = s((input && input.level) || 'info').trim();
  const link = s(input && input.link).trim();
  const startAt = Number((input && input.startAt) || 0);
  const endAt = Number((input && input.endAt) || 0);

  if (!title) errors.push(err('title', '公告标题不能为空'));
  else if (title.length > LIMITS.TITLE_MAX) {
    errors.push(err('title', '标题请控制在 ' + LIMITS.TITLE_MAX + ' 字以内（公告栏一行要显示完）'));
  }

  // 正文不能空：公告栏只显示标题，点开必须看到东西，否则用户会觉得「点了没反应」
  if (!content) errors.push(err('content', '公告正文不能为空（点开后要能看到内容）'));

  if (LEVEL_VALUES.indexOf(level) < 0) {
    errors.push(err('level', '公告级别不合法（可选：' + LEVEL_VALUES.join(' / ') + '）'));
  }
  if (link && link.charAt(0) !== '/') {
    errors.push(err('link', '跳转路径必须是 /pages/... 形式；外链在小程序里点了没反应，不要填'));
  }
  if (startAt && endAt && startAt > endAt) {
    errors.push(err('endAt', '失效时间不能早于生效时间'));
  }
  return errors;
}

/* ============================================================
 * 优质线路推广位（首页推广区块）
 * ============================================================ */

/**
 * @param {object} input   { fromCity, toCity, tag, reason }
 * @param {object} [ctx]   { routes, featured, ignoreId }
 *
 * ★ routeKey 一律现场派生，不采信传入值（与 normalizeRoute 同口径）。
 */
function validateFeatured(input, ctx) {
  const errors = [];
  const fromCity = s(input && input.fromCity).trim();
  const toCity = s(input && input.toCity).trim();
  const routeKey = common.buildRouteKey(fromCity, toCity);
  const tag = s(input && input.tag).trim();
  const reason = s(input && input.reason).trim();

  const routes = (ctx && ctx.routes) || null;
  const featured = (ctx && ctx.featured) || null;
  const ignoreId = (ctx && ctx.ignoreId) || null;

  if (!fromCity) errors.push(err('fromCity', '出发城市不能为空'));
  if (!toCity) errors.push(err('toCity', '到达城市不能为空'));
  /*
   * ★ 同城判断不能只靠 `!routeKey`：buildRouteKey 只在城市名为空时才返回空串，
   *   「济南 → 济南」照样派生出 '济南-济南'。原先只判 `!routeKey` ⇒ 同城推广位
   *   根本拦不住，只会在下面「线路库里还没有」那里被偶然拦到 —— 一旦库里真有这条
   *   脏线路就放过去了。这里补上显式比较（与 validateRoute 同口径，都过 normCity）。
   */
  if (fromCity && toCity && !routeKey) {
    errors.push(err('toCity', '出发与到达是同一城市'));
  } else if (fromCity && toCity && common.normCity(fromCity) === common.normCity(toCity)) {
    errors.push(err('toCity', '出发与到达是同一城市'));
  }

  /*
   * ★ 指向的线路必须真实存在。
   *   推广位卡片点进去就是线路详情，若线路不存在，用户看到的是一个空页 ——
   *   比首页少一张卡更伤信任。所以宁可在写入前拦下来，也不让它上线。
   */
  if (routes && routeKey && !routes.some((r) => r.routeKey === routeKey)) {
    errors.push(err('toCity', '线路库里还没有「' + routeKey + '」，请先到线路管理里添加'));
  }

  // 同一线路只能推广一次，否则首页会并排出现两张一模一样的卡
  if (featured && routeKey && featured.some((x) => x.routeKey === routeKey && x._id !== ignoreId)) {
    errors.push(err('routeKey', '这条线路已经在推广位里了'));
  }

  // 角标是卡片的识别点，空了就只剩一个数字，看着像没填完
  if (!tag) errors.push(err('tag', '角标不能为空，例如「天天发车」「直达」'));
  else if (tag.length > LIMITS.TAG_MAX) {
    errors.push(err('tag', '角标请控制在 ' + LIMITS.TAG_MAX + ' 字以内'));
  }

  if (reason.length > LIMITS.REASON_MAX) {
    errors.push(err('reason', '推荐理由请控制在 ' + LIMITS.REASON_MAX + ' 字以内'));
  }

  return errors;
}

module.exports = {
  LIMITS,
  SCALE_VALUES,
  FREQUENCY_VALUES,
  LEVEL_VALUES,
  validateCompany,
  validateRoute,
  validateLink,
  validateAnnouncement,
  validateFeatured
};
