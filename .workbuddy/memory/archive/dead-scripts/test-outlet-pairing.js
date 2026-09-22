// .workbuddy/scripts/test-outlet-pairing.js
// 网点分组（地址 ↔ 电话配对）单测 —— pages/line-detail/index.js 的 buildOutlets。
//
// 背景（v6.2 修的真实缺陷）：
//   直灌数据的网点是"1 个地址行 + N 个纯电话行"（utils/outlets.js 形态②）。
//   修复前逐行成组，渲染成「① 地址 / ② 地址未填写 / ③ 地址未填写」，
//   用户看到的是"多个发站地址"，但这其实是 1 个地址挂了 3 个电话。
//   PRD R-13 明确要求"单地址多电话保持 1 网点挂多号"，读端也必须遵守。
//
// 本测试把 buildOutlets 的逻辑从页面里抽出来独立验证（页面文件不能直接 require，
// 因为顶层有 wx API）。改动 buildOutlets 时**必须同步改这里**。

const outlets = require('../../utils/outlets.js');

// —— 与 pages/line-detail/index.js 保持一致的三个方法 ——
// （若页面里改了实现，这里的副本必须同步，否则测试会失去意义）
function splitPhones(phone) {
  const out = [];
  const seen = new Set();
  String(phone || '').split(/[,，、;；/\s]+/).forEach(p => {
    p = p.trim();
    if (p && !seen.has(p)) { seen.add(p); out.push(p); }
  });
  return out;   // 不排序：保持录入顺序
}

function splitAddrs(addr) {
  const out = [];
  const seen = new Set();
  String(addr || '').split(/[\r\n;；|｜]+/).forEach(a => {
    a = a.trim();
    if (a && !seen.has(a)) { seen.add(a); out.push(a); }
  });
  return out;   // 不排序：保持录入顺序
}

function buildOutlets(outletList, addrs, phones) {
  const src = Array.isArray(outletList) ? outletList : [];
  let raw = [];
  if (src.length) {
    src.forEach(o => {
      const addr = (o && (o.addr || o.address)) || '';
      const ps = splitPhones((o && (o.phone || o.tel)) || '');
      if (!addr && ps.length === 0) return;
      raw.push({ addr, phones: ps });
    });
  }
  if (!raw.length) {
    const n = Math.max(addrs.length, phones.length);
    for (let i = 0; i < n; i++) {
      raw.push({ addr: addrs[i] || '', phones: phones[i] ? [phones[i]] : [] });
    }
  }
  const withAddr = raw.filter(r => r.addr);
  const withoutAddr = raw.filter(r => !r.addr);
  const tailPhones = [];
  const tailSeen = new Set();
  withoutAddr.forEach(r => r.phones.forEach(p => {
    if (!tailSeen.has(p)) { tailSeen.add(p); tailPhones.push(p); }
  }));
  const groups = withAddr.map(r => ({ addr: r.addr, phones: r.phones.slice() }));
  if (groups.length === 0) {
    groups.push({ addr: '', phones: tailPhones });
  } else if (tailPhones.length) {
    const head = groups[0];
    const seenInHead = new Set(head.phones);
    tailPhones.forEach(p => {
      if (!seenInHead.has(p)) { seenInHead.add(p); head.phones.push(p); }
    });
  }
  return groups.map((g, i) => ({ idx: i + 1, addr: g.addr, phones: g.phones }));
}

// —— 断言工具 ——
let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name); }
}
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + '\n        期望 ' + w + '\n        实际 ' + g); }
}

// 把"原始网点字段"走一遍 deriveLegacy（与详情页 loadLine 同链路）再分组
function build(rawOutlets) {
  const rec = { fromOutlets: rawOutlets, fromAddress: '', fromPhone: '' };
  outlets.deriveLegacy(rec, 'from');
  const addrs = splitAddrs(rec.fromAddress);
  const phones = splitPhones(rec.fromPhone);
  return buildOutlets(rec.fromOutlets, addrs, phones);
}

console.log('\n== 1. 截图场景：1 个地址行 + 2 个纯电话行（修复目标）==');
{
  const raw = '山东省济南市槐荫区美里湖街道美里北路6号—家通物流园东首 | 053182518294\n15165018553\n15508675779';
  const g = build(raw);
  eq('归并为 1 组（不再是 3 组）', g.length, 1);
  ok('不存在 addr 为空的组（不再出现"地址未填写"）', g.filter(x => !x.addr).length === 0);
  eq('1 个地址挂全部 3 个号码', g[0].phones, ['053182518294', '15165018553', '15508675779']);
  ok('号码保持录入顺序（座机在前，未被 sort 打乱）', g[0].phones[0] === '053182518294');
}

