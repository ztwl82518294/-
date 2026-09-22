#!/usr/bin/env node
/**
 * 首页改版测试（2026-09-22 五项改动里的第 2/3/4 项）
 *
 * 覆盖三件事：
 *   1. 区县（第 4 项）—— utils/area.js 的归属、反查、重名消歧、混合搜索
 *   2. 公告栏（第 2 项）—— 默认内容合规（有正文、链接不外链）、后台校验
 *   3. 优质线路推广（第 3 项）—— routeKey 必须真实存在、不可重复、角标必填
 *
 * ★ 为什么这些要写成断言而不是「看着没毛病」：
 *   这三类错误的共同点是**页面不报错，只是功能不对**：
 *   - 推广位指向不存在的线路 → 首页卡片点进去是空页；
 *   - 公告填了外链 → 点了没反应（个人主体跳不出去）；
 *   - 区县反查错城市 → 用户选「朝阳区」结果查的是别的城市。
 *   这三类都只能靠断言发现，肉眼看页面是看不出来的。
 */

const path = require('path');

const { describe, test, eq, ok, deepEq, summary } = require('../framework');

const ROOT = path.join(__dirname, '..', '..');
const area = require(path.join(ROOT, 'utils/area.js'));
const common = require(path.join(ROOT, 'utils/common.js'));
const seed = require(path.join(ROOT, 'data/seed-data.js'));
const defaults = require(path.join(ROOT, 'data/announcements.js'));
const store = require(path.join(ROOT, 'admin/lib/store.js'));
const { CITIES } = require(path.join(ROOT, 'data/cities.js'));

/**
 * 每个 describe 前重置成一份干净的样板数据（store 是纯内存的）
 *
 * ★ withOps=false 用于测「增删改」：seed 自带 4 条公告 / 6 个推广位，
 *   带着它们测「创建后列表长度 = 1」必然失败 —— 那是**断言写错了**，
 *   不是功能错了（真实后台启动时本来就有样板运营位）。
 *   所以 CRUD 用例用空运营位 + 全量线路库，这才是「新建」的真实场景。
 */
function freshSeed(withOps) {
  const t = seed.buildTables();
  const wantOps = withOps !== false;
  store.replaceAll({
    companies: t.companies,
    routes: t.routes,
    route_companies: t.routeCompanies,
    corrections: [],
    announcements: wantOps ? (t.announcements || []) : [],
    featured_routes: wantOps ? (t.featuredRoutes || []) : []
  });
  return store.tables();
}

/**
 * 取一条**尚未被推广**的线路
 *
 * ★ 不能固定用 routes[0]：seed 里 6 个推广位占着济南的几条主干线，
 *   用它测「新建推广位」会撞上「这条线路已经在推广位里了」。
 */
function pickFreeRoute(t) {
  const taken = {};
  (t.featured_routes || []).forEach((x) => { taken[x.routeKey] = true; });
  const free = t.routes.filter((r) => !taken[r.routeKey]);
  if (!free.length) throw new Error('样板数据里所有线路都被推广了，测试需要至少一条空闲线路');
  return free[0];
}

/* ============================================================
 * 1. 区县（第 4 项：直辖市以下的市/县/区）
 * ============================================================ */
describe('区县：字典覆盖与归属', () => {
  test('344 个城市全部有区县数据（0 缺失）', () => {
    const missing = CITIES.filter((c) => area.areasOf(c.name).length === 0);
    eq(missing.length, 0, '缺区县的城市：' + missing.map((c) => c.name).join('、'));
  });

  test('四个直辖市都能选到区（用户明确点名的问题）', () => {
    ok(area.areasOf('北京').length > 0, '北京没有区县');
    ok(area.areasOf('上海').length > 0, '上海没有区县');
    ok(area.areasOf('天津').length > 0, '天津没有区县');
    ok(area.areasOf('重庆').length > 0, '重庆没有区县');
  });

  test('反查：朝阳区属于北京，通州区属于北京', () => {
    ok(area.citiesOfArea('朝阳区').indexOf('北京') >= 0);
    ok(area.citiesOfArea('通州区').indexOf('北京') >= 0);
  });

  test('重名区县能被城市上下文消歧（市中区：济南 / 枣庄都有）', () => {
    const owners = area.citiesOfArea('市中区');
    ok(owners.length >= 2, '市中区应属于多个城市，实际 ' + JSON.stringify(owners));
    deepEq(area.resolvePlace('市中区', '枣庄'), { city: '枣庄', area: '市中区' });
    deepEq(area.resolvePlace('市中区', '济南'), { city: '济南', area: '市中区' });
  });

  test('★ 区县只影响展示不影响查询：resolvePlace 返回的 city 一定是城市', () => {
    const r = area.resolvePlace('朝阳区', '北京');
    eq(r.city, '北京');
    ok(area.isCity(r.city), '解析出的 city 必须是已知城市，否则查不到线路');
    ok(CITIES.some((c) => c.name === r.city));
  });

  test('展示文案：北京 · 朝阳区', () => {
    eq(area.formatPlace('北京', '朝阳区'), '北京 · 朝阳区');
    eq(area.formatPlace('北京', ''), '北京');
  });
});

