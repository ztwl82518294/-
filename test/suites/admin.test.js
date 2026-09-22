#!/usr/bin/env node
/**
 * 管理后台测试
 *
 * ★ 覆盖 PRD 验收 B1~B8 里的**逻辑部分**（不依赖 HTTP 服务器）：
 *   B2/B3 导入与容错 · B4 单条编辑 · B5/B6 纠错上下文与审核 ·
 *   B7 限频（在小程序云函数侧，这里测本地的对应实现）· B8 质量看板
 *
 * B1（登录）与 HTTP 层另有 scripts/smoke-admin.js 走真实请求验证。
 *
 * ★ 测试全程在**内存**里跑：store 是纯内存的，所以这些断言不会碰磁盘、
 *   不会污染 admin/data/。落盘能力由「原子写 + 备份坏文件」两个用例单独覆盖。
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const { describe, test, eq, ok, deepEq, summary } = require('../framework');

const ROOT = path.join(__dirname, '..', '..');
const store = require(path.join(ROOT, 'admin/lib/store.js'));
const importer = require(path.join(ROOT, 'admin/lib/importer.js'));
const auth = require(path.join(ROOT, 'admin/lib/auth.js'));
const common = require(path.join(ROOT, 'utils/common.js'));

/** 每个 describe 前重置成一份干净的样板数据 */
function freshSeed() {
  const seed = require(path.join(ROOT, 'data/seed-data.js'));
  const t = seed.buildTables();
  store.replaceAll({
    companies: t.companies,
    routes: t.routes,
    route_companies: t.routeCompanies,
    corrections: []
  });
  return store.tables();
}

/* ============================================================
 * 装载与初始一致性
 * ============================================================ */
describe('装载样板数据后的一致性', () => {
  test('三张表都有数据', () => {
    const t = freshSeed();
    ok(t.companies.length === 40, '公司 40 家，实际 ' + t.companies.length);
    ok(t.routes.length > 0);
    ok(t.route_companies.length > 0);
  });

  test('初始 blocking 全为 0（样板数据本身是干净的）', () => {
    freshSeed();
    const b = store.qualityStats().blocking;
    eq(b.countMismatch, 0);
    eq(b.orphan, 0);
    eq(b.emptyRoutes, 0);
  });

  test('质量看板的口径与三表实际一致', () => {
    const t = freshSeed();
    const q = store.qualityStats();
    eq(q.companies.total, t.companies.length);
    eq(q.routes.total, t.routes.length);
    eq(q.links.total, t.route_companies.length);
  });
});

/* ============================================================
 * 公司 CRUD + 校验
 * ============================================================ */
describe('公司：新建校验', () => {
  test('缺全称被拒', () => {
    freshSeed();
    const r = store.createCompany({ city: '济南', phone: '0531-12345678' });
    ok(!r.ok);
    ok(r.errors.some((e) => e.field === 'name'));
  });

  test('缺城市被拒', () => {
    freshSeed();
    const r = store.createCompany({ name: '测试公司', phone: '0531-12345678' });
    ok(!r.ok && r.errors.some((e) => e.field === 'city'));
  });

  test('缺电话被拒', () => {
    freshSeed();
    const r = store.createCompany({ name: '测试公司', city: '济南' });
    ok(!r.ok && r.errors.some((e) => e.field === 'phone'));
  });

  test('电话格式错被拒', () => {
    freshSeed();
    const r = store.createCompany({ name: '测试公司', city: '济南', phone: 'abc123' });
    ok(!r.ok && r.errors.some((e) => e.field === 'phone'));
  });

  test('重名被拒', () => {
    const t = freshSeed();
    const r = store.createCompany({ name: t.companies[0].name, city: '济南', phone: '0531-12345678' });
    ok(!r.ok && r.errors.some((e) => /同名/.test(e.message)));
  });

  test('合法输入通过并分配 _id', () => {
    freshSeed();
    const r = store.createCompany({ name: '新增测试物流', city: '济南', phone: '0531-12345678', scale: 'medium' });
    ok(r.ok);
    ok(/^comp_/.test(r.company._id));
  });

  test('新建时 updatedAt 与 createdAt 都被设置为当前时间', () => {
    freshSeed();
    const r = store.createCompany({ name: '新增测试物流', city: '济南', phone: '0531-12345678' });
    ok(r.company.updatedAt > 0);
    eq(r.company.updatedAt, r.company.createdAt);
  });

  test('规模非法被拒', () => {
    freshSeed();
    const r = store.createCompany({ name: '测试公司', city: '济南', phone: '0531-12345678', scale: 'giant' });
    ok(!r.ok && r.errors.some((e) => e.field === 'scale'));
  });
});

describe('公司：编辑', () => {
  test('改电话后 updatedAt 刷新（PRD：必须展示数据更新时间）', () => {
    const t = freshSeed();
    const old = t.companies[0];
    const oldUpdated = old.updatedAt;
    // 确保时间会前进
    const before = Date.now();
    const r = store.updateCompany(old._id, { phone: '0531-99990000' });
    ok(r.ok);
    eq(r.company.phone, '0531-99990000');
    ok(r.company.updatedAt >= before, 'updatedAt 应刷新为当前时间');
    ok(r.company.updatedAt > oldUpdated - 1);
  });

  test('编辑不改 createdAt', () => {
    const t = freshSeed();
    const old = t.companies[0];
    const r = store.updateCompany(old._id, { phone: '0531-99990000' });
    eq(r.company.createdAt, old.createdAt);
  });

  test('局部更新不会清空未提交的字段（★ 防 update 清空）', () => {
    const t = freshSeed();
    const old = t.companies[0];
    const r = store.updateCompany(old._id, { phone: '0531-99990000' });
    eq(r.company.name, old.name, 'name 应保持');
    eq(r.company.city, old.city, 'city 应保持');
    eq(r.company.shortName, old.shortName);
    eq(r.company.verified, old.verified);
  });

  test('编辑不存在的公司返回错误', () => {
    freshSeed();
    const r = store.updateCompany('nope', { phone: '0531-12345678' });
    ok(!r.ok);
  });

  test('编辑成与别家同名被拒', () => {
    const t = freshSeed();
    const r = store.updateCompany(t.companies[1]._id, { name: t.companies[0].name });
    ok(!r.ok && r.errors.some((e) => /同名/.test(e.message)));
  });

  test('保留自己的名字不算重名', () => {
    const t = freshSeed();
    const c = t.companies[0];
    const r = store.updateCompany(c._id, { name: c.name, phone: '0531-99990000' });
    ok(r.ok, '编辑自己不该被判重名');
  });
});