console.log('\n== 2. 多地址各自带电话：必须一一对应 ==');
{
  const raw = 'A园区1号 | 13800000001\nB园区2号 | 13800000002';
  const g = build(raw);
  eq('2 个地址 → 2 组', g.length, 2);
  eq('第 1 组地址', g[0].addr, 'A园区1号');
  eq('第 1 组电话（未错位）', g[0].phones, ['13800000001']);
  eq('第 2 组地址', g[1].addr, 'B园区2号');
  eq('第 2 组电话（未错位）', g[1].phones, ['13800000002']);
}

console.log('\n== 3. 多地址 + 尾随纯电话：尾随号码并入第一个地址组 ==');
{
  const raw = 'A园区1号 | 13800000001\nB园区2号 | 13800000002\n13900000009';
  const g = build(raw);
  eq('仍为 2 组（纯电话不独立成组）', g.length, 2);
  eq('第 1 组挂 2 个号码（自有 + 尾随）', g[0].phones, ['13800000001', '13900000009']);
  eq('第 2 组不受影响', g[1].phones, ['13800000002']);
}

console.log('\n== 4. 完全没有地址：合并为唯一 1 组，addr 为空 ==');
{
  const raw = '13800000001\n13800000002';
  const g = build(raw);
  eq('合并为 1 组', g.length, 1);
  eq('addr 为空（前端整行不渲染，不显示"地址未填写"）', g[0].addr, '');
  eq('号码全部保留', g[0].phones, ['13800000001', '13800000002']);
}

console.log('\n== 5. 标准对象数组（新版 adminLine 写入）==');
{
  const raw = [
    { addr: 'A园区1号', phone: '13800000001,13800000002' },
    { addr: 'B园区2号', phone: '13800000003' }
  ];
  const g = build(raw);
  eq('2 组', g.length, 2);
  eq('第 1 组多号码', g[0].phones, ['13800000001', '13800000002']);
  eq('第 2 组单号码', g[1].phones, ['13800000003']);
}

console.log('\n== 6. 无网点字段，只有老字段（按下标对位）==');
{
  const g = buildOutlets(null, ['A园区1号', 'B园区2号'], ['13800000001', '13800000002']);
  eq('2 组', g.length, 2);
  eq('下标对位正确', [g[0].addr, g[0].phones[0], g[1].addr, g[1].phones[0]],
    ['A园区1号', '13800000001', 'B园区2号', '13800000002']);
}

console.log('\n== 7. 地址 / 电话数量不等 ==');
{
  // 1 个地址 + 2 个电话：多出的那个电话在旧实现下会自成一"地址未填写"组，
  // 新实现按 R-13 并入该地址（单地址多电话 = 1 网点挂多号），信息不丢。
  const g = buildOutlets(null, ['A园区1号'], ['13800000001', '13800000002']);
  eq('归并为 1 组（不再拆出"地址未填写"的空组）', g.length, 1);
  eq('该地址挂全部 2 个号码（不丢信息）', g[0].phones, ['13800000001', '13800000002']);
  ok('不存在 addr 为空的组', g.filter(x => !x.addr).length === 0);
}
{
  // 反向：2 个地址 + 1 个电话 → 第 2 个地址没有电话，但地址本身必须保留
  const g = buildOutlets(null, ['A园区1号', 'B园区2号'], ['13800000001']);
  eq('2 个地址都保留', g.length, 2);
  eq('第 1 组有电话', g[0].phones, ['13800000001']);
  eq('第 2 组无电话（phones 为空数组，模板不渲染电话行）', g[1].phones, []);
  eq('第 2 组地址仍在', g[1].addr, 'B园区2号');
}

console.log('\n== 8. 重复号码去重 / 组内不重复 ==');
{
  const g = build('A园区1号 | 13800000001,13800000001\n13800000001');
  eq('1 组', g.length, 1);
  eq('重复号码只留一个', g[0].phones, ['13800000001']);
}

console.log('\n== 9. idx 连续编号（模板用 {{index+1}}，但 key 依赖 idx）==');
{
  const g = build('A园区1号 | 13800000001\nB园区2号 | 13800000002\nC园区3号 | 13800000003');
  eq('idx 从 1 连续递增', g.map(x => x.idx), [1, 2, 3]);
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);
