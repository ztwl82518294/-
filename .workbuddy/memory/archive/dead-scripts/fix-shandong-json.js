// 修复「山东诚惠快运有限公司-已修复.json」导入文件的网点/老字段形态：
//   1. fromOutlets/toOutlets：字符串 "地址 | 电话1,电话2" → [{addr, phone}] 数组
//   2. fromAddress/fromPhone/toAddress/toPhone 为空 → 从网点反填；phone 兼容字段一并补
//   3. tags/toAreas：逗号字符串 → 字符串数组（与 adminLine 写入端同口径）
//   4. 补 fromCity/toCity 城市索引字段、fromCityId/toCityId、唯一 id（控制台直灌必需）
// 输出：山东诚惠快运有限公司-已修复-v2.json（原文件不动）
// 附带：可疑电话位数报告（手机非 11 位 / 座机非 10~12 位，只提示不改写）
'use strict';
const fs = require('fs');
const path = require('path');
const { parseOutlets } = require('../../utils/outlets.js');

const SRC = 'E:/微信小程序公司信息/山东诚惠快运有限公司-已修复.json';
const DST = 'E:/微信小程序公司信息/山东诚惠快运有限公司-已修复-v2.json';

// 与 adminLine normCity 同口径（searchLine 查询侧同样归一，必须一致才能命中）
function normCity(s) {
  if (!s) return '';
  return String(s).trim().replace(/(市|区|县|省|自治州|盟|地区)$/, '');
}
// 与 adminLine toArr 同口径
function toArr(v) {
  if (v === undefined || v === null || v === '') return [];
  if (Array.isArray(v)) return v.map(x => String(x).trim()).filter(Boolean);
  return String(v).split(/[,，、;；/|\s]+/).map(x => x.trim()).filter(Boolean);
}

// 可疑号码判定：手机 11 位（1 开头）；座机含区号共 11~12 位（0 开头，
// 3 位区号+8 位或 4 位区号+7~8 位本地号），10 位及以下视为缺位
function suspectReason(phone) {
  const digits = String(phone).replace(/\D/g, '');
  if (/^1\d{10}$/.test(digits)) return '';
  if (/^0\d{10,11}$/.test(digits)) return '';
  return `${phone}（数字位 ${digits.length} 位）`;
}

const list = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const base = Date.now() + 100000;
const problems = [];
const suspects = [];

const out = list.map((r, i) => {
  const rec = Object.assign({}, r);
  const fromOuts = parseOutlets(rec.fromOutlets);
  const toOuts = parseOutlets(rec.toOutlets);
  rec.fromOutlets = fromOuts;
  rec.toOutlets = toOuts;
  if (fromOuts.length) {
    rec.fromAddress = fromOuts.map(o => o.addr).filter(Boolean).join('\n');
    rec.fromPhone = fromOuts.map(o => o.phone).filter(Boolean).join(',');
  }
  if (toOuts.length) {
    rec.toAddress = toOuts.map(o => o.addr).filter(Boolean).join('\n');
    rec.toPhone = toOuts.map(o => o.phone).filter(Boolean).join(',');
  }
  rec.phone = rec.fromPhone || rec.toPhone || '';
  rec.fromCityId = 0;
  rec.toCityId = 0;
  rec.fromCity = normCity(rec.fromCityName);
  rec.toCity = normCity(rec.toCityName);
  rec.tags = toArr(rec.tags);
  rec.toAreas = toArr(rec.toAreas);
  rec.id = base + i; // 控制台直灌必需；走管理端批量导入时会被服务端重新生成，无冲突
  delete rec._id;

  // 校验 + 可疑号码收集
  ['fromAddress', 'fromPhone', 'toAddress', 'toPhone'].forEach(k => {
    if (!rec[k]) problems.push(`第 ${i + 1} 条「${rec.title}」缺 ${k}`);
  });
  String(rec.fromPhone + ',' + rec.toPhone).split(/[,]+/).forEach(p => {
    p = p.trim();
    if (!p) return;
    const why = suspectReason(p);
    if (why && suspects.indexOf(why) < 0) suspects.push(why);
  });
  return rec;
});

fs.writeFileSync(DST, JSON.stringify(out, null, 2), 'utf8');

console.log(`共 ${out.length} 条，已写出：${DST}`);
console.log(problems.length ? `缺字段：\n  ${problems.join('\n  ')}` : '全部记录四要素（发/到地址+电话）齐全');
console.log(suspects.length ? `可疑号码 ${suspects.length} 个（未改写，请与公司核实）：\n  ${suspects.join('\n  ')}` : '号码位数全部正常');

// 抽样打印第一条，肉眼核对
console.log('\n样例（第 1 条）：');
console.log(JSON.stringify(out[0], null, 2));