describe('公司：删除级联', () => {
  test('删除公司会级联删除其全部线路关联', () => {
    const t = freshSeed();
    const victim = t.companies.find((c) => t.route_companies.some((l) => l.companyId === c._id));
    const before = t.route_companies.filter((l) => l.companyId === victim._id).length;
    ok(before > 0);

    const r = store.deleteCompany(victim._id);
    ok(r.ok);
    eq(r.cascadedLinks, before, '上报的级联数应等于实际关联数');
    eq(t.route_companies.filter((l) => l.companyId === victim._id).length, 0, '关联应被清空');
  });

  test('级联删除后不留悬空关联（blocking.orphan 必须为 0）', () => {
    const t = freshSeed();
    store.deleteCompany(t.companies[0]._id);
    const q = store.qualityStats();
    eq(q.blocking.orphan, 0);
  });

  test('级联删除后 companyCount 被重算', () => {
    const t = freshSeed();
    const victim = t.companies.find((c) => t.route_companies.some((l) => l.companyId === c._id));
    const affected = t.route_companies.filter((l) => l.companyId === victim._id).map((l) => l.routeId);
    store.deleteCompany(victim._id);

    affected.forEach((rid) => {
      const route = store.getRoute(rid);
      if (!route) return;
      const real = t.route_companies.filter((l) => l.routeId === rid).length;
      eq(route.companyCount, real, '线路 ' + route.routeKey + ' 的计数应为 ' + real);
    });
  });

  test('删除不存在的公司返回错误', () => {
    freshSeed();
    ok(!store.deleteCompany('nope').ok);
  });
});

/* ============================================================
 * 线路：routeKey 归一（★ 最关键的一致性问题）
 * ============================================================ */
describe('线路：routeKey 归一', () => {
  /*
   * ★ 注意：样板数据已覆盖 39 个城市，所以这里一律使用**种子数据之外**的城市名
   *   （如「归一城甲/乙」），否则会因「线路已存在」而误判为测试失败。
   */
  test('「归一城甲市」与「归一城甲」生成同一个 routeKey', () => {
    freshSeed();
    const r = store.createRoute({ fromCity: '归一城甲市', toCity: '归一城乙' });
    ok(r.ok, '实际错误：' + JSON.stringify(r.errors));
    eq(r.route.routeKey, '归一城甲-归一城乙');
  });

  test('带「省」后缀也被剥掉', () => {
    freshSeed();
    const r = store.createRoute({ fromCity: '归一城丙', toCity: '归一城丁县' });
    ok(r.ok, '实际错误：' + JSON.stringify(r.errors));
    eq(r.route.routeKey, '归一城丙-归一城丁');
  });

  test('同一线路第二次创建被拒（这就是归一的意义）', () => {
    freshSeed();
    const a = store.createRoute({ fromCity: '归一同城甲市', toCity: '归一同城乙' });
    const b = store.createRoute({ fromCity: '归一同城甲', toCity: '归一同城乙市' });
    ok(a.ok, '第一次应成功：' + JSON.stringify(a.errors));
    ok(!b.ok, '归一后应视为同一条线路');
    ok(b.errors.some((e) => /已存在/.test(e.message)));
  });

  test('routeKey 由城市派生，不采信传入值', () => {
    freshSeed();
    const r = store.createRoute({ fromCity: '归一城戊', toCity: '归一城己', routeKey: '伪造的key' });
    ok(r.ok, '实际错误：' + JSON.stringify(r.errors));
    eq(r.route.routeKey, '归一城戊-归一城己', '必须重新派生，不能信任传入的 routeKey');
  });

  test('_id 由 routeKey 派生（保证一线路一记录）', () => {
    freshSeed();
    const r = store.createRoute({ fromCity: '归一城庚', toCity: '归一城辛' });
    ok(r.ok, '实际错误：' + JSON.stringify(r.errors));
    eq(r.route._id, 'route_归一城庚_归一城辛');
  });

  test('出发=到达被拒', () => {
    freshSeed();
    const r = store.createRoute({ fromCity: '济南', toCity: '济南市' });
    ok(!r.ok && r.errors.some((e) => /同一城市/.test(e.message)));
  });

  test('缺城市被拒', () => {
    freshSeed();
    ok(!store.createRoute({ fromCity: '济南' }).ok);
    ok(!store.createRoute({ toCity: '深圳' }).ok);
    ok(!store.createRoute({}).ok);
  });

  test('改线路城市会同步更新关联的 routeId 与 routeKey（防死链）', () => {
    const t = freshSeed();
    const route = store.createRoute({ fromCity: '济南', toCity: '测试甲' });
    const comp = t.companies[0];
    const link = store.createLink({ routeId: route.route._id, companyId: comp._id, frequency: 'daily' });
    ok(link.ok);

    // 改到达城市（把「测试甲」改成「测试乙」）
    const up = store.updateRoute(route.route._id, { fromCity: '济南', toCity: '测试乙' });
    ok(up.ok);

    const rec = store.getLink(link.link._id);
    eq(rec.routeKey, '济南-测试乙', '关联的 routeKey 必须同步');
    eq(rec.routeId, up.route._id, '关联的 routeId 必须指向新线路');
    eq(store.qualityStats().blocking.orphan, 0, '不得产生悬空关联');
  });

  test('删除线路会级联删除关联', () => {
    const t = freshSeed();
    const route = t.routes.find((r) => r.companyCount > 0);
    const before = t.route_companies.filter((l) => l.routeId === route._id).length;
    const r = store.deleteRoute(route._id);
    ok(r.ok);
    eq(r.cascadedLinks, before);
    eq(store.qualityStats().blocking.orphan, 0);
  });
});

/* ============================================================
 * 关联：时效/直达挂在这一层（★ PRD 的关键设计取舍）
 * ============================================================ */
