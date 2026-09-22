/**
 * 审计 E:\微信小程序公司信息\ 下所有公司 JSON 的电话与价格字段
 *
 * 目的：数据来源为"网上搜集"(见审计项 #5)，需评估
 *   1) 有多少电话是个人手机号（11 位 1[3-9]...）——被本人投诉风险最高
 *   2) 有多少是固话 / 客服热线——风险低
 *   3) priceDesc 填写率——展示不确定价格风险高
 *   4) 同一号码被多少条线路共用——共用度高说明是公司在用而非个人
 *
 * 只读，不修改任何数据。
 */
const fs = require('fs');
const path = require('path');

const DIR = 'E:\\微信小程序公司信息';

const MOBILE = /^1[3-9]\d{9}$/;
const TEL = /^0\d{2,3}-?\d{7,8}$/;
const HOTLINE = /^(400|95|10|11|12|16|17|18|19)\d{4,}$/; // 400/95xxx 等企业热线
const PHONE_ANY = /1[3-9]\d{9}/g;
const TEL_ANY = /0\d{2,3}-?\d{7,8}/g;

function classify(p) {
  const s = String(p || '').trim();
  if (!s) return 'empty';
  if (MOBILE.test(s)) return 'mobile';
  if (TEL.test(s)) return 'tel';
  if (/^(400|95)\d+/.test(s)) return 'hotline';
  if (/^\d{5,8}$/.test(s)) return 'short'; // 可能是不完整的号
  return 'other';
}

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json'));
const stats = {
  files: files.length,
  lines: 0,
  badFiles: [],
};
const phoneCount = new Map(); // phone -> { lines: n, companies: Set }
const byClass = { mobile: [], tel: [], hotline: [], short: [], other: [], empty: [] };
let priceFilled = 0;
let priceEmpty = 0;
const companyPhoneClass = new Map(); // companyName -> Set(class)

for (const f of files) {
  const full = path.join(DIR, f);
  let arr;
  try {
    arr = JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (e) {
    stats.badFiles.push(f + ' :: ' + e.message);
    continue;
  }
  if (!Array.isArray(arr)) { stats.badFiles.push(f + ' :: 非数组'); continue; }

  for (const line of arr) {
    stats.lines++;
    const comp = line.companyName || line.title || '(无公司名)';

    // 价格
    if (String(line.priceDesc || '').trim()) priceFilled++; else priceEmpty++;

    // 电话：先看作整体字段
    const raw = String(line.phone || '');
    // 一条记录可能含多个号，全部拆出来
    const tokens = raw.split(/[,，、;；\s/]+/).map((t) => t.trim()).filter(Boolean);
    if (tokens.length === 0) {
      byClass.empty.push({ file: f, comp, to: line.toCityName, raw: '' });
      continue;
    }
    for (const t of tokens) {
      const c = classify(t);
      byClass[c].push({ file: f, comp, to: line.toCityName, raw: t });
      if (!phoneCount.has(t)) phoneCount.set(t, { lines: 0, companies: new Set() });
      const rec = phoneCount.get(t);
      rec.lines++;
      rec.companies.add(comp);
      if (!companyPhoneClass.has(comp)) companyPhoneClass.set(comp, new Set());
      companyPhoneClass.get(comp).add(c);
    }
  }
}

// 汇总
const out = [];
out.push('=== 总量 ===');
out.push('文件数: ' + stats.files + '，线路总数: ' + stats.lines);
if (stats.badFiles.length) out.push('解析失败文件: ' + stats.badFiles.join(' | '));

out.push('');
out.push('=== 价格字段 ===');
out.push('有值: ' + priceFilled + '，空: ' + priceEmpty + '  填写率: ' +
  (stats.lines ? ((priceFilled / stats.lines) * 100).toFixed(1) : 0) + '%');

out.push('');
out.push('=== 电话分类（按号码条目计） ===');
for (const k of ['mobile', 'tel', 'hotline', 'short', 'other', 'empty']) {
  out.push(k + ': ' + byClass[k].length);
}

out.push('');
out.push('=== 手机号明细（前 80 条，按公司分组） ===');
const mobByCompany = new Map();
for (const it of byClass.mobile) {
  if (!mobByCompany.has(it.comp)) mobByCompany.set(it.comp, []);
  mobByCompany.get(it.comp).push(it);
}
let n = 0;
for (const [comp, items] of mobByCompany) {
  const phones = [...new Set(items.map((i) => i.raw))];
  out.push('• ' + comp + '  [' + items.length + '条线路]  号码: ' + phones.join(', '));
  if (++n >= 80) { out.push('  ...(截断)'); break; }
}

out.push('');
out.push('=== 高频号码 TOP 30（被多条线路共用 → 更可能是公司号） ===');
const sorted = [...phoneCount.entries()].sort((a, b) => b[1].lines - a[1].lines);
for (const [p, rec] of sorted.slice(0, 30)) {
  out.push('  ' + p + '  →  ' + rec.lines + ' 条线路 / ' + rec.companies.size + ' 家公司  [' + classify(p) + ']');
}

out.push('');
out.push('=== 只出现 1 次的号码数量（疑似个人/临时号） ===');
out.push('  ' + sorted.filter(([, r]) => r.lines === 1).length + ' 个');

out.push('');
out.push('=== 公司级风险标记（含手机号的公司） ===');
out.push('  共 ' + mobByCompany.size + ' 家公司至少有一个手机号');
out.push('  公司总数: ' + companyPhoneClass.size);

const dest = 'G:\\workbuddy\\logistics-line-query\\.workbuddy\\reports\\phone-price-audit.txt';
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, out.join('\n'), 'utf8');
console.log('OK -> ' + dest);
console.log(out.slice(0, 30).join('\n'));
