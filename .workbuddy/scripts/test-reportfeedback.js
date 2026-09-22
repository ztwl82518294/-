// .workbuddy/scripts/test-reportfeedback.js
// reportFeedback 云函数单测（mock DB + mock cloud.getWXContext，不依赖真实云环境）。
//
// 为什么值得为它单独写测试：这个函数是**外部的、公开的写入接口**——
// 任何人拿着小程序都能调用。它同时承担"写入正确性"与"抗滥用"两个职责，
// 而这两者都不能靠前端保证。测的就是服务端这几道关：
//
//   1. 类型必须在白名单内（前端 label 不被信任，服务端反查自己的映射表）
//   2. 说明必填、长度截断到 DETAIL_MAX（前端 maxlength 可被绕过）
//   3. 图片数量截断到 3 张、fileID 去重、超长 fileID 被裁掉
//   4. 频控：同用户当日达上限时拒写
//   5. _openid 必须由服务端注入（前端传什么都不算数）
//   6. 异常路径不得抛穿（应返回 { ok:false }，而不是让小程序侧拿到 undefined）
//
// 注意：本文件**独立复刻**了云函数的校验规则做"期望值"，而非从云函数导入。
// 这是刻意的——如果从云函数导出常量再比对，常量改了测试跟着改，等于没测。
// 所以下面这些数字改动云函数时，必须同步改这里（与 test-outlet-pairing.js 同约定）。

const path = require('path');
const Module = require('module');

// ---- mock wx-server-sdk ----
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === 'wx-server-sdk') return '__mock_wx_sdk__';
  return originalResolve.call(this, request, ...args);
};

// 可控的写入行为：WRITE_SHOULD_THROW=true 时 add() 抛错，验证异常路径
let WRITE_SHOULD_THROW = false;
// 可控的 openid：'' 表示取不到（未登录/异常）
let CURRENT_OPENID = 'openid-A';
// 计数抛错开关
let COUNT_SHOULD_THROW = false;
// 频控查询的返回条数
let CURRENT_DAY_COUNT = 0;
// 捕获所有写入的文档（断言用）
let WRITTEN = [];

function mockFeedbackCollection() {
  const api = {
    where() { return api; },
    count() {
      if (COUNT_SHOULD_THROW) return Promise.reject(new Error('mock: count 失败'));
      return Promise.resolve({ total: CURRENT_DAY_COUNT });
    },
    add({ data }) {
      if (WRITE_SHOULD_THROW) return Promise.reject(new Error('mock: 写入失败'));
      WRITTEN.push(data);
      return Promise.resolve({ _id: 'mock-id-' + WRITTEN.length });
    }
  };
  return api;
}

require.cache.__mock_wx_sdk__ = {
  id: '__mock_wx_sdk__',
  filename: '__mock_wx_sdk__',
  loaded: true,
  exports: {
    init() {},
    DYNAMIC_CURRENT_ENV: 'mock-env',
    getWXContext: () => ({ OPENID: CURRENT_OPENID }),
    database: () => ({
      createCollection: () => Promise.reject(new Error('mock: 已存在')),
      collection: () => mockFeedbackCollection()
    })
  }
};

const fn = require(path.resolve(__dirname, '..', '..', 'cloudfunctions', 'reportFeedback', 'index.js'));

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

// 每个用例前重置状态，避免相互污染
function reset() {
  WRITTEN = [];
  WRITE_SHOULD_THROW = false;
  CURRENT_OPENID = 'openid-A';
  COUNT_SHOULD_THROW = false;
  CURRENT_DAY_COUNT = 0;
}

// 一组合法基础参数，各用例在其上做单点改动
function base(extra) {
  return Object.assign({
    action: 'submit',
    type: 'phone',
    detail: '这个电话是空号，正确的应该是 0531-88888888',
    images: [],
    contact: '13800000000',
    target: '齐鲁快运',
    targetKind: 'line',
    targetKey: 'a1b2c3d4e5f6a1b2c3d4e5f6'
  }, extra || {});
}