describe('区县：混合搜索', () => {
  test('搜「朝阳」能出区县结果（只搜城市会一条都没有）', () => {
    const r = area.searchPlaces('朝阳', 20);
    ok(r.length > 0, '搜不到任何结果');
    ok(r.some((x) => x.type === 'area' && x.name === '朝阳区'), '结果里没有朝阳区');
  });

  test('搜城市名时城市排在区县前面（用户更多时候要选市）', () => {
    const r = area.searchPlaces('北京', 20);
    ok(r.length > 0);
    eq(r[0].type, 'city');
    eq(r[0].city, '北京');
  });

  test('搜索结果每条都带 city，宿主拿它去查线路', () => {
    area.searchPlaces('区', 30).forEach((x) => {
      ok(!!x.city, '结果缺少 city：' + JSON.stringify(x));
      ok(area.isCity(x.city), 'city 不是已知城市：' + x.city);
    });
  });

  test('空关键词返回空数组', () => {
    eq(area.searchPlaces('', 10).length, 0);
  });
});

/* ============================================================
 * 2. 公告栏（第 2 项）
 * ============================================================ */
describe('公告：默认内容合规', () => {
  test('每条公告都有标题与正文（点开必须能看到东西）', () => {
    defaults.DEFAULT_ANNOUNCEMENTS.forEach((a) => {
      ok(!!a.title, '公告缺标题');
      ok(!!a.content, '公告「' + a.title + '」缺正文');
    });
  });

  test('★ 公告链接只能是本小程序路径或空串（外链点了没反应）', () => {
    defaults.DEFAULT_ANNOUNCEMENTS.forEach((a) => {
      const link = String(a.link || '');
      if (!link) return;
      ok(link.charAt(0) === '/', '公告「' + a.title + '」的链接不是内部路径：' + link);
    });
  });

  test('公告级别都在枚举内', () => {
    defaults.DEFAULT_ANNOUNCEMENTS.forEach((a) => {
      ok(store.ANNOUNCEMENT_LEVEL_VALUES.indexOf(a.level) >= 0, '级别不合法：' + a.level);
    });
  });
});

describe('公告：后台校验与增删改', () => {
  test('正常公告能创建', () => {
    freshSeed(false);
    const r = store.createAnnouncement({
      title: '测试公告', content: '正文', level: 'tip', link: ''
    });
    ok(r.ok, '创建失败：' + JSON.stringify(r.errors));
    eq(store.listAnnouncements().length, 1);
  });

  test('缺正文被拒（点开没内容 = 点了没反应）', () => {
    freshSeed(false);
    const r = store.createAnnouncement({ title: '只有标题', content: '', level: 'info' });
    eq(r.ok, false);
    ok(r.errors.some((e) => e.field === 'content'));
  });

  test('★ 外链被拒', () => {
    freshSeed(false);
    const r = store.createAnnouncement({
      title: '外链', content: '正文', level: 'info', link: 'https://example.com'
    });
    eq(r.ok, false);
    ok(r.errors.some((e) => e.field === 'link'));
  });

  test('非法级别被拒', () => {
    freshSeed(false);
    const r = store.createAnnouncement({ title: 'x', content: 'y', level: 'danger' });
    eq(r.ok, false);
  });

  test('失效时间早于生效时间被拒', () => {
    freshSeed(false);
    const r = store.createAnnouncement({
      title: 'x', content: 'y', startAt: 2000, endAt: 1000
    });
    eq(r.ok, false);
  });

  test('编辑与删除生效，且删除后列表为空', () => {
    freshSeed(false);
    const c = store.createAnnouncement({ title: 'a', content: 'b' });
    const id = c.announcement._id;
    const u = store.updateAnnouncement(id, { title: '改过的标题', content: 'b' });
    ok(u.ok, '更新失败');
    eq(store.getAnnouncement(id).title, '改过的标题');
    ok(store.deleteAnnouncement(id).ok);
    eq(store.listAnnouncements().length, 0);
  });

  test('按 sortOrder 升序返回', () => {
    freshSeed(false);
    store.createAnnouncement({ title: 'b', content: 'x', sortOrder: 20 });
    store.createAnnouncement({ title: 'a', content: 'x', sortOrder: 10 });
    const list = store.listAnnouncements();
    eq(list[0].title, 'a');
    eq(list[1].title, 'b');
  });
});

/* ============================================================
 * 3. 优质线路推广（第 3 项）
 * ============================================================ */