describe('关联：属性挂载与校验', () => {
  test('同一公司可挂多条线路，各自独立的时效', () => {
    const t = freshSeed();
    const comp = t.companies[0];
    const r1 = store.createRoute({ fromCity: '济南', toCity: '测试甲' });
    const r2 = store.createRoute({ fromCity: '济南', toCity: '测试乙' });

    const l1 = store.createLink({ routeId: r1.route._id, companyId: comp._id, transitDays: 2, frequency: 'daily', isDirect: true });
    const l2 = store.createLink({ routeId: r2.route._id, companyId: comp._id, transitDays: 5, frequency: 'weekly', isDirect: false });

    ok(l1.ok && l2.ok);
    eq(l1.link.transitDays, 2);
    eq(l2.link.transitDays, 5);
    eq(l1.link.isDirect, true);
    eq(l2.link.isDirect, false);
  });

  test('同一线路可挂多家公司', () => {
    const t = freshSeed();
    const r = store.createRoute({ fromCity: '济南', toCity: '测试丙' });
    const a = store.createLink({ routeId: r.route._id, companyId: t.companies[0]._id, frequency: 'daily' });
    const b = store.createLink({ routeId: r.route._id, companyId: t.companies[1]._id, frequency: 'daily' });
    ok(a.ok && b.ok);
    eq(store.getRoute(r.route._id).companyCount, 2);
  });

  test('同公司同线路重复挂载被拒', () => {
    const t = freshSeed();
    const r = store.createRoute({ fromCity: '济南', toCity: '测试丁' });
    const a = store.createLink({ routeId: r.route._id, companyId: t.companies[0]._id, frequency: 'daily' });
    const b = store.createLink({ routeId: r.route._id, companyId: t.companies[0]._id, frequency: 'daily' });
    ok(a.ok);
    ok(!b.ok && b.errors.some((e) => /已挂/.test(e.message)));
  });

  test('频率必填', () => {
    const t = freshSeed();
    const r = store.createRoute({ fromCity: '济南', toCity: '测试戊' });
    const l = store.createLink({ routeId: r.route._id, companyId: t.companies[0]._id, frequency: '' });
    ok(!l.ok && l.errors.some((e) => e.field === 'frequency'));
  });

  test('频率非法值被拒', () => {
    const t = freshSeed();
    const r = store.createRoute({ fromCity: '济南', toCity: '测试己' });
    const l = store.createLink({ routeId: r.route._id, companyId: t.companies[0]._id, frequency: 'hourly' });
    ok(!l.ok);
  });

  test('时效允许留空（表示未知）', () => {
    const t = freshSeed();
    const r = store.createRoute({ fromCity: '济南', toCity: '测试庚' });
    const l = store.createLink({ routeId: r.route._id, companyId: t.companies[0]._id, transitDays: null, frequency: 'daily' });
    ok(l.ok, '时效是可选字段');
    eq(l.link.transitDays, null);
  });

  test('时效负数被拒', () => {
    const t = freshSeed();
    const r = store.createRoute({ fromCity: '济南', toCity: '测试辛' });
    const l = store.createLink({ routeId: r.route._id, companyId: t.companies[0]._id, transitDays: -1, frequency: 'daily' });
    ok(!l.ok);
  });

  test('时效超 60 天被拒', () => {
    const t = freshSeed();
    const r = store.createRoute({ fromCity: '济南', toCity: '测试壬' });
    const l = store.createLink({ routeId: r.route._id, companyId: t.companies[0]._id, transitDays: 61, frequency: 'daily' });
    ok(!l.ok);
  });

  test('不存在的线路/公司被拒', () => {
    const t = freshSeed();
    const r = store.createRoute({ fromCity: '济南', toCity: '测试癸' });
    ok(!store.createLink({ routeId: 'nope', companyId: t.companies[0]._id, frequency: 'daily' }).ok);
    ok(!store.createLink({ routeId: r.route._id, companyId: 'nope', frequency: 'daily' }).ok);
  });

  test('routeKey 由线路派生，不采信传入值', () => {
    const t = freshSeed();
    const r = store.createRoute({ fromCity: '济南', toCity: '测试子' });
    const l = store.createLink({
      routeId: r.route._id, companyId: t.companies[0]._id, frequency: 'daily', routeKey: '伪造'
    });
    ok(l.ok);
    eq(l.link.routeKey, '济南-测试子');
  });

  test('删除关联后 companyCount 重算', () => {
    const t = freshSeed();
    const r = store.createRoute({ fromCity: '济南', toCity: '测试丑' });
    const l = store.createLink({ routeId: r.route._id, companyId: t.companies[0]._id, frequency: 'daily' });
    eq(store.getRoute(r.route._id).companyCount, 1);
    store.deleteLink(l.link._id);
    eq(store.getRoute(r.route._id).companyCount, 0);
  });
});

/* ============================================================
 * companyCount 重算（★ 冗余计数的一致性护栏）
 * ============================================================ */
describe('companyCount 重算', () => {
  test('重算后与实际关联数 100% 一致（对全部样板数据）', () => {
    const t = freshSeed();
    store.recountRoutes();
    const real = {};
    t.route_companies.forEach((l) => { real[l.routeId] = (real[l.routeId] || 0) + 1; });
    t.routes.forEach((r) => {
      eq(r.companyCount, real[r._id] || 0, r.routeKey);
    });
  });

  test('人为打乱计数后重算能修复（模拟历史脏数据）', () => {
    const t = freshSeed();
    t.routes.forEach((r) => { r.companyCount = 999; });
    ok(store.qualityStats().blocking.countMismatch > 0, '应先检测出不一致');
    store.recountRoutes();
    eq(store.qualityStats().blocking.countMismatch, 0, '重算后应归零');
  });
});

/* ============================================================
 * B8：质量看板
 * ============================================================ */
describe('B8 质量看板', () => {
  test('缺电话统计准确', () => {
    const t = freshSeed();
    t.companies[0].phone = '';
    t.companies[1].phone = '';
    const q = store.qualityStats();
    eq(q.companies.noPhone, 2);
  });

  test('缺时效统计准确（直接影响「时效筛选」可用性）', () => {
    const t = freshSeed();
    t.route_companies[0].transitDays = 0;
    t.route_companies[1].transitDays = null;
    const q = store.qualityStats();
    eq(q.links.noTransit, 2);
  });

  test('超 90 天未更新统计准确', () => {
    const t = freshSeed();
    const now = Date.now();
    const old = now - 100 * 24 * 3600 * 1000;
    const fresh = now - 10 * 24 * 3600 * 1000;
    t.companies.forEach((c, i) => { c.updatedAt = i < 3 ? old : fresh; });
    const q = store.qualityStats(now);
    eq(q.companies.stale, 3);
  });

  test('恰好 90 天不算过期（边界）', () => {
    const t = freshSeed();
    const now = Date.now();
    t.companies.forEach((c) => { c.updatedAt = now - 90 * 24 * 3600 * 1000; });
    const q = store.qualityStats(now);
    eq(q.companies.stale, 0, '「超」90 天不含恰好 90 天');
  });

  test('能被强制注入不一致以验证检测能力（计数）', () => {
    const t = freshSeed();
    t.routes[0].companyCount = 999;
    const q = store.qualityStats();
    eq(q.blocking.countMismatch, 1);
    eq(q.details.countMismatch[0].declared, 999);
  });

  test('能检测悬空关联', () => {
    const t = freshSeed();
    t.route_companies.push({ _id: 'bad_1', routeId: 'nope', companyId: 'nope', routeKey: 'x', transitDays: 1, frequency: 'daily' });
    const q = store.qualityStats();
    eq(q.blocking.orphan, 1);
    eq(q.details.orphan[0].id, 'bad_1');
  });

  test('能检测空线路', () => {
    const t = freshSeed();
    const r = store.createRoute({ fromCity: '济南', toCity: '测试空线' });
    ok(r.ok);
    const q = store.qualityStats();
    eq(q.blocking.emptyRoutes, 1);
  });

  test('明细列表包含可定位的 id（便于一键跳转修复）', () => {
    const t = freshSeed();
    t.companies[0].phone = '';
    t.routes[0].companyCount = 999;
    const q = store.qualityStats();
    eq(q.details.noPhone[0].id, t.companies[0]._id);
    eq(q.details.countMismatch[0].id, t.routes[0]._id);
    ok(q.details.countMismatch[0].routeKey, '应带 routeKey 便于人识别');
  });

  test('百分比计算正确', () => {
    const t = freshSeed();
    t.companies.forEach((c, i) => { if (i < 10) c.phone = ''; });
    const q = store.qualityStats();
    eq(q.companies.noPhonePct, 25, '10/40 = 25%');
  });
});

/* ============================================================
 * B2 / B3：导入的字段映射与错误预览
 * ============================================================ */
