// utils/outlets.js 单元测试：用「山东诚惠快运」真实数据样例验证解析与反填
// 运行：node .workbuddy/scripts/test-outlets-parse.js
'use strict';
const assert = require('assert');
const { parseOutlets, parseRow, deriveLegacy } = require('../../utils/outlets.js');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  PASS ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ' :: ' + e.message); }
}

console.log('== parseRow ==');
t('地址 | 多电话（逗号）', () => {
  const r = parseRow('济南市天桥区北外环与西外环交汇处（建邦大桥） | 0531-85772888,19353118687,0531-8826566,0531-85773566');
  assert.deepStrictEqual(r, { addr: '济南市天桥区北外环与西外环交汇处（建邦大桥）', phone: '0531-85772888,19353118687,0531-8826566,0531-85773566' });
});
t('地址 | 单电话', () => {
  assert.deepStrictEqual(parseRow('盐山三红绿灯南50米路西 | 15530341222'), { addr: '盐山三红绿灯南50米路西', phone: '15530341222' });
});
t('全角｜分隔', () => {
  assert.deepStrictEqual(parseRow('唐山｜0315-1331531202'), { addr: '唐山', phone: '0315-1331531202' });
});
t('单列-纯地址', () => {
  assert.deepStrictEqual(parseRow('衡水'), { addr: '衡水', phone: '' });
});
t('单列-纯电话（≥7 位数字判定）', () => {
  assert.deepStrictEqual(parseRow('15530341222'), { addr: '', phone: '15530341222' });
});
t('空值', () => {
  assert.deepStrictEqual(parseRow(''), { addr: '', phone: '' });
  assert.deepStrictEqual(parseRow(null), { addr: '', phone: '' });
});

console.log('== parseOutlets ==');
t('字符串（真实数据形态）→ 1 组网点', () => {
  const r = parseOutlets('临沂 | 1531889143,155890996');
  assert.deepStrictEqual(r, [{ addr: '临沂', phone: '1531889143,155890996' }]);
});
t('对象数组原样兼容（address/tel 别名）', () => {
  const r = parseOutlets([{ address: '石家庄', tel: '0311-8980687' }]);
  assert.deepStrictEqual(r, [{ addr: '石家庄', phone: '0311-8980687' }]);
});
t('字符串数组（每行一条）', () => {
  const r = parseOutlets(['安平 | 0317-855770', '0317-8557780']);
  assert.deepStrictEqual(r, [{ addr: '安平', phone: '0317-855770' }, { addr: '', phone: '0317-8557780' }]);
});
t('空/undefined → []', () => {
  assert.deepStrictEqual(parseOutlets(''), []);
  assert.deepStrictEqual(parseOutlets(undefined), []);
  assert.deepStrictEqual(parseOutlets(0), []);
});

console.log('== deriveLegacy（详情页/编辑页反填） ==');
t('直灌数据：字符串网点 + 空老字段 → 归一并反填', () => {
  const rec = { fromOutlets: '济南市天桥区北外环与西外环交汇处（建邦大桥） | 0531-85772888,19353118687', toOutlets: '临沂 | 1531889143,155890996', fromAddress: '', fromPhone: '', toAddress: '', toPhone: '' };
  deriveLegacy(rec, 'from');
  deriveLegacy(rec, 'to');
  assert.strictEqual(rec.fromOutlets.length, 1);
  assert.strictEqual(rec.fromAddress, '济南市天桥区北外环与西外环交汇处（建邦大桥）');
  assert.strictEqual(rec.fromPhone, '0531-85772888,19353118687');
  assert.strictEqual(rec.toAddress, '临沂');
  assert.strictEqual(rec.toPhone, '1531889143,155890996');
});
t('新数据：数组网点 + 老字段齐全 → 不覆盖', () => {
  const rec = { fromOutlets: [{ addr: 'A', phone: '12345678' }], fromAddress: 'A', fromPhone: '12345678' };
  deriveLegacy(rec, 'from');
  assert.strictEqual(rec.fromAddress, 'A');
  assert.strictEqual(rec.fromPhone, '12345678');
});
t('网点为空 + 老字段有值 → 不动老字段', () => {
  const rec = { fromOutlets: '', fromAddress: '老地址', fromPhone: '12345678' };
  deriveLegacy(rec, 'from');
  assert.strictEqual(rec.fromAddress, '老地址');
  assert.strictEqual(rec.fromPhone, '12345678');
});
t('phone 兼容字段可由反填结果派生（模拟详情页读法）', () => {
  const rec = { fromOutlets: '济南 | 0531-85772888', toOutlets: '', phone: '' };
  deriveLegacy(rec, 'from');
  deriveLegacy(rec, 'to');
  assert.strictEqual(rec.fromPhone || rec.phone, '0531-85772888');
});

console.log(`\n结果：${pass} 过 / ${fail} 挂`);
process.exit(fail ? 1 : 0);
