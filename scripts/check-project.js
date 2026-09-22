#!/usr/bin/env node
/**
 * 项目静态体检
 *
 * 一次跑完以下几类检查，任一失败以非零码退出（可挂 CI / 提交前钩子）：
 *   1. 编码    —— 所有源码文件不得带 BOM、不得是 CRLF
 *   2. 语法    —— 所有 .js 必须能通过 vm.Script 编译
 *   3. 注册    —— app.json 页面 / 组件四件套齐全
 *   4. 绑定    —— WXML 里的事件绑定在对应 JS 中必须有实现
 *   5. 集合名  —— 代码中不得出现硬编码集合名字符串（必须走 shared/schema）
 *   6. 铁律    —— Notion 主题四条铁律（无渐变 / 无光斑 / 无半透明染色 / 无高光内阴影）
 *   7. 隐私    —— 不得出现 utils/privacy.js 里的 FORBIDDEN_APIS
 *   8. require —— 所有相对 require 路径必须真实存在（跳过注释）
 *   9. 测试    —— 测试套件与统一入口存在
 *  10. 脚本    —— 工程脚本存在
 *
 * 用法：node scripts/check-project.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SKIP_DIRS = ['node_modules', '.git', '.data', '.workbuddy'];

let errors = [];
let warnings = [];
let checks = 0;

function fail(msg) { errors.push(msg); }
function warn(msg) { warnings.push(msg); }

/** 递归收集文件 */
function walk(dir, out) {
  const acc = out || [];
  for (const name of fs.readdirSync(dir)) {
    if (SKIP_DIRS.indexOf(name) >= 0) continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

/* ============================================================
 * 1. 编码检查
 * ============================================================ */
function checkEncoding(files) {
  checks++;
  const exts = ['.js', '.json', '.wxml', '.wxss'];
  for (const f of files) {
    if (exts.indexOf(path.extname(f)) < 0) continue;
    const buf = fs.readFileSync(f);
    if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
      fail('[编码] 带 BOM：' + rel(f));
    }
    if (buf.indexOf(Buffer.from('\r\n')) >= 0) {
      warn('[编码] 含 CRLF：' + rel(f));
    }
  }
}

/* ============================================================
 * 2. 语法检查
 * ============================================================ */
function checkSyntax(files) {
  checks++;
  for (const f of files) {
    if (path.extname(f) !== '.js') continue;
    let src = fs.readFileSync(f, 'utf8');
    // 剥 shebang：Node 认，vm.Script 不认（踩过这个坑）
    if (src.indexOf('#!') === 0) src = src.replace(/^#[^\n]*\n/, '');
    try {
      new vm.Script(src, { filename: f });
    } catch (e) {
      fail('[语法] ' + rel(f) + ' → ' + e.message);
    }
  }
}

/* ============================================================
 * 3. 注册检查
 * ============================================================ */
function checkRegistration() {
  checks++;
  const appJsonPath = path.join(ROOT, 'app.json');
  if (!fs.existsSync(appJsonPath)) { fail('[注册] 缺 app.json'); return; }

  let app;
  try { app = JSON.parse(fs.readFileSync(appJsonPath, 'utf8')); }
  catch (e) { fail('[注册] app.json 解析失败：' + e.message); return; }

  const exts = ['.js', '.json', '.wxml', '.wxss'];
  (app.pages || []).forEach((p) => {
    exts.forEach((e) => {
      if (!fs.existsSync(path.join(ROOT, p + e))) fail('[注册] 页面缺文件：' + p + e);
    });
  });

  // 全局组件
  const comps = app.usingComponents || {};
  Object.keys(comps).forEach((k) => {
    const base = comps[k].replace(/^\//, '');
    exts.forEach((e) => {
      if (!fs.existsSync(path.join(ROOT, base + e))) fail('[注册] 全局组件缺文件：' + base + e);
    });
  });

  // 页面级组件
  (app.pages || []).forEach((p) => {
    const jf = path.join(ROOT, p + '.json');
    if (!fs.existsSync(jf)) return;
    let j;
    try { j = JSON.parse(fs.readFileSync(jf, 'utf8')); }
    catch (e) { fail('[注册] ' + p + '.json 解析失败：' + e.message); return; }
    const uc = j.usingComponents || {};
    Object.keys(uc).forEach((k) => {
      const base = uc[k].replace(/^\//, '');
      exts.forEach((e) => {
        if (!fs.existsSync(path.join(ROOT, base + e))) {
          fail('[注册] ' + p + ' 引用的组件 ' + k + ' 缺文件：' + base + e);
        }
      });
    });
  });
}

/* ============================================================
 * 4. 事件绑定检查
 * ============================================================ */
/** WXML 里 bind/catch 的 handler → 在 JS 中是否有实现 */
function collectHandlers(wxml) {
  const set = new Set();
  const re = /(?:bind|catch)[:a-zA-Z]*\s*=\s*"([a-zA-Z_$][\w$]*)"/g;
  let m;
  while ((m = re.exec(wxml))) set.add(m[1]);
  return set;
}

function checkBindings(files) {
  checks++;
  const wxmls = files.filter((f) => path.extname(f) === '.wxml');
  for (const w of wxmls) {
    const js = w.replace(/\.wxml$/, '.js');
    if (!fs.existsSync(js)) continue;
    const src = fs.readFileSync(js, 'utf8');
    const handlers = collectHandlers(fs.readFileSync(w, 'utf8'));
    for (const h of handlers) {
      const found = new RegExp('(^|[\\s,{,])' + h + '\\s*[:(=]', 'm').test(src);
      if (!found) fail('[绑定] ' + rel(w) + ' 绑定的方法 ' + h + ' 在 JS 中不存在');
    }
  }
}

/* ============================================================
 * 5. 集合名硬编码检查
 * ============================================================ */
const COLLECTION_NAMES = ['companies', 'routes', 'route_companies', 'cities', 'corrections', 'admins'];

function checkHardcodedCollections(files) {
  checks++;
  const allow = [
    'shared/schema.js',
    'scripts/export-seed.js',
    'data/seed-data.js',
    'admin/'
  ];
  for (const f of files) {
    const r = rel(f);
    if (path.extname(f) !== '.js') continue;
    if (allow.some((a) => r.indexOf(a) === 0)) continue;
    // 只在「小程序源码」范围内检查（pages/ 与 components/ 与 utils/）
    if (!/^(pages|components|utils)\//.test(r)) continue;

    const src = fs.readFileSync(f, 'utf8');
    for (const name of COLLECTION_NAMES) {
      // 匹配 coll('xxx') / collection('xxx') / .doc('xxx') 这类调用
      const re = new RegExp('(?:coll|collection)\\s*\\(\\s*[\'"]' + name + '[\'"]', 'g');
      if (re.test(src)) {
        fail('[集合名] ' + r + ' 硬编码集合名 "' + name + '"，应改用 COLLECTIONS 常量');
      }
    }
  }
}

/* ============================================================
 * 6. Notion 主题四条铁律
 *
 * ★ 检查前必须先剥掉 CSS 注释块。
 *   原因：app.wxss 的头注释里**正在讲解**这四条铁律（会写出
 *   "不得出现 radial-gradient / inset 0 0 0" 这类字样），
 *   若不剥注释，检查器会把「说明文字」判成「违规代码」——本脚本
 *   第一版就踩了这个坑，报了 3 条假失败。
 * ============================================================ */
function stripCssComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '');
}

function checkTheme(files) {
  checks++;
  const styles = files.filter((f) => path.extname(f) === '.wxss');
  for (const f of styles) {
    const src = stripCssComments(fs.readFileSync(f, 'utf8'));
    const r = rel(f);

    // 铁律 1：无渐变
    if (/linear-gradient/.test(src)) fail('[铁律1 无渐变] ' + r + ' 出现 linear-gradient');
    // 铁律 2：无光斑
    if (/radial-gradient/.test(src)) fail('[铁律2 无光斑] ' + r + ' 出现 radial-gradient');
    // 铁律 4：无高光内阴影
    if (/inset\s+0\s+0\s+0/.test(src)) fail('[铁律4 无高光内阴影] ' + r + ' 出现 inset 0 0 0');
    // 铁律 3：--tint-* 必须是实色
    if (r === 'app.wxss') {
      const m = src.match(/--tint-[a-z]+:\s*([^;]+);/g) || [];
      m.forEach((line) => {
        if (/rgba?\(/.test(line)) {
          fail('[铁律3 无半透明染色] app.wxss 中 ' + line.trim() + ' 应为实色');
        }
      });
    }
  }
}

/* ============================================================
 * 7. 隐私接口反向清单
 *
 * ★ 必须排除 utils/privacy.js 自身：
 *   它是 FORBIDDEN_APIS 的**定义处**，字面上就含这些接口名。
 *   检查的意义是「除定义之外，代码里不得出现」。
 * ============================================================ */
function checkPrivacy(files) {
  checks++;
  let forbidden = [];
  try {
    forbidden = require(path.join(ROOT, 'utils/privacy.js')).FORBIDDEN_APIS || [];
  } catch (e) {
    fail('[隐私] 无法加载 utils/privacy.js：' + e.message);
    return;
  }
  for (const f of files) {
    const r = rel(f);
    if (r === 'utils/privacy.js') continue; // 定义处，跳过
    if (!/^(pages|components|utils)\//.test(r)) continue;
    if (!/\.(js|wxml)$/.test(r)) continue;
    let src = fs.readFileSync(f, 'utf8');
    // JS 里也要剥注释，否则一句「本页不用 wx.getLocation」的好心注释会被判违规
    if (path.extname(f) === '.js') src = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    if (path.extname(f) === '.wxml') src = src.replace(/<!--[\s\S]*?-->/g, '');

    for (const api of forbidden) {
      if (src.indexOf(api) >= 0) {
        fail('[隐私] ' + r + ' 出现禁用接口 ' + api);
      }
    }
  }
}

/* ============================================================
 * 9. require 路径有效性
 * 小程序里路径写错（如少写一级 ../）编译期不报错，运行时才抛
 * "module not found"，页面直接白屏，很难排查。所以静态扫一遍。
 *
 * ★ 必须先去掉注释：
 *   注释里常写用法示例，如 `在套件里：require('../framework')`。
 *   不去注释就会把示例当真实依赖校验 —— 相对路径是相对**注释所在文件**
 *   解析的，往往不存在，于是报一堆假警报，真问题反而被淹没。
 *   字符串要**保留**（require 的路径本身就是字符串）。
 * ============================================================ */
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  const blank = (s) => s.replace(/[^\n]/g, ' '); // 换行保留 → 行号不变

  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '/' && c2 === '/') {
      let j = i;
      while (j < n && src[j] !== '\n') j++;
      out += blank(src.slice(i, j));
      i = j;
      continue;
    }
    if (c === '/' && c2 === '*') {
      let j = i + 2;
      while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++;
      j = Math.min(j + 2, n);
      out += blank(src.slice(i, j));
      i = j;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === quote) { j++; break; }
        if (quote !== '`' && src[j] === '\n') break;
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

function checkRequires(files) {
  checks++;
  let total = 0;
  const bad = [];
  for (const f of files) {
    if (path.extname(f) !== '.js') continue;
    const text = stripComments(fs.readFileSync(f, 'utf8'));
    const re = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
    let m;
    while ((m = re.exec(text))) {
      total += 1;
      const spec = m[1];
      let target = path.resolve(path.dirname(f), spec);
      if (!path.extname(target)) target += '.js';
      if (!fs.existsSync(target)) {
        const line = text.slice(0, m.index).split('\n').length;
        bad.push(rel(f) + ':' + line + '  ->  ' + spec);
      }
    }
  }
  bad.forEach((x) => fail('[require] 路径不存在：' + x));
  if (!bad.length) console.log('相对 require ' + total + ' 处，全部有效');
}

/* ============================================================
 * 10. 测试套件存在性
 * 体检只保证「结构没问题」，逻辑正确性靠 test/run-all.js。
 * 这里做一件轻量的事：确认套件没被误删，并提示当前断言规模。
 * ============================================================ */
function checkTests() {
  checks++;
  const dir = path.join(ROOT, 'test/suites');
  if (!fs.existsSync(dir)) {
    fail('[测试] 缺少 test/suites 目录');
    return;
  }
  const suites = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js'));
  if (!suites.length) {
    fail('[测试] test/suites 下没有任何套件');
    return;
  }
  const must = ['common.test.js', 'search.test.js', 'seed-data.test.js'];
  for (const m of must) {
    if (suites.indexOf(m) < 0) warn('[测试] 缺少核心套件 ' + m);
  }
  if (!fs.existsSync(path.join(ROOT, 'test/run-all.js'))) {
    fail('[测试] 缺少 test/run-all.js 统一入口');
  }
  console.log('测试套件 ' + suites.length + ' 个：' + suites.join(' / '));
}

/* ============================================================
 * 11. 工程脚本存在性
 * 体检不重复跑验收脚本（那个有 60 条断言，单跑更清楚），
 * 只确认它们还在，并在汇总里提示怎么跑。
 * ============================================================ */
function checkScripts() {
  checks++;
  const must = {
    'scripts/export-seed.js': '数据导出 / 后台副本重建',
    'scripts/check-acceptance.js': 'PRD 验收自检（A1~A12）',
    'scripts/smoke-admin.js': '管理后台冒烟测试'
  };
  const missing = Object.keys(must).filter((f) => !fs.existsSync(path.join(ROOT, f)));
  if (missing.length) {
    missing.forEach((f) => fail('[脚本] 缺少 ' + f + '（' + must[f] + '）'));
    return;
  }
  console.log('工程脚本 ' + Object.keys(must).length + ' 个：' +
    Object.keys(must).map((f) => path.basename(f)).join(' / '));
}

/* ============================================================
 * 主流程
 * ============================================================ */
function main() {
  const files = walk(ROOT, []);

  checkEncoding(files);
  checkSyntax(files);
  checkRegistration();
  checkBindings(files);
  checkHardcodedCollections(files);
  checkTheme(files);
  checkPrivacy(files);
  checkRequires(files);
  checkTests();
  checkScripts();

  const counts = {    total: files.length,
    js: files.filter((f) => path.extname(f) === '.js').length,
    wxml: files.filter((f) => path.extname(f) === '.wxml').length,
    wxss: files.filter((f) => path.extname(f) === '.wxss').length
  };

  console.log('=== 项目静态体检 ===');
  console.log('文件 ' + counts.total + ' 个（js ' + counts.js + ' / wxml ' + counts.wxml + ' / wxss ' + counts.wxss + '）');
  console.log('检查项 ' + checks + ' 类');
  console.log('');

  if (warnings.length) {
    console.log('⚠️  警告 ' + warnings.length + ' 条：');
    warnings.forEach((w) => console.log('   ' + w));
    console.log('');
  }

  if (errors.length) {
    console.log('❌ 失败 ' + errors.length + ' 条：');
    errors.forEach((e) => console.log('   ' + e));
    process.exit(1);
  }

  console.log('✅ 全部通过');
}

main();