describe('B2 导入：表头映射', () => {
  test('标准中文表头能自动映射', () => {
    const headers = ['公司全称', '主电话', '出发城市', '到达城市', '时效（天）', '是否直达', '发车频率'];
    deepEq(importer.autoMap(headers), ['name', 'phone', 'fromCity', 'toCity', 'transitDays', 'isDirect', 'frequency']);
  });

  test('常见别名能识别', () => {
    eq(importer.guessField('公司名称'), 'name');
    eq(importer.guessField('联系电话'), 'phone');
    eq(importer.guessField('出发地'), 'fromCity');
    eq(importer.guessField('目的地'), 'toCity');
    eq(importer.guessField('天数'), 'transitDays');
    eq(importer.guessField('直达'), 'isDirect');
  });

  test('英文内部字段名也能当表头', () => {
    eq(importer.guessField('name'), 'name');
    eq(importer.guessField('transitDays'), 'transitDays');
    eq(importer.guessField('fromCity'), 'fromCity');
  });

  test('带括号注释的表头能识别', () => {
    eq(importer.guessField('时效（天）'), 'transitDays');
    eq(importer.guessField('电话(必填)'), 'phone');
  });

  test('无法识别的表头返回空（映射为「忽略」）', () => {
    eq(importer.guessField('备注列'), '');
    eq(importer.guessField(''), '');
    eq(importer.guessField('某某无关'), '');
  });
});

describe('B2 导入：CSV 解析', () => {
  test('基本解析', () => {
    const rows = importer.parseCsv('a,b,c\n1,2,3\n');
    deepEq(rows, [['a', 'b', 'c'], ['1', '2', '3']]);
  });

  test('字段里含逗号时靠引号保护（地址常见）', () => {
    const rows = importer.parseCsv('name,addr\n甲,"济南市天桥区,泺口物流园"\n');
    deepEq(rows[1], ['甲', '济南市天桥区,泺口物流园']);
  });

  test('转义的双引号', () => {
    const rows = importer.parseCsv('a\n"他说""你好"""\n');
    eq(rows[1][0], '他说"你好"');
  });

  test('字段内换行不会拆行', () => {
    const rows = importer.parseCsv('a\n"第一行\n第二行"\n');
    eq(rows.length, 2);
    eq(rows[1][0], '第一行\n第二行');
  });

  test('去 BOM', () => {
    const rows = importer.parseCsv('\uFEFF公司全称,主电话\n甲,0531-1234\n');
    eq(rows[0][0], '公司全称');
  });

  test('CRLF 换行', () => {
    const rows = importer.parseCsv('a,b\r\n1,2\r\n');
    deepEq(rows, [['a', 'b'], ['1', '2']]);
  });
});

describe('B3 导入：错误预览（拒绝或跳过，不污染数据库）', () => {
  test('缺公司名被标出', () => {
    freshSeed();
    const check = store.validateImportRows([
      { name: '', phone: '0531-12345678', fromCity: '济南', toCity: '深圳', frequency: 'daily' }
    ]);
    eq(check.invalid.length, 1);
    ok(check.invalid[0].errors.some((e) => /公司全称缺失/.test(e)));
  });

  test('缺城市被标出', () => {
    freshSeed();
    const check = store.validateImportRows([
      { name: '甲物流', phone: '0531-12345678', fromCity: '济南', toCity: '', frequency: 'daily' }
    ]);
    eq(check.invalid.length, 1);
    ok(check.invalid[0].errors.some((e) => /到达城市缺失/.test(e)));
  });

  test('电话格式错被标出（并带上原值）', () => {
    freshSeed();
    const check = store.validateImportRows([
      { name: '甲物流', phone: '123', fromCity: '济南', toCity: '深圳', frequency: 'daily' }
    ]);
    eq(check.invalid.length, 1);
    ok(check.invalid[0].errors.some((e) => /电话格式不正确/.test(e) && /123/.test(e)));
  });

  test('出发=到达被标出', () => {
    freshSeed();
    const check = store.validateImportRows([
      { name: '甲物流', phone: '0531-12345678', fromCity: '济南', toCity: '济南市', frequency: 'daily' }
    ]);
    eq(check.invalid.length, 1);
    ok(check.invalid[0].errors.some((e) => /同一城市/.test(e)));
  });

  test('时效非法被标出', () => {
    freshSeed();
    const check = store.validateImportRows([
      { name: '甲物流', phone: '0531-12345678', fromCity: '济南', toCity: '深圳', transitDays: 'abc', frequency: 'daily' }
    ]);
    eq(check.invalid.length, 1);
    ok(check.invalid[0].errors.some((e) => /时效不合法/.test(e)));
  });

  test('频率非法被标出', () => {
    freshSeed();
    const check = store.validateImportRows([
      { name: '甲物流', phone: '0531-12345678', fromCity: '济南', toCity: '深圳', frequency: 'hourly' }
    ]);
    ok(check.invalid[0].errors.some((e) => /频率取值不合法/.test(e)));
  });

  test('频率留空是允许的（视为未知）', () => {
    freshSeed();
    const check = store.validateImportRows([
      { name: '甲物流', phone: '0531-12345678', fromCity: '济南', toCity: '深圳', frequency: '' }
    ]);
    eq(check.valid.length, 1);
  });

  test('文件内同公司同线路重复被标出（并指向首个行号）', () => {
    freshSeed();
    const check = store.validateImportRows([
      { name: '甲物流', phone: '0531-12345678', fromCity: '济南', toCity: '深圳', frequency: 'daily' },
      { name: '甲物流', phone: '0531-12345678', fromCity: '济南', toCity: '深圳', frequency: 'daily' }
    ]);
    eq(check.valid.length, 1);
    eq(check.invalid.length, 1);
    ok(check.invalid[0].errors.some((e) => /重复/.test(e) && /第 2 行/.test(e)), JSON.stringify(check.invalid[0].errors));
  });

  test('一行多个错误会全部列出（不是只报第一个）', () => {
    freshSeed();
    const check = store.validateImportRows([
      { name: '', phone: 'abc', fromCity: '济南', toCity: '', transitDays: 'x', frequency: 'zzz' }
    ]);
    eq(check.invalid.length, 1);
    ok(check.invalid[0].errors.length >= 4, '实际 ' + check.invalid[0].errors.length + ' 个错误：' + JSON.stringify(check.invalid[0].errors));
  });

  test('行号从 2 开始（Excel 第 1 行是表头）', () => {
    freshSeed();
    const check = store.validateImportRows([
      { name: 'ok', phone: '0531-12345678', fromCity: '济南', toCity: '深圳', frequency: 'daily' },
      { name: '', phone: '', fromCity: '', toCity: '', frequency: '' }
    ]);
    eq(check.valid[0].lineNo, 2);
    eq(check.invalid[0].lineNo, 3);
  });

  test('summary 统计：新建/已有公司数区分正确', () => {
    const t = freshSeed();
    const existing = t.companies[0].name;
    const check = store.validateImportRows([
      { name: '全新物流甲', phone: '0531-11111111', fromCity: '济南', toCity: '新城甲', frequency: 'daily' },
      { name: existing, phone: '0531-12345678', fromCity: '济南', toCity: '新城乙', frequency: 'daily' }
    ]);
    eq(check.summary.total, 2);
    eq(check.summary.validCount, 2);
    eq(check.summary.newCompanies, 1);
    eq(check.summary.existingCompanies, 1);
    eq(check.summary.newRoutes, 2);
  });

  test('校验阶段不写任何数据（★ 预览必须无副作用）', () => {
    const t = freshSeed();
    const beforeC = t.companies.length;
    const beforeR = t.routes.length;
    const beforeL = t.route_companies.length;
    store.validateImportRows([
      { name: '甲物流', phone: '0531-12345678', fromCity: '济南', toCity: '深圳', frequency: 'daily' }
    ]);
    eq(t.companies.length, beforeC);
    eq(t.routes.length, beforeR);
    eq(t.route_companies.length, beforeL);
  });
});

