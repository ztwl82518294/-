/**
 * 把全项目 WXSS 里写死的色值收敛为 app.wxss 中定义的设计令牌。
 * 用法：node apply-design-tokens.js [--check]
 *   --check  只统计不动文件（预览用）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

// 顺序无关：所有 key 都是 7 字符 hex，不会互相前缀冲突
const MAP = {
  '#1f2937': 'var(--ink-title)',   // 标题深（gray-800）
  '#1e293b': 'var(--ink-title)',   // 标题深（slate-800）
  '#1f2d3d': 'var(--ink-title)',   // 标题深（自定义）
  '#0f172a': 'var(--ink-title)',   // 标题深（slate-900，目标值）
  '#333333': 'var(--ink-body)',    // 正文
  '#6b7280': 'var(--ink-muted)',   // 次要（gray-500）
  '#9ca3af': 'var(--ink-muted)',   // 次要（gray-400）
  '#94a3b8': 'var(--ink-muted)',   // 次要（slate-400）
  '#98a2b3': 'var(--ink-muted)',   // 次要
  '#b0b8c4': 'var(--ink-muted)',   // 次要
  '#c7cdd8': 'var(--ink-disabled)',// 禁用态（语义独立，保留）
  '#3b82f6': 'var(--brand-light)', // 蓝（blue-500）
  '#4f8bff': 'var(--brand-light)', // 渐变亮端（目标值）
  '#1d4ed8': 'var(--brand-deep)',  // 浅蓝底上的蓝字
  '#2563eb': 'var(--brand)',       // 主色（目标值）
  '#dbeafe': 'var(--brand-wash)',  // 浅蓝底
  '#eef4ff': 'var(--brand-wash)',  // 浅蓝底（目标值）
  '#f5f7fb': 'var(--bg-page)',     // 页面背景（目标值）
  '#f6f7f9': 'var(--bg-page)',     // 页面背景
};

const RE = new RegExp(Object.keys(MAP).join('|'), 'gi');

const SKIP_DIRS = new Set(['node_modules', '.git', '.workbuddy', 'miniprogram_npm', 'cloudfunctions']);
const checkOnly = process.argv.includes('--check');

let fileCount = 0;
let hitCount = 0;
const perFile = [];

(function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const fp = path.join(dir, name);
    const st = fs.statSync(fp);
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      walk(fp);
    } else if (name.endsWith('.wxss')) {
      const src = fs.readFileSync(fp, 'utf8');
      let n = 0;
      // 逐行处理：跳过令牌定义行（`--brand: #2563eb;`），否则会自引用成 `--brand: var(--brand)`
      const out = src.split('\n').map((line) => {
        if (/^\s*--[\w-]+\s*:/.test(line)) return line;
        return line.replace(RE, (m) => {
          n += 1;
          return MAP[m.toLowerCase()];
        });
      }).join('\n');
      if (n > 0) {
        fileCount += 1;
        hitCount += n;
        perFile.push(`${path.relative(ROOT, fp).replace(/\\/g, '/')}  ${n}`);
        if (!checkOnly) fs.writeFileSync(fp, out, 'utf8');
      }
    }
  }
})(ROOT);

console.log(perFile.join('\n'));
console.log(`\n${checkOnly ? '[预览]' : '[已写入]'} 文件 ${fileCount} 个，替换 ${hitCount} 处`);
