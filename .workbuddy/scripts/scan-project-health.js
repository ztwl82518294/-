// 小程序静态体检：wxml 事件绑定 / dataset 字段 / 路由跳转 一致性
// 运行：node .workbuddy/scripts/scan-project-health.js
//
// 检查项：
//  1. wxml 里 bind*/catch* 绑定的方法在对应 js 中不存在（改名漏改，点击无反应）
//  2. js 里读取的 dataset.xxx 在 wxml 中没有对应 data-xxx（取出 undefined）
//  3. navigateTo/redirectTo 指向未在 app.json 注册的页面
//  4. navigateTo 指向 tabBar 页面（navigateTo 会失败，必须 switchTab）
//  5. wx:for 缺少 wx:key（渲染告警/复用错乱）
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));

const routeSet = new Set(appJson.pages || []);
(appJson.subPackages || []).forEach(sp => {
  (sp.pages || []).forEach(p => routeSet.add(`${sp.root}/${p}`));
});
const tabBarRoutes = new Set(((appJson.tabBar || {}).list || []).map(i => i.pagePath));

function walk(dir, ext, out) {
  out = out || [];
  fs.readdirSync(dir, { withFileTypes: true }).forEach(d => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) walk(p, ext, out);
    else if (p.endsWith(ext)) out.push(p);
  });
  return out;
}

const wxmlFiles = walk(path.join(ROOT, 'pages'), '.wxml');
const problems = [];
let bindCount = 0, dsCount = 0, urlCount = 0, forCount = 0;
const push = (level, file, msg) => problems.push({ level, file: path.relative(ROOT, file), msg });

wxmlFiles.forEach(wxml => {
  const js = wxml.replace(/\.wxml$/, '.js');
  if (!fs.existsSync(js)) { push('P1', wxml, '缺少同名 js 文件'); return; }
  const wxmlSrc = fs.readFileSync(wxml, 'utf8');
  const jsSrc = fs.readFileSync(js, 'utf8');

  // ---- js 顶层方法名（Page({ a(){}, b: function(){}, c: () => {} })） ----
  const jsMethods = new Set();
  const pageBody = jsSrc.slice(jsSrc.indexOf('Page('));
  const methodRe = /^\s{2}([A-Za-z_$][\w$]*)\s*(?:\(|:\s*(?:function|async|\(|\w+\s*=>))/gm;
  let m;
  while ((m = methodRe.exec(pageBody))) jsMethods.add(m[1]);
  // require 进来的模块名不算方法，但同名不影响判断（wxml 不会绑它们）

  // ---- 1. 事件绑定 ----
  const bindRe = /\b(?:bind|catch|capture-bind|capture-catch)[:-]?([A-Za-z]+)\s*=\s*"([^"]+)"/g;
  const seenFn = new Set();
  while ((m = bindRe.exec(wxmlSrc))) {
    bindCount++;
    const fn = m[2].trim();
    if (!/^[A-Za-z_$][\w$]*$/.test(fn)) continue;      // 动态绑定，跳过
    if (seenFn.has(fn)) continue;
    seenFn.add(fn);
    if (!jsMethods.has(fn)) push('P0', wxml, `绑定的事件处理函数 ${fn}() 在 js 中不存在`);
  }

  // ---- 2. dataset 字段 ----
  const dataAttrs = new Set();
  const dataRe = /\bdata-([a-z0-9-]+)\s*=\s*"/g;
  while ((m = dataRe.exec(wxmlSrc))) {
    dsCount++;
    dataAttrs.add(m[1].replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase()));
  }
  const dsRead = new Set();
  const dsRe = /dataset\s*\.\s*([A-Za-z_$][\w$]*)/g;
  while ((m = dsRe.exec(jsSrc))) dsRead.add(m[1]);
  const dsRe2 = /dataset\s*\[\s*['"]([\w$]+)['"]\s*\]/g;
  while ((m = dsRe2.exec(jsSrc))) dsRead.add(m[1]);
  if (dataAttrs.size) {
    dsRead.forEach(k => {
      if (!dataAttrs.has(k)) push('P0', js, `读取 dataset.${k}，但 wxml 中没有 data-${k.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}`);
    });
  }

  // ---- 5. wx:for 缺 wx:key ----
  const forRe = /<([a-zA-Z-]+)\b[^>]*\bwx:for\s*=\s*"[^"]*"[^>]*>/g;
  while ((m = forRe.exec(wxmlSrc))) {
    forCount++;
    if (!/\bwx:key\s*=/.test(m[0])) {
      push('P2', wxml, `wx:for 缺少 wx:key：${m[0].slice(0, 70).replace(/\s+/g, ' ')}`);
    }
  }

  // ---- 3/4. 跳转路由 ----
  [wxmlSrc, jsSrc].forEach((src, idx) => {
    const urlRe = /(?:url|path)\s*[:=]\s*['"`](\/pages\/[^'"`?\s$]*)/g;
    while ((m = urlRe.exec(src))) {
      urlCount++;
      const route = m[1].replace(/^\//, '');
      if (!routeSet.has(route)) {
        push('P0', idx === 0 ? wxml : js, `跳转到未注册页面：/${route}`);
      } else if (tabBarRoutes.has(route)) {
        // 只有 navigateTo/redirectTo 会失败；switchTab/分享 path 允许
        const around = src.slice(Math.max(0, m.index - 40), m.index);
        if (/navigateTo|redirectTo/.test(around)) {
          push('P0', idx === 0 ? wxml : js, `navigateTo 指向 tabBar 页面 /${route}（会失败，需 switchTab）`);
        }
      }
    }
  });
});

// 云函数目录完整性：每个云函数应有 index.js + package.json
fs.readdirSync(path.join(ROOT, 'cloudfunctions'), { withFileTypes: true })
  .filter(d => d.isDirectory())
  .forEach(d => {
    const dir = path.join(ROOT, 'cloudfunctions', d.name);
    if (!fs.existsSync(path.join(dir, 'index.js'))) push('P1', dir, '云函数缺少 index.js');
    if (!fs.existsSync(path.join(dir, 'package.json'))) push('P1', dir, '云函数缺少 package.json');
  });

const order = { P0: 0, P1: 1, P2: 2 };
problems.sort((a, b) => order[a.level] - order[b.level]);
console.log(`扫描：${wxmlFiles.length} 个页面 wxml，路由表 ${routeSet.size} 条，tabBar ${tabBarRoutes.size} 条`);
console.log(`解析命中：事件绑定 ${bindCount} 处 / data-* ${dsCount} 处 / 跳转 ${urlCount} 处 / wx:for ${forCount} 处`);
if (!problems.length) {
  console.log('✅ 未发现问题');
} else {
  problems.forEach(p => console.log(`[${p.level}] ${p.file}\n      ${p.msg}`));
  console.log(`\n共 ${problems.length} 条：P0 ${problems.filter(p => p.level === 'P0').length} / P1 ${problems.filter(p => p.level === 'P1').length} / P2 ${problems.filter(p => p.level === 'P2').length}`);
}