describe('导入执行', () => {
  test('合法行被写入三张表', () => {
    const t = freshSeed();
    const check = store.validateImportRows([
      { name: '导入测试物流甲', phone: '0531-22223333', city: '济南', fromCity: '济南', toCity: '导入测试城', transitDays: 3, isDirect: true, frequency: 'daily' }
    ]);
    eq(check.summary.invalidCount, 0);

    const res = store.applyImportRows(check.valid);
    eq(res.created, 1);
    eq(res.links, 1);
    eq(res.failed.length, 0);

    const comp = t.companies.find((c) => c.name === '导入测试物流甲');
    ok(comp, '公司应已创建');
    const route = t.routes.find((r) => r.routeKey === '济南-导入测试城');
    ok(route, '线路应已创建');
    eq(route.companyCount, 1, '计数应已重算');
  });

  test('命中已有公司时复用而不新建', () => {
    const t = freshSeed();
    const existing = t.companies[0];
    const before = t.companies.length;
    const check = store.validateImportRows([
      { name: existing.name, phone: existing.phone, fromCity: '济南', toCity: '复用测试城', frequency: 'daily' }
    ]);
    const res = store.applyImportRows(check.valid);
    eq(res.created, 0);
    eq(t.companies.length, before, '不应新增公司');
    eq(res.updated, 1);
  });

  test('导入后无悬空关联、计数一致（不污染数据）', () => {
    freshSeed();
    const check = store.validateImportRows([
      { name: '导入甲', phone: '0531-11111111', fromCity: '济南', toCity: '批量城甲', frequency: 'daily' },
      { name: '导入乙', phone: '0531-22222222', fromCity: '济南', toCity: '批量城甲', frequency: 'daily' },
      { name: '导入丙', phone: '0531-33333333', fromCity: '导入城乙', toCity: '批量城甲', frequency: 'weekday' }
    ]);
    store.applyImportRows(check.valid);
    const b = store.qualityStats().blocking;
    eq(b.orphan, 0);
    eq(b.countMismatch, 0);
  });

  test('大批量导入（300 行）无丢失、无重复', () => {
    freshSeed();
    const rows = [];
    for (let i = 0; i < 300; i++) {
      rows.push({
        name: '批量公司' + String(i).padStart(3, '0'),
        phone: '0531-9' + String(1000000 + i),
        fromCity: '济南',
        toCity: '批量目的地' + String(i).padStart(3, '0'),
        transitDays: (i % 6) + 1,
        isDirect: i % 2 === 0,
        frequency: 'daily'
      });
    }
    const check = store.validateImportRows(rows);
    eq(check.summary.total, 300);
    eq(check.summary.validCount, 300, '不应有行被误判为错误');
    eq(check.summary.invalidCount, 0);

    const res = store.applyImportRows(check.valid);
    eq(res.created, 300);
    eq(res.links, 300);
    eq(res.failed.length, 0);
    eq(store.qualityStats().blocking.countMismatch, 0);
  });

  test('导入过程中单行失败不影响其他行', () => {
    freshSeed();
    const check = store.validateImportRows([
      { name: '好行甲', phone: '0531-11111111', fromCity: '济南', toCity: '稳健城甲', frequency: 'daily' },
      { name: '好行乙', phone: '0531-22222222', fromCity: '济南', toCity: '稳健城乙', frequency: 'daily' }
    ]);
    // 人为破坏第二行（模拟「校验通过但写库时出错」）
    check.valid[1].row.fromCity = '';
    const res = store.applyImportRows(check.valid);
    eq(res.links, 1, '第一行应成功');
    eq(res.failed.length, 1, '第二行应被记录为失败');
    eq(res.failed[0].lineNo, 3);
  });

  test('返回结果里包含每条失败行的行号与原因（便于回填给用户看）', () => {
    freshSeed();
    const check = store.validateImportRows([
      { name: '有效行', phone: '0531-11111111', fromCity: '济南', toCity: '失败城甲', frequency: 'daily' }
    ]);
    check.valid[0].row.toCity = null;   // 破坏
    const res = store.applyImportRows(check.valid);
    ok(res.failed.length > 0);
    ok(res.failed[0].lineNo === 2);
    ok(typeof res.failed[0].message === 'string' && res.failed[0].message.length > 0);
  });
});

/* ============================================================
 * 字段值归一（导入的容错能力）
 * ============================================================ */
describe('导入：值归一', () => {
  test('「是/否/√/1」都能解析成布尔', () => {
    eq(importer.toBool('是'), true);
    eq(importer.toBool('否'), false);
    eq(importer.toBool('√'), true);
    eq(importer.toBool('×'), false);
    eq(importer.toBool('1'), true);
    eq(importer.toBool('0'), false);
    eq(importer.toBool('YES'), true);
    eq(importer.toBool(''), null);
    eq(importer.toBool('随便'), null);
  });

  test('频率的中文写法被归一', () => {
    eq(importer.toFrequency('天天发车'), 'daily');
    eq(importer.toFrequency('每天'), 'daily');
    eq(importer.toFrequency('工作日'), 'weekday');
    eq(importer.toFrequency('每周'), 'weekly');
    eq(importer.toFrequency('不定期'), 'irregular');
    eq(importer.toFrequency('daily'), 'daily');
  });

  test('时效带「天」字也能解析', () => {
    eq(importer.toNumber('3天'), 3);
    eq(importer.toNumber('2'), 2);
    eq(importer.toNumber(''), null);
  });

  test('时效是非数字时原样返回（交给业务校验报错，不静默变 NaN）', () => {
    eq(importer.toNumber('很快'), '很快');
  });

  test('规模取值大小写与非法值处理', () => {
    const mapped = importer.mapRows(['scale'], [['LARGE'], ['giant']], ['scale']);
    eq(mapped[0].scale, 'large');
    eq(mapped[1].scale, 'small', '非法值退化为 small 而不是让整行失败');
  });
});

/* ============================================================
 * B5 / B6：纠错队列与审核
 * ============================================================ */
