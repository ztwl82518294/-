/**
 * 扫描 showToast 里会被截断的长文案。
 * wx.showToast 中文约 14 字封顶（两行），超出显示成 "..."，用户看不全。
 * 用法：node scan-toast-length.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SKIP = new Set(['node_modules', '.git', '.workbuddy', 'miniprogram_npm', 'deprecated']);
const WARN = 7; // 中文字符数阈值（一行约 7 字）

// 按视觉宽度计权：中文/全角算 1，其余算 0.5
function visualLen(s) {
  let n = 0;
  for (const c of s) n += /[\u4e00-\u9fa5\uff00-\uffef]/.test(c) ? 1 : 0.5;
  return Math.round(n * 10) / 10;
}

const found = [];
(function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const fp = path.join(dir, name);
    const st = fs.statSync(fp);
    if (st.isDirectory()) {
      if (SKIP.has(name)) continue;
      walk(fp);
    } else if (name.endsWith('.js')) {
      const text = fs.readFileSync(fp, 'utf8');
      // 匹配 showToast({...title: 'xxx'...})，忽略模板串（含变量的不好静态判断）
      const re = /showToast\(\s*\{([\s\S]*?)\}\s*\)/g;
      let m;
      while ((m = re.exec(text))) {
        const body = m[1];
        const tm = body.match(/title:\s*(['"])([^'"]*)\1/);
        if (!tm) continue;
        const title = tm[2];
        const len = visualLen(title);
        if (len > WARN) {
          const line = text.slice(0, m.index).split('\n').length;
          found.push({ file: path.relative(ROOT, fp), line, title, len });
        }
      }
    }
  }
})(ROOT);

found.sort((a, b) => b.len - a.len);
found.forEach(x => {
  console.log(`${String(x.len).padStart(4)} 字 | ${x.file}:${x.line}`);
  console.log(`         "${x.title}"`);
});
console.log(`\n共 ${found.length} 处 toast 文案偏长（> ${WARN} 字），建议改用 utils/ui.js 的 error() 自动降级为 modal`);
