// 详情页网点新排版自检：事件绑定 / 样式类引用 / 旧类残留 / 括号配平
'use strict';
const fs = require('fs');
const base = 'G:/workbuddy/logistics-line-query/pages/line-detail/';
const js = fs.readFileSync(base + 'index.js', 'utf8');
const wxml = fs.readFileSync(base + 'index.wxml', 'utf8');
const wxss = fs.readFileSync(base + 'index.wxss', 'utf8');
const R = [];

// 1. WXML 事件绑定在 JS 均有定义
const binds = [...wxml.matchAll(/(?:bindtap|catchtap)="([A-Za-z0-9_]+)"/g)].map(m => m[1]);
const uniq = [...new Set(binds)];
const missing = uniq.filter(h => !new RegExp('\\b' + h + '\\s*\\(').test(js));
R.push('WXML 事件绑定: ' + uniq.length + ' 个唯一处理器, 缺失: ' + (missing.join(',') || '无'));

// 2. WXML 用到的关键类在 WXSS 均有定义
const classes = ['pair-item', 'pair-main', 'pair-addr', 'pair-addr-text', 'pair-km', 'pair-icon',
  'pair-phones', 'phone-chip', 'pair-call', 'pair-empty', 'station-block', 'station-head', 'station-act'];
const missCss = classes.filter(c => wxml.includes(c) && !new RegExp('\\.' + c + '\\s*\\{').test(wxss));
R.push('WXML 用到但 WXSS 缺失的类: ' + (missCss.join(',') || '无'));

// 3. 旧类残留
const dead = ['pair-no', 'pair-row', 'pair-body', 'contact-value', 'phone-text'].filter(c => wxml.includes(c));
R.push('WXML 残留旧类: ' + (dead.join(',') || '无'));
R.push('WXSS 残留旧样式: pair-no=' + wxss.includes('.pair-no') + ', pair-row=' + wxss.includes('.pair-row')
  + ', pair-body=' + wxss.includes('.pair-body') + ', contact-value=' + wxss.includes('.contact-value')
  + ', phone-text=' + wxss.includes('.phone-text'));

// 4. WXSS 花括号配平
let bal = 0;
for (const ch of wxss) { if (ch === '{') bal++; if (ch === '}') bal--; }
R.push('WXSS 花括号配平: ' + (bal === 0 ? '通过' : '失衡 ' + bal));

// 5. 新增 JS 方法存在
R.push('onCallGroup 定义: ' + /\bonCallGroup\s*\(/.test(js));
R.push('onCallOne/onCopyText/onCopyAllAddr 保留: ' + [/\bonCallOne\s*\(/.test(js), /\bonCopyText\s*\(/.test(js), /\bonCopyAllAddr\s*\(/.test(js)].join('/'));

fs.writeFileSync('G:/workbuddy/logistics-line-query/.workbuddy/scripts/_layoutcheck.txt', R.join('\n'));
console.log(R.join('\n'));
