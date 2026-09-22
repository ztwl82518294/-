// .workbuddy/scripts/test-searchcompany.js
// searchCompany 云函数聚合逻辑单测（mock DB，不依赖真实云环境）。
//
// 覆盖点：
//   1. 关键词 → 公司名的去重与排序（全等 > 前缀 > 线路数）
//   2. 公司统计：出发/到达城市去重数、规模分级、认证口径
//   3. VIP 口径必须与 utils/vip.js effectiveVip 一致（isVip=1 且未过期）
//   4. 覆盖线路按出发城市分组、组内按到达城市排序
//   5. 发站/到站信息：老字段 / 网点数组 / 字符串网点 三种形态都要能归一
//   6. status=0 的下架线路不得计入统计
//   7. 元信息：updateText 由 _id 时间戳反推（含非法 _id 的容错）、viewCount 从
//      stat_events 计数且失败时静默归零（不得拖垮主流程）

const path = require('path');
const Module = require('module');

// 拦截 require('wx-server-sdk')
// 注意：mock 必须在调用 database() 时读取 CURRENT_LINES 的"当前值"，
// 若在 require 时就把数组切片固化下来，后续赋值 CURRENT_LINES 将不生效。
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === 'wx-server-sdk') return '__mock_wx_sdk__';
  return originalResolve.call(this, request, ...args);
};
require.cache.__mock_wx_sdk__ = {
  id: '__mock_wx_sdk__',
  filename: '__mock_wx_sdk__',
  loaded: true,
  exports: {
    init() {},
    DYNAMIC_CURRENT_ENV: 'mock-env',
    // 用 getter 代理，保证每次 collection 查询都读到最新的 CURRENT_LINES
    database: () => ({
      command: {
        neq: v => ({ __op: 'neq', v }),
        in: v => ({ __op: 'in', v })
      },
      RegExp: ({ regexp, options }) => ({ __isRegexp: true, regexp, options }),
      collection: name =>
        name === 'stat_events'
          ? mockStatEvents(() => CURRENT_EVENTS)
          : mockCollection(() => CURRENT_LINES)
    })
  }
};

// stat_events：只支持 where(type,key in [...]) + count()
// VIEW_SHOULD_THROW 为 true 时 count() 抛错，用于验证"统计失败不影响主流程"
function mockStatEvents(getEvents) {
  let rows = [];
  const api = {
    where(cond) {
      rows = getEvents().filter(e => matchesCond(e, cond));
      return api;
    },
    count() {
      if (VIEW_SHOULD_THROW) return Promise.reject(new Error('mock: 集合不存在'));
      return Promise.resolve({ total: rows.length });
    }
  };
  return api;
}

function mockCollection(getLines) {
  let rows = getLines().slice();
  let fields = null;
  const api = {
    where(cond) { rows = rows.filter(r => matchesCond(r, cond)); return api; },
    field(f) { fields = f; return api; },
    orderBy(field, dir) {
      rows.sort((a, b) => {
        const x = a[field], y = b[field];
        if (x === y) return 0;
        return (x > y ? 1 : -1) * (dir === 'desc' ? -1 : 1);
      });
      return api;
    },
    skip(n) { rows = rows.slice(n); return api; },
    limit(n) { rows = rows.slice(0, n); return api; },
    get() {
      const data = rows.map(r => {
        if (!fields) return Object.assign({}, r);
        const o = {};
        Object.keys(fields).forEach(k => { if (fields[k]) o[k] = r[k]; });
        return o;
      });
      return Promise.resolve({ data });
    }
  };
  return api;
}

function matchesCond(doc, cond) {
  return Object.keys(cond).every(k => {
    const want = cond[k];
    const got = doc[k];
    if (want && want.__op === 'neq') return got !== want.v;
    if (want && want.__op === 'or') return want.v.some(sub => matchesCond(doc, sub));
    if (want && want.__op === 'in') return want.v.indexOf(got) !== -1;
    if (want && want.__isRegexp) return new RegExp(want.regexp, want.options || '').test(String(got || ''));
    return got === want;
  });
}

let CURRENT_LINES = [];
let CURRENT_EVENTS = [];
let VIEW_SHOULD_THROW = false;

const fn = require(path.resolve(__dirname, '..', '..', 'cloudfunctions', 'searchCompany', 'index.js'));

