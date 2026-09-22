// 线路定位键解析单测：node .workbuddy/scripts/test-line-key.js
// 覆盖：数字 id / _id 双键兼容、非法参数拦截、跳转引用取值
const assert = require('assert');
const path = require('path');
const lineKey = require(path.resolve(__dirname, '../../utils/lineKey.js'));
const { parseLineKey, lineWhere, lineRef } = lineKey;

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓', name); }
  catch (e) { fail++; console.log('  ✗', name, '→', e.message); }
}

console.log('\n[1] 数字 id（旧分享链接 / 老列表跳转）');
t('"1700000000000" → 按 id 查', () => {
  const k = parseLineKey('1700000000000');
  assert.strictEqual(k.byId, true);
  assert.strictEqual(k.value, 1700000000000);
  assert.deepStrictEqual(lineWhere(k), { id: 1700000000000 });
});
t('数字字符串 "0" → 非法（返回 null）', () => assert.strictEqual(parseLineKey('0'), null));

console.log('\n[2] _id（主键，新链路首选）');
t('24 位 _id → 按 _id 查', () => {
  const k = parseLineKey('a1b2c3d4e5f60718293a4b5c');
  assert.strictEqual(k.byId, false);
  assert.deepStrictEqual(lineWhere(k), { _id: 'a1b2c3d4e5f60718293a4b5c' });
});
t('自定义 _id（≥8 位）→ 按 _id 查', () => assert.strictEqual(parseLineKey('line_001').byId, false));

console.log('\n[3] 非法参数（不得发起无效查询）');
t('undefined → null', () => assert.strictEqual(parseLineKey(undefined), null));
t('空串 → null', () => assert.strictEqual(parseLineKey(''), null));
t('太短的非数字（"abc"）→ null', () => assert.strictEqual(parseLineKey('abc'), null));
t('"NaN" → null', () => assert.strictEqual(parseLineKey('NaN'), null));
t('负数 "-1" → null', () => assert.strictEqual(parseLineKey('-1'), null));

console.log('\n[4] 跳转/分享引用取值');
t('优先 _id', () => assert.strictEqual(lineRef({ _id: 'zzz11111', id: 123 }), 'zzz11111'));
t('缺 _id 时回退 id', () => assert.strictEqual(lineRef({ id: 123 }), 123));
t('空对象 → 空串', () => assert.strictEqual(lineRef({}), ''));
t('null → 空串', () => assert.strictEqual(lineRef(null), ''));

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
if (fail) process.exit(1);
