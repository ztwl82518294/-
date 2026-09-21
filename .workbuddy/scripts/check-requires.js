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
      const text = fs.readFileSync(fp, 'utf8');
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