// ===== 断言工具 =====
let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('PASS ' + name); }
  else { failed++; console.log('FAIL ' + name); }
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { passed++; console.log('PASS ' + name); }
  else { failed++; console.log('FAIL ' + name + '  实际=' + a + ' 期望=' + b); }
}

// ===== 构造测试数据 =====
const NOW = Date.now();
const FUTURE = NOW + 86400000 * 30;  // 30 天后
const PAST = NOW - 86400000;         // 昨天（已过期）

// 造一个合法的 ObjectId（24 位十六进制，前 8 位 = 创建时间秒）。
// 元信息 updateText 就是从这里反推的，测试必须用真形态数据才有效。
// 注意：8 位时间戳 + 16 位机器码/计数器 = 24 位，多一位都会让 ID_TIME_RE 判定失败。
function oid(msAgo) {
  const sec = Math.floor((NOW - msAgo) / 1000);
  return sec.toString(16).padStart(8, '0') + 'aabbccddeeff0011';
}
const T_3D = 3 * 86400000;   // 3 天前
const T_100D = 100 * 86400000; // 100 天前（超过 90 天阈值 → 应不显示）

CURRENT_LINES = [
  // 齐鲁快运：5 条线，含认证、含 valid VIP、含过期 VIP
  // _id 用真 ObjectId 形态，最新一条是 3 天前（a5）→ updateText 应为 "3天前"
  { _id: oid(T_3D), id: '1', companyName: '山东齐鲁快运有限公司', title: '济南→青岛', fromCityName: '济南市', toCityName: '青岛市', status: 1, certified: 1, isVip: 1, vipExpireAt: FUTURE, aging: '1天', tags: ['天天发车'], lineType: '直达', fromAddress: '济南市历城区工业北路物流中心3栋', fromPhone: '0531-88110003' },
  { _id: oid(T_3D + 86400000), id: '2', companyName: '山东齐鲁快运有限公司', title: '济南→临沂', fromCityName: '济南市', toCityName: '临沂市', status: 1, isVip: 1, vipExpireAt: FUTURE, aging: '1天', tags: ['天天发车'], lineType: '直达' },
  { _id: oid(30 * 86400000), id: '3', companyName: '山东齐鲁快运有限公司', title: '济南→上海', fromCityName: '济南市', toCityName: '上海市', status: 1, isVip: 1, vipExpireAt: PAST, aging: '2天', tags: ['天天发车'], lineType: '直达' },
  { _id: oid(60 * 86400000), id: '4', companyName: '山东齐鲁快运有限公司', title: '济南→广州', fromCityName: '济南市', toCityName: '广州市', status: 1, aging: '3天', tags: ['天天发车'], lineType: '中转' },
  { _id: oid(T_3D + 1000), id: '5', companyName: '山东齐鲁快运有限公司', title: '济南→北京', fromCityName: '济南市', toCityName: '北京市', status: 1, aging: '2天', toAddress: '青岛市黄岛区前湾港路物流园5号库', toPhone: '0532-88110005' },

  // 已下架线路：不得计入统计
  { _id: oid(86400000), id: '6', companyName: '山东齐鲁快运有限公司', title: '济南→天津', fromCityName: '济南市', toCityName: '天津市', status: 0, certified: 1 },

  // 齐鲁另一家：验证同一关键词命中多家公司
  { _id: oid(5 * 86400000), id: '7', companyName: '齐鲁物流（青岛）有限公司', title: '青岛→济南', fromCityName: '青岛市', toCityName: '济南市', status: 1, aging: '1天' },

  // 不相关公司：不得被 "齐鲁" 命中
  { _id: oid(86400000), id: '8', companyName: '鲁通物流有限公司', title: '潍坊→南京', fromCityName: '潍坊市', toCityName: '南京市', status: 1 },

  // 网点数组形态（新版 adminLine 写入）
  { _id: oid(86400000), id: '9', companyName: '测试网点公司', title: '济宁→徐州', fromCityName: '济宁市', toCityName: '徐州市', status: 1,
    fromOutlets: [{ addr: '济宁市任城区物流园A区', phone: '0537-1111111' }, { addr: '济宁市兖州区货场', phone: '0537-2222222' }],
    toOutlets: '徐州市云龙区某仓库 | 0516-3333333' },

  // VIP 无到期时间 = 永久有效（口径护栏）
  { _id: oid(86400000), id: '10', companyName: '永久会员公司', title: '济南→泰安', fromCityName: '济南市', toCityName: '泰安市', status: 1, isVip: 1 },

  // _id 非 ObjectId 形态（手工指定过主键的历史数据）→ updateText 必须为空串
  { _id: 'manual-key-0', id: '11', companyName: '手工主键公司', title: '济南→淄博', fromCityName: '济南市', toCityName: '淄博市', status: 1 },

  // 所有线路都很旧（> 90 天）→ updateText 必须为空串（不显示"286天前"）
  { _id: oid(T_100D), id: '12', companyName: '老旧数据公司', title: '济南→聊城', fromCityName: '济南市', toCityName: '聊城市', status: 1 },

  // ★ v6.2 回归：直灌数据的"1 个地址行 + N 个纯电话行"（截图场景）
  //   必须归并为 1 个站（单地址多电话），不得渲染成 3 个"地址未填写"的站。
  { _id: oid(2 * 86400000), id: '13', companyName: '直灌电话公司', title: '济南→重庆',
    fromCityName: '济南市', toCityName: '重庆市', status: 1,
    fromOutlets: '山东省济南市槐荫区美里湖街道美里北路6号—家通物流园东首 | 053182518294\n15165018553\n15508675779' },

  // 多地址，各带自己的电话 → 地址与电话必须保持一一对应（不得错位）
  { _id: oid(2 * 86400000), id: '14', companyName: '多地址公司', title: '济南→郑州',
    fromCityName: '济南市', toCityName: '郑州市', status: 1,
    fromOutlets: 'A园区1号 | 13800000001\nB园区2号 | 13800000002' },

  // 只有电话、完全没有地址 → 合并成唯一一站，且 addr 为空（前端不再显示"地址未填写"）
  { _id: oid(2 * 86400000), id: '15', companyName: '纯电话公司', title: '济南→太原',
    fromCityName: '济南市', toCityName: '太原市', status: 1,
    fromOutlets: '13800000001\n13800000002' }
];