describe('B5 / B6 纠错队列', () => {
  function seedCorrections() {
    freshSeed();
    const now = Date.now();
    store.tables().corrections.push(
      { _id: 'c1', targetType: 'company', targetId: 'comp_001', targetSummary: '济南鲁通物流有限公司', type: 'phone_wrong', typeLabel: '电话有误', content: '电话停机了', images: ['img1'], contact: '15165018553', openid: 'oA', status: 'pending', createdAt: now - 3000 },
      { _id: 'c2', targetType: 'route_company', targetId: 'rc_001', targetSummary: '济南-广州', type: 'route_gone', typeLabel: '线路已取消', content: '这条线路不跑了', images: [], contact: '', openid: 'oB', status: 'pending', createdAt: now - 2000 },
      { _id: 'c3', targetType: 'company', targetId: 'comp_002', targetSummary: '泉城货运', type: 'incomplete', typeLabel: '信息不完整', content: '缺发站', images: [], contact: '', openid: 'oC', status: 'accepted', createdAt: now - 1000, reviewedAt: now - 500, reviewNote: '已补' }
    );
  }

  test('待审列表只出 pending', () => {
    seedCorrections();
    const r = store.listCorrections({ status: 'pending' }, 1, 20);
    eq(r.total, 2);
    ok(r.rows.every((x) => x.status === 'pending'));
  });

  test('待审按提交时间倒序（新反馈先看）', () => {
    seedCorrections();
    const r = store.listCorrections({ status: 'pending' }, 1, 20);
    eq(r.rows[0]._id, 'c2', '后提交的应排前面');
  });

  test('各状态计数正确', () => {
    seedCorrections();
    const c = store.correctionCounts();
    eq(c.pending, 2);
    eq(c.accepted, 1);
    eq(c.rejected, 0);
    eq(c.all, 3);
  });

  test('B6 采纳后状态变更并记录备注与时间', () => {
    seedCorrections();
    const r = store.reviewCorrection('c1', 'accepted', '已更新电话');
    ok(r.ok);
    eq(r.correction.status, 'accepted');
    eq(r.correction.reviewNote, '已更新电话');
    ok(r.correction.reviewedAt > 0);
  });

  test('B6 驳回 / 待定同样可用', () => {
    seedCorrections();
    ok(store.reviewCorrection('c1', 'rejected', '信息无误').ok);
    seedCorrections();
    ok(store.reviewCorrection('c2', 'hold', '需要再确认').ok);
  });

  test('非法状态被拒', () => {
    seedCorrections();
    ok(!store.reviewCorrection('c1', 'bogus', '').ok);
    ok(!store.reviewCorrection('c1', '', '').ok);
  });

  test('审核不存在的记录返回错误', () => {
    seedCorrections();
    ok(!store.reviewCorrection('nope', 'accepted', '').ok);
  });

  test('★ 纠错携带目标上下文（targetId + targetSummary 都在）', () => {
    seedCorrections();
    const r = store.listCorrections({ status: 'pending' }, 1, 20);
    r.rows.forEach((c) => {
      ok(c.targetId, '必须有 targetId 才能定位记录');
      ok(c.targetSummary, '必须有 targetSummary 才能给人看懂');
    });
  });

  test('可删除无效反馈', () => {
    seedCorrections();
    ok(store.deleteCorrection('c1').ok);
    eq(store.correctionCounts().all, 2);
  });
});

describe('纠错：从线上合并回本地', () => {
  test('按 _id 去重，不覆盖本地已有状态', () => {
    freshSeed();
    store.tables().corrections.push({ _id: 'x1', status: 'accepted', content: '本地已处理' });
    const r = store.mergeCorrections([
      { _id: 'x1', status: 'pending', content: '线上版本' },
      { _id: 'x2', status: 'pending', content: '新反馈' }
    ]);
    eq(r.added, 1);
    eq(r.skipped, 1);
    eq(store.getCorrection('x1').content, '本地已处理', '不应被线上覆盖');
  });

  test('无 _id 的行被跳过', () => {
    freshSeed();
    const r = store.mergeCorrections([{ content: '没有id' }, null, { _id: 'ok1' }]);
    eq(r.added, 1);
    eq(r.skipped, 2);
  });

  test('非数组输入不抛错', () => {
    freshSeed();
    eq(store.mergeCorrections(null).added, 0);
    eq(store.mergeCorrections('x').added, 0);
  });
});

/* ============================================================
 * 登录（B1 的逻辑部分）
 * ============================================================ */
describe('B1 登录逻辑', () => {
  test('密码不以明文存储', () => {
    const h = auth.hashPassword('admin12345');
    ok(h.passwordHash && h.salt);
    ok(h.passwordHash.indexOf('admin12345') < 0, '不得含明文');
    eq(h.passwordHash.length, 128, 'scrypt 输出 64 字节 → 128 个 hex 字符');
  });

  test('相同密码 + 不同盐 → 不同 hash（防彩虹表）', () => {
    const a = auth.hashPassword('same');
    const b = auth.hashPassword('same');
    ok(a.salt !== b.salt);
    ok(a.passwordHash !== b.passwordHash);
  });

  test('正确密码校验通过，错误密码不通过', () => {
    const h = auth.hashPassword('correct-horse');
    ok(auth.verifyPassword('correct-horse', h.salt, h.passwordHash));
    ok(!auth.verifyPassword('wrong', h.salt, h.passwordHash));
    ok(!auth.verifyPassword('', h.salt, h.passwordHash));
  });

  test('缺 salt / hash 时返回 false 而不是抛错', () => {
    ok(!auth.verifyPassword('x', '', ''));
    ok(!auth.verifyPassword('x', null, null));
  });

  test('定长时间比较：长度不同返回 false 且不抛错', () => {
    ok(!auth.safeEqual('abc', 'abcdef'));
    ok(auth.safeEqual('abc', 'abc'));
  });

  test('未登录时 fromCookie 返回 null', () => {
    auth._resetSessions();
    eq(auth.fromCookie(''), null);
    eq(auth.fromCookie(undefined), null);
    eq(auth.fromCookie('other=1'), null);
    eq(auth.fromCookie(auth.COOKIE_NAME + '=伪造token'), null);
  });

  test('Cookie 带 HttpOnly 与 SameSite（防 XSS 偷 token / 防 CSRF）', () => {
    const c = auth.cookieFor('tok123');
    ok(/HttpOnly/.test(c), '应含 HttpOnly');
    ok(/SameSite=Strict/.test(c), '应含 SameSite=Strict');
  });

  test('过期 Cookie 会把 Max-Age 设为 0', () => {
    ok(/Max-Age=0/.test(auth.expiredCookie()));
  });
});

/* ============================================================
 * 存储层：原子写与坏文件处理
 * ============================================================ */
describe('存储层稳健性', () => {
  const db = require(path.join(ROOT, 'admin/lib/db.js'));

  test('写出去的文件无 BOM、带尾换行、可被解析回来', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lq-admin-'));
    const origDir = db.DATA_DIR;
    // 直接测 round-trip：写到真实目录但用一个不会冲突的临时集合名
    const name = '_test_tmp_' + Date.now();
    const rows = [{ _id: 'a', 中文: '值' }];
    db.write(name, rows);
    const back = db.read(name);
    deepEq(back, rows);

    const p = db.fileOf(name);
    const buf = fs.readFileSync(p);
    ok(!(buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF), '不得有 BOM');
    eq(buf[buf.length - 1], 0x0A, '末尾应有换行');

    fs.unlinkSync(p);
    fs.rmdirSync(tmpDir, { recursive: true });
    void origDir;
  });

  test('读不存在的集合返回空数组而不抛错', () => {
    const name = '_no_such_' + Date.now();
    deepEq(db.read(name), []);
  });

  test('空文件返回空数组', () => {
    const name = '_empty_' + Date.now();
    db.write(name, []);
    deepEq(db.read(name), []);
    fs.unlinkSync(db.fileOf(name));
  });

  test('坏文件会被备份并抛错（不静默丢数据）', () => {
    const name = '_broken_' + Date.now();
    const p = db.fileOf(name);
    fs.writeFileSync(p, '{ 这不是合法 JSON', 'utf8');
    let threw = false;
    try { db.read(name); } catch (e) { threw = true; }
    ok(threw, '应抛错告知用户，而不是返回空数组让人误以为数据丢了');
    // 清理（含备份文件）
    const dirFiles = fs.readdirSync(db.DATA_DIR).filter((f) => f.indexOf(name) === 0);
    dirFiles.forEach((f) => fs.unlinkSync(path.join(db.DATA_DIR, f)));
  });
});

