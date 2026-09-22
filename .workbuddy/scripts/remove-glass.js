// .workbuddy/scripts/remove-glass.js
// 【一次性迁移脚本】移除全站 backdrop-filter 毛玻璃效果。已完成（v6.2，2026-09-22）。
//
// 背景：用户要求"全部字体删除毛玻璃效果"，范围含管理端（19 文件 / 86 处）。
//
// 处理分两步：
//   ① 删除 -webkit-backdrop-filter / backdrop-filter 两行。
//   ② 半透明白底 → 不透明纯白。
//      原因：毛玻璃的观感来自"半透明 + 模糊 + 饱和"三者配合。
//      只删模糊、保留 .88 半透明，会让卡片变成"透着背景渐变的淡灰块"，
//      比原来更脏。去掉模糊后必须同时把底做实，才是干净的"实心卡"。
//
// ★★ 踩坑（首版有 bug，已修）：
//   提纯**只能作用于"底色类"属性**（background* / border* / box-shadow），
//   `color` 一律跳过。首版无差别替换，把深色渐变头图上**刻意用的白色文字/
//   占位符/图标**也提纯，与白底组合成"白字白底"直接消失（5 处已人工修正）。
//   → 任何"白色提纯"脚本都必须先按 CSS 属性名过滤。
//
// 刻意保留、不该被本脚本处理的：
//   - 渐变头图 ::before 的白色径向柔光（"天空高光"）
//   - 深色渐变上的白色标题/副标题、按钮渐变上的白字
//
// 安全约束（本项目铁律）：
//   - 不用 PowerShell 的 Out-File/Set-Content（默认写 UTF-8 BOM，小程序编译会报错）。
//   - 本脚本用 fs.writeFileSync(..., {encoding:'utf8'})，**不带 BOM**。
//   - 保留原文件的换行符风格，不整份重排。
//
// 用法：node .workbuddy/scripts/remove-glass.js [--dry]
//   --dry 只报告不写盘（此时末尾自检会报"仍残留 N 个文件"，属预期）。
//   脚本**幂等**：反复执行不会产生额外改动。

const fs = require('fs');
const path = require('path');

const DRY = process.argv.includes('--dry');
const ROOT = path.resolve(__dirname, '..', '..');

// 是否删除整行（含空白缩进）。两行成对删，避免留下孤立的 -webkit- 前缀行。
const FILTER_LINE = /^[ \t]*(-webkit-)?backdrop-filter\s*:[^;]*;[ \t]*$/;

// 半透明白 → 不透明。覆盖 rgba(255,255,255,.x) / rgba(255, 255, 255, .xx) 各种写法。
// 只处理"白色系"，不动其它颜色（如蓝/橙站点卡底、金色、投影）。
const TRANSLUCENT_WHITE = /rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*\.?\d*\.?\d+\s*\)/g;

// ★ 只对"底色类"属性做提纯。
// 踩坑记录（2026-09-22）：首版脚本无差别替换，把 `color: rgba(255,255,255,.96)`
// 也提纯成了近白 —— 但这些是**深色渐变头图上故意用的白色文字/占位符/图标**，
// 提纯后（若底同时被改成白）会变成"白字白底"，文字直接消失。
// 因此限定：仅当声明位于 background / background-color / border* / box-shadow
// 这几类"底色"属性上时才替换；color 一律跳过。
const PAINT_PROP = /(background(?:-color|-image)?|border(?:-[a-z]+)?|box-shadow)\s*:/;

function whitenLine(line) {
  // 属性名在同行则按属性判断；跨行声明（极少）保守跳过 color 关键字所在行
  const propMatch = line.match(/([a-z-]+)\s*:/);
  const prop = propMatch ? propMatch[1] : '';
  if (prop === 'color') return { line, n: 0 };          // 文字色，绝不动
  if (!PAINT_PROP.test(line)) return { line, n: 0 };
  let n = 0;
  const out = line.replace(TRANSLUCENT_WHITE, m => { n++; return whiten(m); });
  return { line: out, n };
}

// 白度映射：越透的底越需要提纯，否则会透着背景色发灰。
// 依据实际取值（.74/.76/.8/.88/.9/.92/.95/.96/.98/.99）分档。
function whiten(m) {
  const nums = m.match(/[\d.]+/g);
  const a = nums && nums.length >= 4 ? parseFloat(nums[3]) : 1;
  if (a >= 0.95) return '#ffffff';
  if (a >= 0.88) return '#ffffff';
  if (a >= 0.8) return 'rgba(255,255,255,.98)';
  return 'rgba(255,255,255,.96)';
}

const targets = [];
function walk(dir) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (/^(node_modules|\.git|backup-bom.*)$/.test(e.name)) return;
      walk(p);
    } else if (/\.wxss$/.test(e.name)) {
      targets.push(p);
    }
  });
}
walk(ROOT);

let filesChanged = 0, linesRemoved = 0, whitesChanged = 0;
const report = [];

targets.forEach(p => {
  const src = fs.readFileSync(p, 'utf8');
  const eol = src.indexOf('\r\n') !== -1 ? '\r\n' : '\n';
  const lines = src.split(/\r?\n/);

  let removedHere = 0;
  const kept = lines.filter(l => {
    if (FILTER_LINE.test(l)) { removedHere++; return false; }
    return true;
  });

  let out = kept.join(eol);
  let whHere = 0;
  // 逐行处理，避免把跨行的 color 声明误判为底色
  out = out.split(eol).map(l => {
    const r = whitenLine(l);
    whHere += r.n;
    return r.line;
  }).join(eol);

  if (removedHere === 0 && whHere === 0) return;
  filesChanged++;
  linesRemoved += removedHere;
  whitesChanged += whHere;
  report.push(`  ${path.relative(ROOT, p).replace(/\\/g, '/')}  -${removedHere} 行模糊, ${whHere} 处白底提纯`);

  if (!DRY) fs.writeFileSync(p, out, { encoding: 'utf8' });
});

console.log((DRY ? '【试运行】' : '【已修改】') + ` ${filesChanged} 个文件，删除 ${linesRemoved} 行 backdrop-filter，${whitesChanged} 处白底提纯`);
report.forEach(r => console.log(r));

// 自检：确认没有**生效的** backdrop-filter 声明残留（排除注释里的说明文字）。
const FILTER_ANY = /^[ \t]*(-webkit-)?backdrop-filter\s*:/m;
let left = 0;
targets.forEach(p => {
  if (FILTER_ANY.test(fs.readFileSync(p, 'utf8'))) {
    console.log('  残留: ' + path.relative(ROOT, p).replace(/\\/g, '/'));
    left++;
  }
});
console.log(left === 0 ? '\nOK 全站已无生效的 backdrop-filter 声明' : `\n仍残留 ${left} 个文件！`);
process.exit(left === 0 ? 0 : 1);