(async () => {
  // ===== 1. 关键词搜索 =====
  let r = await fn.main({ action: 'search', keyword: '齐鲁' });
  ok('搜索返回 ok', r.ok === true);
  eq('命中 2 家公司', r.total, 2);
  eq('排序：前缀命中优先（齐鲁物流（青岛）在山东齐鲁之前？不，按全等/前缀/线路数）',
    r.companies.map(c => c.companyName),
    ['齐鲁物流（青岛）有限公司', '山东齐鲁快运有限公司']);

  // 全等优先级最高
  r = await fn.main({ action: 'search', keyword: '齐鲁物流（青岛）有限公司' });
  eq('全等关键词排第一', r.companies[0] && r.companies[0].companyName, '齐鲁物流（青岛）有限公司');

  // 不相关关键词
  r = await fn.main({ action: 'search', keyword: '不存在的公司xyz' });
  eq('无结果时 total=0', r.total, 0);
  eq('无结果时 companies 为空数组', r.companies, []);

  // 空关键词
  r = await fn.main({ action: 'search', keyword: '' });
  eq('空关键词不报错且返回空', r.total, 0);

  // 正则元字符不得导致崩溃
  r = await fn.main({ action: 'search', keyword: '齐鲁(' });
  ok('正则元字符输入不崩溃', r.ok === true);

  // ===== 2. 公司统计（status=0 必须排除）=====
  r = await fn.main({ action: 'search', keyword: '齐鲁' });
  const qilu = r.companies.find(c => c.companyName === '山东齐鲁快运有限公司');
  eq('在营线路数 5（下架的排除）', qilu.lineCount, 5);
  eq('出发城市去重 = 1（济南）', qilu.fromCityCount, 1);
  eq('到达城市去重 = 5', qilu.toCityCount, 5);
  eq('认证口径：任一线路认证即已核实', qilu.certified, true);
  eq('VIP 有效数 2（a1/a2 有效，a3 已过期）', qilu.vipCount, 2);
  eq('规模分级：5 条 = 小型', qilu.scale, '小型');
  eq('主要出发城市 = 济南', qilu.mainCity, '济南');

  // 永久 VIP 口径
  r = await fn.main({ action: 'search', keyword: '永久会员公司' });
  eq('vipExpireAt 缺失视为永久有效', r.companies[0].vipCount, 1);

  // ===== 3. 公司详情 =====
  r = await fn.main({ action: 'detail', name: '山东齐鲁快运有限公司' });
  ok('详情返回 ok', r.ok === true);
  const c = r.company;
  eq('详情统计：覆盖线路 5', c.lineCount, 5);
  eq('详情统计：出发城市 1 / 到达城市 5', [c.fromCityCount, c.toCityCount], [1, 5]);
  eq('分组数 = 1（全部济南出发）', c.groups.length, 1);
  eq('分组名为 济南', c.groups[0].city, '济南');
  // 注意：展示口径走 normCity（去"市"后缀），与 searchLine 的索引口径一致
  eq('组内按到达城市排序（北京→广州→临沂→青岛→上海）',
    c.groups[0].lines.map(l => l.toCityName),
    ['北京', '广州', '临沂', '青岛', '上海']);
  // ref 取 _id（24 位 ObjectId 形态），不再是旧的字面量 'a5'
  eq('线路 ref 用 _id 优先', c.groups[0].lines[0].ref, c.groups[0].lines[0]._id);
  ok('线路 ref 是 ObjectId 形态（24 位十六进制）', /^[0-9a-f]{24}$/.test(c.groups[0].lines[0].ref));
  eq('中转标记正确', c.groups[0].lines.find(l => l.toCityName === '广州').transfer, true);
  eq('已过期 VIP 不再标为会员', c.groups[0].lines.find(l => l.toCityName === '上海').isVip, 0);

  // 发站 / 到站
  eq('发站 1 个（老字段）', c.fromStations.length, 1);
  ok('发站地址正确', c.fromStations[0].addr.indexOf('工业北路') !== -1);
  eq('到站 1 个（老字段）', c.toStations.length, 1);

  // 公司简介不得编造
  ok('公司简介含覆盖城市描述', /覆盖\s*1\s*个出发城市/.test(c.summary));
  ok('公司简介含免责表述', /公开渠道整理/.test(c.summary));

  // 缺少公司名
  r = await fn.main({ action: 'detail', name: '' });
  eq('详情缺公司名返回错误', r.ok, false);

  // 不存在的公司
  r = await fn.main({ action: 'detail', name: '不存在的公司' });
  eq('详情不存在的公司返回错误', r.ok, false);

  // ===== 4. 网点形态归一（数组 / 字符串）=====
  r = await fn.main({ action: 'detail', name: '测试网点公司' });
  eq('网点数组形态：发站解析出 2 个', r.company.fromStations.length, 2);
  ok('网点数组：addr/phone 正确配对',
    r.company.fromStations[0].addr === '济宁市任城区物流园A区' && r.company.fromStations[0].phone === '0537-1111111');
  eq('网点字符串形态：到站解析出 1 个', r.company.toStations.length, 1);
  ok('字符串网点：地址电话正确拆分',
    r.company.toStations[0].addr === '徐州市云龙区某仓库' && r.company.toStations[0].phone === '0516-3333333');

  // ===== 4b. ★ v6.2 回归：单地址多电话必须归并为 1 站（R-13 读端口径）=====
  // 场景：直灌数据是"1 个地址行 + 2 个纯电话行"。
  // 修复前会渲染成 3 站（②③ 显示"地址未填写"），与 R-13
  // "单地址多电话保持 1 网点挂多号"直接冲突。
  r = await fn.main({ action: 'detail', name: '直灌电话公司' });
  const ds = r.company.fromStations;
  eq('单地址多电话 → 归并为 1 站（不再造"地址未填写"的空站）', ds.length, 1);
  ok('该站挂了全部 3 个号码', ds[0].phone.split('、').length === 3);
  ok('3 个号码含座机与两个手机且未排序丢失',
    ds[0].phone.split('、').join(',') === '053182518294,15165018553,15508675779');
  ok('地址保留且不重复出现', ds[0].addr.indexOf('美里北路6号') !== -1);
  eq('不存在 addr 为空的站', ds.filter(s => !s.addr).length, 0);

  // 多地址各自带电话 → 一一对应，不得错位/漏站
  r = await fn.main({ action: 'detail', name: '多地址公司' });
  const ms = r.company.fromStations;
  eq('多地址各带电话 → 2 个站', ms.length, 2);
  ok('地址与电话保持一一对应（未按下标错位）',
    ms[0].addr === 'A园区1号' && ms[0].phone === '13800000001'
    && ms[1].addr === 'B园区2号' && ms[1].phone === '13800000002');

  // 只有电话没有地址 → 唯一 1 站，addr 为空（前端不再渲染"地址未填写"）
  r = await fn.main({ action: 'detail', name: '纯电话公司' });
  const ps2 = r.company.fromStations;
  eq('纯电话数据 → 合并为 1 站', ps2.length, 1);
  ok('纯电话站 addr 为空（前端整行不渲染）', ps2[0].addr === '');
  eq('纯电话站的号码全部保留', ps2[0].phone, '13800000001、13800000002');

  // 号码顺序必须保持录入顺序（不再 .sort()）
  ok('号码未排序：座机在前、手机保持原序',
    ds[0].phone.indexOf('053182518294') === 0);

  // ===== 5. 元信息：updateText（由 _id 时间戳反推）=====
  r = await fn.main({ action: 'detail', name: '山东齐鲁快运有限公司' });
  eq('更新时间取最新一条线路 → "3天前"', r.company.updateText, '3天前');

  // 列表页也要有
  r = await fn.main({ action: 'search', keyword: '齐鲁' });
  const q2 = r.companies.find(x => x.companyName === '山东齐鲁快运有限公司');
  eq('列表卡片同样带 updateText', q2.updateText, '3天前');
  // 不再返回旧的假文案
  ok('不再返回硬编码的"近期更新"', q2.updateText !== '近期更新');

  // _id 非 ObjectId（手工指定主键）→ 必须空串，前端整项不渲染
  r = await fn.main({ action: 'detail', name: '手工主键公司' });
  eq('非 ObjectId 主键 → updateText 为空串', r.company.updateText, '');
  ok('详情仍能正常返回', r.ok === true && r.company.lineCount === 1);

  // 全部线路均超过 90 天 → 空串（不显示"286天前"这种无意义信息）
  r = await fn.main({ action: 'detail', name: '老旧数据公司' });
  eq('超 90 天的数据 → updateText 为空串', r.company.updateText, '');

  // ===== 6. 元信息：viewCount（stat_events 计数）=====
  // 造 3 条该公司的浏览事件 + 1 条无关事件（不得计入）
  const qiluIds = CURRENT_LINES
    .filter(l => l.companyName === '山东齐鲁快运有限公司')
    .map(l => l.id || l._id);
  CURRENT_EVENTS = [
    { type: 'view', key: qiluIds[0] },
    { type: 'view', key: qiluIds[0] },
    { type: 'view', key: qiluIds[1] },
    { type: 'view', key: 'someone-else' },   // 不得计入
    { type: 'search', key: qiluIds[0] }      // 类型不符，不得计入
  ];
  r = await fn.main({ action: 'detail', name: '山东齐鲁快运有限公司' });
  eq('浏览量 = 3（同 id 记 2 次 + 另一 id 1 次）', r.company.viewCount, 3);

  // 无浏览事件 → 0（前端不渲染）
  CURRENT_EVENTS = [];
  r = await fn.main({ action: 'detail', name: '山东齐鲁快运有限公司' });
  eq('无浏览数据 → viewCount 为 0', r.company.viewCount, 0);

  // 统计接口抛错（模拟集合不存在 / 超时）→ 必须静默归零，主流程不受影响
  VIEW_SHOULD_THROW = true;
  r = await fn.main({ action: 'detail', name: '山东齐鲁快运有限公司' });
  eq('统计失败时 viewCount 归 0', r.company.viewCount, 0);
  ok('统计失败不影响详情主数据', r.ok === true && r.company.lineCount === 5);
  ok('统计失败不影响分站信息', r.company.fromStations.length === 1);
  VIEW_SHOULD_THROW = false;

  console.log('\n' + (failed ? 'FAILED' : 'ALL PASSED') + ` — ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.error('测试异常：', e);
  process.exit(1);
});
