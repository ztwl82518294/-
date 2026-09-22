/**
 * 校验所有 JS 里的相对 require 路径是否真实存在。
 * 小程序里路径写错（如 admin 子页面少写一级 ../）编译期不报错，
 * 运行时才抛 "module not found"，页面直接白屏，很难排查。
 * 用法：node check-requires.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SKIP = new Set(['node_modules', '.git', '.workbuddy', 'miniprogram_npm', 'deprecated']);

/**
 * 去掉注释，同时**保持偏移量与行号不变**（用等长空白替换）。
 *
 * ★ 为什么必须去注释：
 *   注释里常写用法示例，如 `在套件里：require('../framework')`。
 *   不去注释就会把示例当真实依赖去校验 —— 相对路径是相对**注释所在文件**解析的，
 *   往往不存在，于是报出一堆假警报，真问题反而被淹没。
 *   （保持行号是因为报错信息要给出准确行号，供人直接跳过去看。）
 *
 * ★ 字符串必须**保留**：`require('./x')` 的路径本身就是字符串，
 *   把字符串一起抹掉会让扫描结果变成 0 处（等于形同虚设）。
 *   为了不把字符串里出现的 `//` 误判成注释，遇到字符串要整段跳过。
 */
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  const blank = (s) => s.replace(/[^\n]/g, ' '); // 换行保留 → 行号不变

  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];

    // 行注释 → 抹掉
    if (c === '/' && c2 === '/') {
      let j = i;
      while (j < n && src[j] !== '\n') j++;
      out += blank(src.slice(i, j));
      i = j;
      continue;
    }
    // 块注释 → 抹掉
    if (c === '/' && c2 === '*') {
      let j = i + 2;
      while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++;
      j = Math.min(j + 2, n);
      out += blank(src.slice(i, j));
      i = j;
      continue;
    }
    // 字符串字面量 → **原样保留**（require 的路径在这里面）
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === quote) { j++; break; }
        if (quote !== '`' && src[j] === '\n') break; // 单双引号不跨行
        j++;
      }
      out += src.slice(i, j);
      i = j;
      continue;
    }

    out += c;
    i++;
  }
  return out;
}

const bad = [];
let total = 0;

(function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const fp = path.join(dir, name);
    const st = fs.statSync(fp);
    if (st.isDirectory()) {
      if (SKIP.has(name)) continue;
      walk(fp);
    } else if (name.endsWith('.js')) {
      const raw = fs.readFileSync(fp, 'utf8');
      const text = stripComments(raw);
      // 只校验相对路径（./ 或 ../ 开头）；npm 包名跳过
      const re = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
      let m;
      while ((m = re.exec(text))) {
        total += 1;
        const spec = m[1];
        const base = path.dirname(fp);
        let target = path.resolve(base, spec);
        // 省略 .js 后缀的情况
        if (!path.extname(target)) target += '.js';
        if (!fs.existsSync(target)) {
          const line = text.slice(0, m.index).split('\n').length;
          bad.push(`${path.relative(ROOT, fp)}:${line}  ->  ${spec}`);
        }
      }
    }
  }
})(ROOT);

if (bad.length) {
  console.log('❌ 以下 require 路径不存在：');
  bad.forEach(x => console.log('   ' + x));
} else {
  console.log(`✅ 全部 ${total} 处相对 require 路径均有效`);
}
process.exit(bad.length ? 1 : 0);