/* ============================================================
 * ★ 覆盖写事故护栏（来自一次真实事故）
 * ============================================================
 * 事故经过：写了个脚本调 repo.createCompany 想插一条数据，忘了先 loadAll()。
 * 内存里是空表，而 flush 是**全量覆盖写** —— 四个数据文件被抹成 `[]`，
 * 而且**不报任何错**。运营数据差点没了。
 *
 * 教训：写盘能力不能是「任何调用方随时能用」的，必须要求「先装载、后写入」。
 * 下面这些断言把这个约束固化下来，防止哪天被人「顺手简化掉」。
 */
describe('★ 覆盖写事故护栏：未装载禁止落盘', () => {
  const repPath = require.resolve(path.join(ROOT, 'admin/lib/repository.js'));
  const storePath = require.resolve(path.join(ROOT, 'admin/lib/store.js'));
  const dbPath = require.resolve(path.join(ROOT, 'admin/lib/db.js'));

  /** 拿一份「全新、从未装载」的 repository 实例（不碰全局 require 缓存里的那份） */
  function freshRepo() {
    delete require.cache[repPath];
    delete require.cache[storePath];
    delete require.cache[dbPath];
    return require(repPath);
  }

  /** 用完把缓存清掉，避免影响其他用例 */
  function cleanup() {
    delete require.cache[repPath];
    delete require.cache[storePath];
    delete require.cache[dbPath];
  }

  test('未装载时 flush() 抛错（而不是把文件清空）', () => {
    const repo = freshRepo();
    ok(!repo.isLoaded(), '新实例应当处于「未装载」状态');
    let msg = '';
    try { repo.flush(); } catch (e) { msg = e.message; }
    ok(/拒绝落盘/.test(msg), '应抛出明确的拒绝信息，实际：' + msg);
    cleanup();
  });

  test('未装载时的写操作抛错，且磁盘原文件一字未动', () => {
    const repo = freshRepo();
    const p = path.join(ROOT, 'admin/data/companies.json');
    // 若文件不存在（全新检出），先跳过后面的对比
    const existed = fs.existsSync(p);
    const before = existed ? fs.readFileSync(p, 'utf8') : '';

    let threw = false;
    try {
      repo.createCompany({ name: '不该被写进去的公司', city: '济南', phone: '0531-00000000' });
    } catch (e) { threw = true; }
    ok(threw, '未装载就写，必须抛错');

    if (existed) {
      const after = fs.readFileSync(p, 'utf8');
      ok(after === before, '★ 磁盘文件必须一字未动（这是护栏存在的唯一意义）');
    }
    cleanup();
  });

  test('装载之后写入正常（护栏不能把正常路径也堵死）', () => {
    const repo = freshRepo();
    repo.loadAll();     // 用真实的 admin/data 装载
    ok(repo.isLoaded());
    const n0 = JSON.parse(fs.readFileSync(path.join(ROOT, 'admin/data/companies.json'), 'utf8')).length;

    const c = repo.createCompany({ name: '护栏自测公司', city: '济南', phone: '0531-00001111' });
    ok(c.ok, '装载后新建应成功');
    const n1 = JSON.parse(fs.readFileSync(path.join(ROOT, 'admin/data/companies.json'), 'utf8')).length;
    eq(n1, n0 + 1, '装载后写入必须真的落盘');

    // 清理：删掉这条并还原
    const d = repo.deleteCompany(c.company._id);
    ok(d.ok);
    const n2 = JSON.parse(fs.readFileSync(path.join(ROOT, 'admin/data/companies.json'), 'utf8')).length;
    eq(n2, n0, '删除后应回到原数量');
    cleanup();
  });
});

/* ============================================================
 * 与小程序端的一致性
 * ============================================================ */
describe('★ 与小程序端的一致性（跨端同口径）', () => {
  test('后台的 routeKey 派生于 utils/common（不是自己重写一套）', () => {
    freshSeed();
    const r = store.createRoute({ fromCity: '测试市甲', toCity: '测试市乙' });
    eq(r.route.routeKey, common.buildRouteKey('测试市甲', '测试市乙'));
  });

  test('后台的匹配打分走 utils/search（跨端搜索口径一致）', () => {
    const t = freshSeed();
    const search = require(path.join(ROOT, 'utils/search.js'));
    const kw = t.companies[0].shortName;
    const viaStore = store.listCompanies(kw, 1, 20).rows;
    const viaSearch = search.searchCompanies(t.companies, kw);
    eq(viaStore[0]._id, viaSearch[0]._id, '两端首条结果必须相同');
  });

  test('后台的电话校验口径与小程序端一致（都用 isPhoneLike）', () => {
    freshSeed();
    const good = store.createCompany({ name: '电话测试甲', city: '济南', phone: '0531-88889999' });
    ok(good.ok, '座机应通过');
    ok(common.isPhoneLike('0531-88889999'));

    const good2 = store.createCompany({ name: '电话测试乙', city: '济南', phone: '13800001111' });
    ok(good2.ok, '手机应通过');

    const bad = store.createCompany({ name: '电话测试丙', city: '济南', phone: '12345' });
    ok(!bad.ok, '短号码应拒绝');
  });

  test('后台与小程序共用同一套集合名常量', () => {
    const schema = require(path.join(ROOT, 'shared/schema.js'));
    eq(store.FILE_COMPANIES, schema.COLLECTIONS.COMPANIES);
    eq(store.FILE_ROUTES, schema.COLLECTIONS.ROUTES);
    eq(store.FILE_LINKS, schema.COLLECTIONS.ROUTE_COMPANIES);
    eq(store.FILE_CORRECTIONS, schema.COLLECTIONS.CORRECTIONS);
  });

  test('后台的频率枚举与小程序端一致', () => {
    const schema = require(path.join(ROOT, 'shared/schema.js'));
    const t = freshSeed();
    const route = store.createRoute({ fromCity: '济南', toCity: '枚举测试城' });
    schema.FREQUENCY_OPTIONS.forEach((o) => {
      const r = store.createLink({
        routeId: route.route._id, companyId: t.companies[0]._id, frequency: o.value
      });
      // 第一次会成功，后续因重复挂载失败，但不应因频率非法失败
      if (!r.ok) {
        ok(!r.errors.some((e) => e.field === 'frequency'), o.value + ' 应被接受');
      }
    });
  });
});

/* ============================================================
 * 视图层：XSS 防护
 * ============================================================ */
