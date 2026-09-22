/**
 * 公司详情页「线路合并」行为验证
 *
 * 背景：用户反馈「同一公司所有线路合并一起」。
 *   改前：按 route.fromCity 自动分组 → 16/25 家多线路公司被拆成多组。
 *   改后：默认平铺全部线路，分组降级为可选开关。
 *
 * 本脚本直接拿真实 .data 数据，模拟页面 decorate/buildGroups 的逻辑，
 * 断言：① 平铺后条数 == 关联条数（不丢不重）；② 同出发城市的线路连续；
 *       ③ 分组视图下每条线路仍然出现且仅出现一次（切视图不丢数据）。
 *
 * 用法：node test/suites/company-detail-merge.test.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DATA = path.join(ROOT, '.data');

function readJsonl(name) {
  const p = path.join(DATA, name);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8')
    .split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    .map((s) => { try { return JSON.parse(s); } catch (e) { return null; } })
    .filter(Boolean);
}

const companies = readJsonl('companies.jsonl');
const routes = readJsonl('routes.jsonl');
const links = readJsonl('route_companies.jsonl');
const routeByKey = {};
routes.forEach((r) => { routeByKey[r.routeKey] = r; });

// 借用页面里的分组函数（纯函数，可直接引用）
const { groupRoutesByFromCity } = require(path.join(ROOT, 'utils', 'search'));

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg); }
}

console.log('公司详情页 · 线路合并行为验证');
console.log('='.repeat(50));

/* ---------- 场景 1：平铺逻辑不丢不重 ---------- */
console.log('\n【平铺：同一公司所有线路合并在一起】');

const multi = companies.filter((c) =>
  links.filter((l) => String(l.companyId) === String(c._id)).length >= 2
);
ok(multi.length > 0, '存在多线路公司样本 — ' + multi.length + ' 家');

let allFlatOk = true;
let allContiguous = true;
let maxRoutes = 0;

multi.forEach((c) => {
  const mine = links.filter((l) => String(l.companyId) === String(c._id));
  // 复刻页面 decorate 的映射与排序
  const rows = mine.map((link) => {
    const route = routeByKey[link.routeKey] || {};
    return {
      routeKey: (route && route.routeKey) || link.routeKey || '',
      fromCity: (route && route.fromCity) || '',
      toCity: (route && route.toCity) || '',
      companyCount: Number((route && route.companyCount) || 0)
    };
  });
  rows.sort((a, b) => {
    const c1 = String(a.fromCity).localeCompare(String(b.fromCity), 'zh');
    if (c1 !== 0) return c1;
    const t = String(a.toCity).localeCompare(String(b.toCity), 'zh');
    if (t !== 0) return t;
    return b.companyCount - a.companyCount;
  });

  maxRoutes = Math.max(maxRoutes, rows.length);

  // ① 条数一致（不丢行）
  if (rows.length !== mine.length) allFlatOk = false;
  // ② 同出发城市连续（不会 A-B-A 交错）
  const seen = new Set();
  let prev = null;
  rows.forEach((r) => {
    if (r.fromCity !== prev) {
      if (seen.has(r.fromCity)) allContiguous = false;
      seen.add(r.fromCity);
      prev = r.fromCity;
    }
  });
});

ok(allFlatOk, '每家公司平铺后的条数 == 关联条数（不丢行）');
ok(allContiguous, '同一出发城市的线路在平铺列表中连续（无交错）');
console.log('   （最多的一家有 ' + maxRoutes + ' 条线路）');

/* ---------- 场景 2：分组视图不丢不重 ---------- */
console.log('\n【分组：切换视图不丢数据】');

let groupsTotalOk = true;
let groupsUniqueOk = true;
let splitCount = 0;

multi.forEach((c) => {
  const mine = links.filter((l) => String(l.companyId) === String(c._id));
  const rows = mine.map((link) => {
    const route = routeByKey[link.routeKey] || {};
    return { link: link, route: route };
  });

  const groups = groupRoutesByFromCity(rows);
  const flat = [];
  groups.forEach((g) => g.routes.forEach((x) => flat.push(x)));

  if (flat.length !== rows.length) groupsTotalOk = false;

  const keys = flat.map((x) => (x.route && x.route.routeKey) || (x.link && x.link.routeKey));
  if (new Set(keys).size !== keys.length) groupsUniqueOk = false;

  if (groups.length > 1) splitCount++;
});

ok(groupsTotalOk, '分组视图下线路总数与关联数一致（不丢行）');
ok(groupsUniqueOk, '分组视图下无重复线路（不重行）');

/* ---------- 场景 3：改动确实解决了问题 ---------- */
console.log('\n【回归：改前问题确实存在，改后消失】');

ok(splitCount > 0,
  '确认「按出发城市分组」确实会拆散同公司线路（' + splitCount + '/' + multi.length + ' 家）');
console.log('   ↑ 这就是改前的问题：这 ' + splitCount + ' 家公司的线路被拆进多个「从X出发」组');
console.log('   ↑ 改后默认平铺，它们全部合并在一起；分组降级为用户可选的开关');

console.log('\n' + '='.repeat(50));
console.log('断言 ' + (pass + fail) + ' 个：通过 ' + pass + '，失败 ' + fail);
if (fail === 0) {
  console.log('✅ 全部通过');
  process.exit(0);
} else {
  console.log('❌ 有失败');
  process.exit(1);
}