describe('推广位：默认内容合规', () => {
  test('★ 每个推广位的 routeKey 都真实存在于线路库', () => {
    const t = seed.buildTables();
    const keys = {};
    t.routes.forEach((r) => { keys[r.routeKey] = true; });
    defaults.DEFAULT_FEATURED.forEach((f) => {
      ok(keys[f.routeKey], '推广位指向了不存在的线路：' + f.routeKey);
    });
  });

  test('推广位不冗余存公司数（实时数据必须从 routes 现场读）', () => {
    defaults.DEFAULT_FEATURED.forEach((f) => {
      eq(f.companyCount, undefined, '推广位不该存 companyCount');
      eq(f.transitDays, undefined, '推广位不该存时效');
    });
  });

  test('每条都有角标与推荐理由', () => {
    defaults.DEFAULT_FEATURED.forEach((f) => {
      ok(!!f.tag, f.routeKey + ' 缺角标');
      ok(!!f.reason, f.routeKey + ' 缺推荐理由');
    });
  });
});

describe('推广位：后台校验与增删改', () => {
  test('正常推广位能创建', () => {
    const t = freshSeed(false);
    const free = pickFreeRoute(t);
    const r = store.createFeatured({
      fromCity: free.fromCity, toCity: free.toCity, tag: '直达', reason: '快'
    });
    ok(r.ok, '创建失败：' + JSON.stringify(r.errors));
    eq(r.featured.routeKey, free.routeKey);
  });

  test('★ 指向不存在的线路被拒（否则首页那张卡点进去是空页）', () => {
    freshSeed(false);
    const r = store.createFeatured({
      fromCity: '漠河', toCity: '三沙', tag: '直达', reason: 'x'
    });
    eq(r.ok, false);
    ok(r.errors.some((e) => e.message.indexOf('线路库里还没有') >= 0));
  });

  test('★ 同一线路不能重复推广（否则首页出现两张一样的卡）', () => {
    const t = freshSeed(false);
    const free = pickFreeRoute(t);
    const base = { fromCity: free.fromCity, toCity: free.toCity };
    const first = store.createFeatured(Object.assign({ tag: 'a', reason: 'x' }, base));
    ok(first.ok, '首次创建失败：' + JSON.stringify(first.errors));
    const second = store.createFeatured(Object.assign({ tag: 'b', reason: 'y' }, base));
    eq(second.ok, false);
    ok(second.errors.some((e) => e.message.indexOf('已经在推广位里') >= 0));
  });

  test('角标为空被拒，超长被拒', () => {
    const t = freshSeed(false);
    const free = pickFreeRoute(t);
    const base = { fromCity: free.fromCity, toCity: free.toCity, reason: 'x' };
    eq(store.createFeatured(Object.assign({ tag: '' }, base)).ok, false);
    eq(store.createFeatured(Object.assign({ tag: '这是一个很长的角标文案' }, base)).ok, false);
  });

  test('编辑自身时不被「重复推广」误判', () => {
    const t = freshSeed(false);
    const free = pickFreeRoute(t);
    const r = store.createFeatured({
      fromCity: free.fromCity, toCity: free.toCity, tag: '直达', reason: 'x'
    });
    const id = r.featured._id;
    // 只改角标，线路没变 —— 必须仍然通过
    ok(store.updateFeatured(id, { tag: '次日达' }).ok, '编辑自身被误判为重复');
    eq(store.getFeatured(id).tag, '次日达');
  });

  test('城市名自动归一（济南市 → 济南）', () => {
    const t = freshSeed(false);
    const free = pickFreeRoute(t);
    const r = store.createFeatured({
      fromCity: free.fromCity + '市', toCity: free.toCity + '市', tag: '直达', reason: 'x'
    });
    ok(r.ok, '带「市」后缀时创建失败：' + JSON.stringify(r.errors));
    eq(r.featured.routeKey, free.routeKey);
  });
});

/* ============================================================
 * 4. 落盘护栏：新增的两张表必须进 snapshot
 * ============================================================ */
describe('★ 新增表必须进 snapshot（防「改了内存不落盘」）', () => {
  test('snapshot 含 announcements 与 featured_routes，且键名等于集合名', () => {
    freshSeed();
    const snap = store.snapshot();
    ok(Array.isArray(snap.announcements), 'snapshot 缺 announcements');
    ok(Array.isArray(snap.featured_routes), 'snapshot 缺 featured_routes');
  });

  test('repository.FILES 含两张新表（否则 flush 不会写它们）', () => {
    const repo = require(path.join(ROOT, 'admin/lib/repository.js'));
    ok(repo.FILES.indexOf('announcements') >= 0, 'FILES 缺 announcements');
    ok(repo.FILES.indexOf('featured_routes') >= 0, 'FILES 缺 featured_routes');
  });

  test('seed 构建出的两张表带 _id 与 enabled（可直导云库）', () => {
    const t = seed.buildTables();
    (t.announcements || []).concat(t.featuredRoutes || []).forEach((x) => {
      ok(!!x._id, '缺 _id：' + JSON.stringify(x));
      ok(typeof x.enabled === 'boolean', 'enabled 不是布尔：' + JSON.stringify(x));
      ok(Number(x.sortOrder) > 0, 'sortOrder 非法：' + JSON.stringify(x));
    });
  });
});

const good = summary('首页改版（区县 / 公告 / 推广位）');
process.exit(good ? 0 : 1);