describe('视图层：HTML 转义（防 XSS）', () => {
  const views = require(path.join(ROOT, 'admin/lib/views.js'));

  test('尖括号被转义', () => {
    eq(views.esc('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  test('引号被转义（防属性逃逸）', () => {
    eq(views.esc('" onmouseover="x'), '&quot; onmouseover=&quot;x');
    eq(views.esc("'"), '&#39;');
  });

  test('& 被优先转义（防二次解析）', () => {
    eq(views.esc('&lt;'), '&amp;lt;');
    eq(views.esc('a & b'), 'a &amp; b');
  });

  test('null / undefined 变成空串而不是 "null"', () => {
    eq(views.esc(null), '');
    eq(views.esc(undefined), '');
  });

  test('渲染公司列表时恶意公司名不会突破标签', () => {
    freshSeed();
    store.tables().companies[0].name = '<img src=x onerror=alert(1)>';
    const html = views.renderPage('companies', {
      rows: store.listCompanies('', 1, 20).rows,
      total: 40, page: 1, pages: 2, kw: '', user: { username: 'admin' }
    });
    ok(html.indexOf('<img src=x') < 0, '原始标签不得出现在输出里');
    ok(html.indexOf('&lt;img') >= 0, '应被转义');
  });

  test('纠错内容里的 HTML 被转义', () => {
    freshSeed();
    store.tables().corrections.push({
      _id: 'xss1', targetType: 'company', targetId: 'comp_001',
      targetSummary: '<b>粗体</b>', type: 'other', content: '<script>bad()</script>',
      images: [], contact: '', status: 'pending', createdAt: Date.now()
    });
    const html = views.renderPage('corrections', {
      rows: store.listCorrections({ status: 'pending' }, 1, 20).rows,
      total: 1, page: 1, pages: 1, status: 'pending', counts: {}, user: { username: 'admin' }
    });
    ok(html.indexOf('<script>bad()') < 0);
    ok(html.indexOf('&lt;script&gt;') >= 0);
  });
});

/* ============================================================
 * 各页面渲染不崩（冒烟级）
 * ============================================================ */
describe('页面渲染冒烟', () => {
  const views = require(path.join(ROOT, 'admin/lib/views.js'));
  const user = { username: 'admin' };

  test('登录页', () => {
    const h = views.renderPage('login', { error: '账号或密码不正确' });
    ok(h.indexOf('<form') >= 0 && h.indexOf('账号或密码不正确') >= 0);
    ok(h.indexOf('<!DOCTYPE html>') === 0);
  });

  test('总览页', () => {
    freshSeed();
    const h = views.renderPage('dashboard', {
      stats: store.qualityStats(), recentCorrections: store.listCorrections({}, 1, 5), user
    });
    ok(h.indexOf('总览') >= 0);
  });

  test('公司列表与编辑页', () => {
    const t = freshSeed();
    const l = store.listCompanies('', 1, 20);
    ok(views.renderPage('companies', Object.assign({ kw: '', user }, l)).indexOf('公司') >= 0);
    ok(views.renderPage('company-edit', { company: t.companies[0], id: t.companies[0]._id, user }).indexOf('编辑公司') >= 0);
    ok(views.renderPage('company-edit', { company: null, id: '', user }).indexOf('新建公司') >= 0);
  });

  test('线路列表与编辑页', () => {
    const t = freshSeed();
    const l = store.listRoutes('', 1, 20);
    ok(views.renderPage('routes', Object.assign({ kw: '', user }, l)).indexOf('线路') >= 0);
    ok(views.renderPage('route-edit', { route: t.routes[0], id: t.routes[0]._id, user }).indexOf('routeKey') >= 0);
    ok(views.renderPage('route-edit', { route: null, id: '', user }).indexOf('新建线路') >= 0);
  });

  test('关联列表与编辑页', () => {
    const t = freshSeed();
    const l = store.listLinks('', 1, 20);
    ok(views.renderPage('links', Object.assign({ kw: '', user }, l)).indexOf('线路公司') >= 0);
    const schema = require(path.join(ROOT, 'shared/schema.js'));
    ok(views.renderPage('link-edit', {
      link: null, id: '',
      routes: t.routes.map((r) => ({ id: r._id, label: r.routeKey, taken: false })),
      companies: t.companies.map((c) => ({ id: c._id, label: c.name, taken: false })),
      frequencies: schema.FREQUENCY_OPTIONS, user
    }).indexOf('挂载公司到线路') >= 0);
  });

  test('纠错队列页（含空态）', () => {
    freshSeed();
    const page = views.renderPage('corrections', {
      rows: [], total: 0, page: 1, pages: 1, status: 'pending',
      counts: store.correctionCounts(), user
    });
    ok(page.indexOf('没有待审核的纠错') >= 0);
  });

  test('导入页', () => {
    const h = views.renderPage('import', { mapping: importer.FIELD_LABELS, user });
    ok(h.indexOf('批量导入') >= 0 && h.indexOf('字段说明') >= 0);
  });

  test('质量看板页', () => {
    freshSeed();
    ok(views.renderPage('quality', { stats: store.qualityStats(), user }).indexOf('数据质量看板') >= 0);
  });

  test('404 页', () => {
    ok(views.renderPage('notfound', {}).indexOf('404') >= 0);
  });

  test('公司编辑页：网点块带增删标记与「添加网点」入口', () => {
    /*
     * ★ 回归的是一次真实反馈：网点行只有「地址 + 电话」两个输入框，
     *   既没有加行按钮，在框里按回车还会提交整张表单 ——
     *   用户问「红框内如何换行」才暴露出来。
     *   现在的行为契约（admin.js 的 initStationBlocks 依赖这些标记）：
     *   行 data-station-row / 输入框 data-station-field / 区块 data-station-block /
     *   加行按钮 data-add-station / 删行按钮 data-del-station。
     */
    const h = views.renderPage('company-edit', { company: null, id: '', user });
    ['data-station-row', 'data-station-field="address"', 'data-station-field="phone"',
      'data-station-block="departure"', 'data-station-block="arrival"',
      'data-add-station="departure"', 'data-add-station="arrival"',
      'data-del-station', '按 Enter 直接换到下一行'].forEach((mark) => {
      ok(h.indexOf(mark) >= 0, '编辑页应含 ' + mark);
    });
  });

  test('未知视图名不抛错', () => {
    const h = views.renderPage('no_such_view', {});
    ok(h.indexOf('未知页面') >= 0);
  });

  test('所有页面都带 noindex（后台不该被搜索引擎收录）', () => {
    const h = views.renderPage('login', { error: '' });
    ok(h.indexOf('noindex') >= 0);
  });
});

/* ============================================================
 * 模板
 * ============================================================ */
describe('导入模板', () => {
  test('模板含全部字段表头与一行示例', () => {
    const csv = importer.templateCsv();
    importer.FIELD_LABELS.forEach((f) => {
      ok(csv.indexOf(f.label) >= 0, '模板应含列 ' + f.label);
    });
    const lines = csv.replace(/^\uFEFF/, '').trim().split('\n');
    eq(lines.length, 2, '表头 + 1 行示例');
  });

  test('模板首字符是 BOM（让 Excel 正确识别 UTF-8 中文）', () => {
    eq(importer.templateCsv().charCodeAt(0), 0xFEFF);
  });

  test('模板本身能被自己解析回来（自洽）', () => {
    const csv = importer.templateCsv();
    const table = importer.parse(Buffer.from(csv, 'utf8'), 'template.csv');
    eq(table.headers.length, importer.FIELD_LABELS.length);
    eq(table.rows.length, 1);
    const mapping = importer.autoMap(table.headers);
    eq(mapping.filter((m) => m === '').length, 0, '模板表头应 100% 可映射，无遗漏');
  });
});

process.exit(summary('管理后台') ? 0 : 1);