async function run() {
  // ================= 1. 正常提交 =================
  console.log('\n== 1. 正常提交：字段完整落库 ==');
  reset();
  let r = await fn.main(base());
  eq('返回 ok:true', r.ok, true);
  eq('返回写入 id', r.id, 'mock-id-1');
  eq('写入 1 条', WRITTEN.length, 1);
  const doc = WRITTEN[0];
  eq('type 原样落库', doc.type, 'phone');
  eq('typeLabel 由服务端反查（不信任前端）', doc.typeLabel, '电话有误');
  eq('detail 原样落库', doc.detail, '这个电话是空号，正确的应该是 0531-88888888');
  eq('target 落库', doc.target, '齐鲁快运');
  eq('targetKind 落库', doc.targetKind, 'line');
  eq('targetKey 落库', doc.targetKey, 'a1b2c3d4e5f6a1b2c3d4e5f6');
  eq('contact 落库', doc.contact, '13800000000');
  eq('status 初始为 0（待处理）', doc.status, 0);
  ok('month 形如 yyyy-MM', /^\d{4}-\d{2}$/.test(doc.month));
  ok('day 形如 yyyy-MM-dd', /^\d{4}-\d{2}-\d{2}$/.test(doc.day));
  ok('ts 是数字时间戳', typeof doc.ts === 'number' && doc.ts > 1600000000000);
  eq('_openid 由服务端注入', doc._openid, 'openid-A');
  eq('images 默认空数组', doc.images, []);

  // ================= 2. 类型白名单 =================
  console.log('\n== 2. 类型必须在服务端白名单内 ==');
  reset();
  r = await fn.main(base({ type: 'not-a-real-type' }));
  eq('非法 type 被拒', r.ok, false);
  eq('非法 type 原因', r.reason, 'bad-type');
  eq('非法 type 不写入', WRITTEN.length, 0);
  ok('非法 type 带中文提示', typeof r.error === 'string' && r.error.length > 0);

  reset();
  r = await fn.main(base({ type: '' }));
  eq('缺 type 被拒', r.reason, 'bad-type');

  // 五个合法类型逐个通过，且 label 正确
  reset();
  const EXPECT_TYPES = [
    ['phone', '电话有误'],
    ['closed', '公司已停业'],
    ['cancelled', '线路已取消'],
    ['incomplete', '信息不完整'],
    ['other', '其他']
  ];
  for (const [k, label] of EXPECT_TYPES) {
    reset();
    const rr = await fn.main(base({ type: k }));
    eq(`类型 ${k} 通过且 label=「${label}」`, [rr.ok, WRITTEN[0] && WRITTEN[0].typeLabel], [true, label]);
  }

  // 前端伪造 label 不影响落库（服务端反查）
  reset();
  await fn.main(base({ type: 'phone', typeLabel: '我是伪造的标签' }));
  eq('前端传的 typeLabel 被忽略', WRITTEN[0].typeLabel, '电话有误');

  // ================= 3. 说明必填 + 长度截断 =================
  console.log('\n== 3. 说明必填，超长截断 ==');
  reset();
  r = await fn.main(base({ detail: '' }));
  eq('空说明被拒', r.reason, 'bad-detail');
  reset();
  r = await fn.main(base({ detail: '   ' }));
  eq('纯空白说明被拒（trim 后为空）', r.reason, 'bad-detail');
  reset();
  r = await fn.main(base({ detail: null }));
  eq('null 说明被拒', r.reason, 'bad-detail');

  reset();
  const long = '错'.repeat(500);
  await fn.main(base({ detail: long }));
  eq('超长说明被截断到 200 字', WRITTEN[0].detail.length, 200);

  reset();
  await fn.main(base({ detail: '  前后有空白  ' }));
  eq('说明两侧空白被 trim', WRITTEN[0].detail, '前后有空白');

  // ================= 4. 图片：数量上限 / 去重 / 超长裁掉 =================
  console.log('\n== 4. 图片数组归一（上限 3 / 去重 / 裁超长）==');
  reset();
  await fn.main(base({ images: ['cloud://a.png', 'cloud://b.png'] }));
  eq('2 张图原样落库', WRITTEN[0].images, ['cloud://a.png', 'cloud://b.png']);

  reset();
  await fn.main(base({ images: ['c1', 'c2', 'c3', 'c4', 'c5'] }));
  eq('超出 3 张被截断', WRITTEN[0].images.length, 3);

  reset();
  await fn.main(base({ images: ['dup', 'dup', 'other'] }));
  eq('重复 fileID 被去重', WRITTEN[0].images, ['dup', 'other']);

  reset();
  await fn.main(base({ images: ['', '  ', 'ok'] }));
  eq('空串被过滤', WRITTEN[0].images, ['ok']);

  reset();
  await fn.main(base({ images: 'cloud://not-an-array.png' }));
  eq('非数组 images 归一为空数组', WRITTEN[0].images, []);

  reset();
  await fn.main(base({ images: [null, undefined, 12345] }));
  eq('非字符串项不写入（数字被转字符串）', WRITTEN[0].images, ['12345']);

  reset();
  await fn.main(base({ images: ['x'.repeat(900)] }));
  eq('超长 fileID 被裁到 300', WRITTEN[0].images[0].length, 300);

  // ================= 5. 频控 =================
  console.log('\n== 5. 频控：同用户当日达上限拒绝 ==');
  reset();
  CURRENT_DAY_COUNT = 9;
  r = await fn.main(base());
  eq('当日第 10 条仍可提交（9 < 10）', r.ok, true);

  reset();
  CURRENT_DAY_COUNT = 10;
  r = await fn.main(base());
  eq('当日已满 10 条被拒', r.ok, false);
  eq('频控原因', r.reason, 'rate-limited');
  eq('频控时不写入', WRITTEN.length, 0);
  ok('频控带中文提示', typeof r.error === 'string' && r.error.length > 0);

  reset();
  COUNT_SHOULD_THROW = true;
  r = await fn.main(base());
  eq('计数失败时保守放行（宁多记勿漏记）', r.ok, true);

  // ================= 6. openid =================
  console.log('\n== 6. openid 缺失时不得静默写入 ==');
  reset();
  CURRENT_OPENID = '';
  r = await fn.main(base());
  eq('无 openid 被拒', r.ok, false);
  eq('无 openid 原因', r.reason, 'no-openid');
  eq('无 openid 不写入', WRITTEN.length, 0);

  // ================= 7. 其它字段归一 =================
  console.log('\n== 7. 其它字段的归一与截断 ==');
  reset();
  await fn.main(base({ target: 'X'.repeat(200) }));
  eq('target 超长截断到 80', WRITTEN[0].target.length, 80);

  reset();
  await fn.main(base({ targetKey: 'K'.repeat(400) }));
  eq('targetKey 超长截断到 120', WRITTEN[0].targetKey.length, 120);

  reset();
  await fn.main(base({ contact: 'C'.repeat(200) }));
  eq('contact 超长截断到 60', WRITTEN[0].contact.length, 60);

  reset();
  await fn.main(base({ contact: undefined }));
  eq('contact 可缺省（空串）', WRITTEN[0].contact, '');

  reset();
  await fn.main(base({ targetKind: 'weird' }));
  eq('非法 targetKind 回退为 line', WRITTEN[0].targetKind, 'line');

  reset();
  await fn.main(base({ targetKind: 'company' }));
  eq('targetKind=company 保留', WRITTEN[0].targetKind, 'company');

  // ================= 8. 异常路径（不得抛穿）=================
  console.log('\n== 8. 异常路径返回结构化错误，不抛穿 ==');
  reset();
  WRITE_SHOULD_THROW = true;
  r = await fn.main(base());
  eq('写入失败返回 ok:false（不抛异常）', r.ok, false);
  eq('写入失败原因', r.reason, 'write-failed');
  ok('写入失败带中文提示', typeof r.error === 'string' && r.error.length > 0);

  reset();
  r = await fn.main(base({ action: 'delete-everything' }));
  eq('未知 action 被拒', r.reason, 'unknown-action');
  eq('未知 action 不写入', WRITTEN.length, 0);

  reset();
  r = await fn.main();
  eq('无参调用不崩溃', r.ok, false);

  reset();
  r = await fn.main({});
  eq('空对象调用不崩溃', r.ok, false);

  // ================= 汇总 =================
  console.log('\n' + (failed === 0 ? 'ALL PASSED' : 'HAS FAILURES') +
    ' — ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed === 0 ? 0 : 1);
}

run().catch(e => {
  console.error('测试运行异常：', e);
  process.exit(1);
});
