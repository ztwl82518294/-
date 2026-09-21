// 导入 JSON 格式修复工具
// 背景：导入模板里常用 "..." 表示"继续添加更多记录"，用户照着填时容易把它留在文件里。
//       JSON 规范中 ... 不是合法值，小程序端 JSON.parse 会直接失败且只报 "Unexpected token '.'"，
//       非技术用户很难定位。本工具统一清理这类占位符及常见格式问题。
//
// 用法：node fix-import-json.js <输入文件> [输出文件]
//       不传输出文件时，默认写到输入文件同目录下的 <原名>-已修复.json
//
// 处理的常见问题：
//   1. 省略号占位符 ... / …（数组元素、对象行）—— 仅在字符串外部清理，不误伤地址里的"..."
//   2. 尾随逗号（, ] 或 , } ）
//   3. UTF-8 BOM
//   4. 中文/全角引号 “ ” ‘ ’
//   5. 输出业务字段校验报告（必填项、网点/电话二选一）

const fs = require('fs');
const path = require('path');

// 在"字符串外部"删除省略号占位符：逐字符扫描跟踪引号状态，避免误删地址/备注里的 ...
function stripPlaceholders(src) {
  let out = '';
  let inStr = false;
  let removed = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      out += c;
      if (c === '\\') { out += src[i + 1] || ''; i++; }   // 跳过转义字符
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '.') {
      // 连续 3 个及以上点视为占位符，整段跳过
      let j = i; while (src[j] === '.') j++;
      if (j - i >= 3) { removed++; i = j - 1; continue; }
      out += c; continue;
    }
    if (c === '…') { removed++; continue; }               // 单个省略号字符
    out += c;
  }
  return { text: out, removed };
}

function fix(text) {
  const log = [];
  // 1. BOM
  if (text.charCodeAt(0) === 0xFEFF) { text = text.slice(1); log.push('去掉 UTF-8 BOM'); }
  // 2. 中文/全角引号
  const before = text;
  text = text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  if (text !== before) log.push('全角引号 → 半角引号');
  // 3. 省略号占位符（仅字符串外）
  const r = stripPlaceholders(text);
  text = r.text;
  if (r.removed) log.push(`删除 ${r.removed} 处省略号占位符（... / …）`);
  // 4. 尾随逗号
  const before2 = text;
  text = text.replace(/,(\s*[}\]])/g, '$1');
  if (text !== before2) log.push('去掉尾随逗号');
  return { text, log };
}

// 业务字段校验（与 adminLine 的口径保持一致）
function validate(list) {
  const warns = [];
  if (!Array.isArray(list)) return ['文件顶层不是数组（应为 [ {...}, {...} ] ）'];
  list.forEach((item, i) => {
    const no = `第 ${i + 1} 条`;
    if (!item || typeof item !== 'object') { warns.push(`${no}: 不是对象`); return; }
    if (!item.title) warns.push(`${no}: 缺 title（必填）`);
    if (!item.fromCityName) warns.push(`${no}: 缺 fromCityName（必填）`);
    if (!item.toCityName) warns.push(`${no}: 缺 toCityName（必填）`);
    const hasFrom = !!(item.fromOutlets || item.fromPhone || item.fromAddress);
    const hasTo = !!(item.toOutlets || item.toPhone || item.toAddress);
    if (!hasFrom) warns.push(`${no}: 发站信息为空（fromOutlets 或 fromPhone 至少填一个）`);
    if (!hasTo) warns.push(`${no}: 到站信息为空（toOutlets 或 toPhone 至少填一个）`);
    if (item.status === undefined) warns.push(`${no}: 未写 status，服务端默认不会补，建议显式写 1`);
  });
  return warns;
}

// ===== 主流程 =====
const inPath = process.argv[2];
if (!inPath) {
  console.error('用法: node fix-import-json.js <输入文件> [输出文件]');
  process.exit(1);
}
const outPath = process.argv[3] ||
  path.join(path.dirname(inPath), path.basename(inPath, '.json') + '-已修复.json');

const raw = fs.readFileSync(inPath, 'utf8');
const { text, log } = fix(raw);

let data;
try {
  data = JSON.parse(text);
} catch (e) {
  console.error('仍无法解析，需人工检查：' + e.message);
  const m = /position (\d+)/.exec(e.message);
  if (m) {
    const pos = Number(m[1]);
    console.error('出错上下文：' + JSON.stringify(text.slice(Math.max(0, pos - 80), pos + 20)));
  }
  process.exit(1);
}

console.log('修复内容：');
log.length ? log.forEach(l => console.log('  • ' + l)) : console.log('  • 无需修复（原本合法）');
console.log('解析成功，共 ' + (Array.isArray(data) ? data.length : 1) + ' 条记录');

const warns = validate(data);
if (warns.length) {
  console.log('\n字段提醒（不阻断导入，供人工核对）：');
  warns.forEach(w => console.log('  ! ' + w));
} else {
  console.log('\n字段校验：必填项齐全');
}

fs.writeFileSync(outPath, JSON.stringify(data, null, 2), 'utf8');
console.log('\n已导出: ' + outPath);
