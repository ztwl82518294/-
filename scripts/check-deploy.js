#!/usr/bin/env node
/**
 * 云函数部署前检查（PRD 模块 05 / 部署清单）
 *
 * 云函数只能在微信开发者工具里点「上传并部署」——脚本无法代劳。
 * 本脚本做的是**上传之前能自动查的部分**，把「传上去才发现不对」的风险提前掉：
 *
 *   1. 两个云函数文件齐全，且 package.json 声明了 wx-server-sdk
 *   2. 语法能过（require 一次不报 SyntaxError）
 *   3. 每个云函数都有 exports.main
 *   4. 响应形态统一为 { ok, code?, message? }（前端按这个判断，不一致会静默失败）
 *   5. 前端调用处传的字段，与云函数读的字段对得上
 *   6. 云函数里用到的集合名，都在 shared/schema.js 里声明过
 *   7. .data/*.jsonl 四个导出文件存在、行数与种子数据一致、字段不越界
 *   8. app.js 的云环境 ID 不是占位符
 *
 * 用法：node scripts/check-deploy.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

let pass = 0;
let fail = 0;
const problems = [];

function ok(msg) {
  pass++;
  console.log('  ✓ ' + msg);
}
function bad(msg, detail) {
  fail++;
  problems.push(msg + (detail ? ' —— ' + detail : ''));
  console.log('  ✗ ' + msg + (detail ? ' —— ' + detail : ''));
}
function section(t) {
  console.log('\n【' + t + '】');
}

const FUNCS = ['submitCorrection', 'trackCompanyView'];

/* ---------- 1. 文件齐全 ---------- */
section('1. 云函数文件齐全');
const funcSrc = {};
for (const f of FUNCS) {
  const dir = path.join(ROOT, 'cloudfunctions', f);
  const idx = path.join(dir, 'index.js');
  const pkg = path.join(dir, 'package.json');
  if (!fs.existsSync(idx)) {
    bad(f + '/index.js 缺失');
    continue;
  }
  if (!fs.existsSync(pkg)) {
    bad(f + '/package.json 缺失');
    continue;
  }
  funcSrc[f] = fs.readFileSync(idx, 'utf8');
  const p = JSON.parse(fs.readFileSync(pkg, 'utf8'));
  const deps = Object.keys(p.dependencies || {});
  if (deps.indexOf('wx-server-sdk') < 0) {
    bad(f + ' 的 package.json 未声明 wx-server-sdk');
  } else {
    ok(f + ' 文件齐全，依赖 wx-server-sdk ' + p.dependencies['wx-server-sdk']);
  }
}

/* ---------- 2. 语法可解析 ---------- */
section('2. 语法检查');
for (const f of FUNCS) {
  if (!funcSrc[f]) continue;
  try {
    new (require('vm').Script)(funcSrc[f], { filename: f + '/index.js' });
    ok(f + '/index.js 语法正确');
  } catch (e) {
    bad(f + '/index.js 语法错误', e.message);
  }
}

/* ---------- 3. 导出 main ---------- */
section('3. 入口导出');
for (const f of FUNCS) {
  if (!funcSrc[f]) continue;
  if (/exports\.main\s*=/.test(funcSrc[f])) {
    ok(f + ' 导出了 exports.main');
  } else {
    bad(f + ' 未导出 exports.main');
  }
}

/* ---------- 4. 响应形态统一 ---------- */
section('4. 响应形态');
for (const f of FUNCS) {
  if (!funcSrc[f]) continue;
  const src = funcSrc[f];
  if (!/ok:\s*(true|false)/.test(src) && !/ok\s*===?\s*(true|false)/.test(src)) {
    bad(f + ' 的返回值里没有 { ok } 字段');
    continue;
  }
  // 失败分支必须带 code + message（前端靠它区分 RATE_LIMITED 等）
  const hasCode = /code:/.test(src);
  const hasMsg = /message:/.test(src);
  if (hasCode && hasMsg) {
    ok(f + ' 返回 { ok, code, message } 形态');
  } else {
    bad(f + ' 缺少 ' + (hasCode ? 'message' : 'code') + ' 字段');
  }
}

/* ---------- 5. 前端调用字段 vs 云函数读取字段 ---------- */
section('5. 前后端字段对齐');

/** 从源码里抽"调用云函数时传的 data 键" */
function clientFields(file, funcName) {
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) return null;
  const src = fs.readFileSync(p, 'utf8');
  // 找到 name: '<funcName>' 附近的对象字面量
  const i = src.indexOf("name: '" + funcName + "'");
  if (i < 0) return null;
  const seg = src.slice(i, i + 900);
  const start = seg.indexOf('data:');
  if (start < 0) return [];
  const body = seg.slice(start, start + 700);
  const keys = [];
  const re = /(?:^|[{,]\s*)([A-Za-z_$][\w$]*)\s*:/g;
  let m;
  while ((m = re.exec(body))) {
    if (m[1] === 'data' || m[1] === 'name') continue;
    keys.push(m[1]);
  }
  const end = body.indexOf('}');
  return keys.slice(0, 20);
}

/** 从云函数源码里抽它读的 event 字段 */
function serverFields(src) {
  const keys = new Set();
  const re = /event\s*(?:&&)?\s*\.\s*([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = re.exec(src))) keys.add(m[1]);
  const re2 = /event\s*&&\s*event\s*\.\s*([A-Za-z_$][\w$]*)/g;
  while ((m = re2.exec(src))) keys.add(m[1]);
  return keys;
}

const PAIRS = [
  { func: 'submitCorrection', file: 'pages/correction/index.js' },
  { func: 'trackCompanyView', file: 'pages/company-detail/index.js' }
];

for (const pr of PAIRS) {
  const src = funcSrc[pr.func];
  if (!src) continue;
  const sent = clientFields(pr.file, pr.func);
  if (sent === null) {
    bad('在 ' + pr.file + ' 里找不到对 ' + pr.func + ' 的调用');
    continue;
  }
  const read = serverFields(src);
  // data 里传的键，服务端至少要读一个（不同函数读的字段不同，只做包含性检查）
  const sentInServer = sent.filter((k) => read.has(k));
  if (sentInServer.length === 0) {
    bad(
      pr.func + ' 前端传的字段服务端一个都没读',
      '前端传 [' + sent.join(', ') + ']，服务端读 [' + [...read].join(', ') + ']'
    );
  } else {
    ok(
      pr.func + ' 前端传 ' + sent.length + ' 个字段，服务端读取 ' + sentInServer.length + ' 个：' + sentInServer.join(', ')
    );
  }
}

/* ---------- 6. 集合名都在 schema 里声明过 ---------- */
section('6. 集合名合法性');
const schema = require(path.join(ROOT, 'shared', 'schema.js'));
const declared = new Set(Object.values(schema.COLLECTIONS));

/**
 * ★ 已知例外：不属于业务表的内部集合。
 *   view_dedup 是 trackCompanyView 的去重桶表（按 openid + companyId + 小时桶），
 *   纯内部实现细节，不需要进 shared/schema.js —— 它不是「六表模型」的一部分。
 */
const INTERNAL_COLLECTIONS = new Set(['view_dedup']);

/**
 * 抽出源码里所有 collection(...) 的参数，**同时支持字符串字面量与常量引用**。
 *
 * ★ 为什么要两种都支持（踩过）：
 *   云函数里普遍写成 `.collection(COLLECTION)`，COLLECTION 是文件顶部的常量。
 *   只匹配字符串字面量（collection('xxx')）会一处都找不到 → 误报「未发现 collection()」。
 *   常量要先回到源码里解析它的取值。
 */
function collectionsUsed(src) {
  const out = new Set();
  // 先收集常量：const XXX = 'value'
  const consts = {};
  const cre = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = cre.exec(src))) consts[m[1]] = m[2];

  // 再收 collection( '<literal>' ) 或 collection( IDENT )
  const re = /collection\(\s*(?:['"]([^'"]+)['"]|([A-Za-z_$][\w$]*))\s*\)/g;
  while ((m = re.exec(src))) {
    if (m[1]) {
      out.add(m[1]);
    } else if (m[2]) {
      if (consts[m[2]]) out.add(consts[m[2]]);
      else out.add('?' + m[2]); // 解析不出来的常量，标出来让人看
    }
  }
  return out;
}

for (const f of FUNCS) {
  if (!funcSrc[f]) continue;
  const used = collectionsUsed(funcSrc[f]);
  if (used.size === 0) {
    bad(f + ' 里未发现 collection() 调用');
    continue;
  }
  const unknown = [...used].filter((c) => !declared.has(c) && !INTERNAL_COLLECTIONS.has(c));
  const unresolved = [...used].filter((c) => c.startsWith('?'));
  if (unresolved.length) {
    bad(f + ' 有集合名解析不出（常量未在同文件定义？）', unresolved.join(', '));
  } else if (unknown.length) {
    bad(f + ' 用到未声明的集合', unknown.join(', '));
  } else {
    const internal = [...used].filter((c) => INTERNAL_COLLECTIONS.has(c));
    ok(
      f +
        ' 使用集合 ' +
        [...used].join(', ') +
        '（业务表均在 schema 声明' +
        (internal.length ? '；' + internal.join(', ') + ' 为内部表，已豁免' : '') +
        '）'
    );
  }
}

/* ---------- 7. 导入数据就绪 ---------- */
section('7. 导入数据（.data/*.jsonl）');
const tables = require(path.join(ROOT, 'data', 'seed-data.js')).buildTables();
const cityMod = require(path.join(ROOT, 'data', 'cities.js'));

const EXPECT = [
  { name: 'companies', rows: tables.companies, fields: schema.COMPANY_FIELDS },
  { name: 'routes', rows: tables.routes, fields: schema.ROUTE_FIELDS },
  { name: 'route_companies', rows: tables.routeCompanies, fields: schema.ROUTE_COMPANY_FIELDS },
  { name: 'cities', rows: cityMod.CITIES, fields: schema.CITY_FIELDS },
  /*
   * ★ 运营位两张表也要纳入部署前检查：
   *   漏了它们的后果是「首页公告栏和推广位永远走内置兜底」，
   *   后台改了内容首页不变 —— 页面不报错，只是功能不对，只能靠这里发现。
   */
  { name: 'announcements', rows: tables.announcements, fields: schema.ANNOUNCEMENT_FIELDS },
  { name: 'featured_routes', rows: tables.featuredRoutes, fields: schema.FEATURED_ROUTE_FIELDS }
];

for (const t of EXPECT) {
  const p = path.join(ROOT, '.data', t.name + '.jsonl');
  if (!fs.existsSync(p)) {
    bad('.data/' + t.name + '.jsonl 缺失');
    continue;
  }
  const lines = fs
    .readFileSync(p, 'utf8')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  if (lines.length !== t.rows.length) {
    bad(
      '.data/' + t.name + '.jsonl 行数不符',
      '文件 ' + lines.length + ' 行，种子数据 ' + t.rows.length + ' 行'
    );
    continue;
  }
  // 字段越界检查
  const declaredF = new Set(Object.values(t.fields));
  const extra = new Set();
  for (const ln of lines) {
    try {
      Object.keys(JSON.parse(ln)).forEach((k) => {
        if (!declaredF.has(k)) extra.add(k);
      });
    } catch (e) {
      bad('.data/' + t.name + '.jsonl 有非法 JSON 行', ln.slice(0, 60));
      break;
    }
  }
  if (extra.size) {
    bad('.data/' + t.name + '.jsonl 含 schema 未声明的字段', [...extra].join(', '));
  } else {
    ok('.data/' + t.name + '.jsonl ' + lines.length + ' 行，字段合规');
  }
}

/* ---------- 8. 云环境 ID ---------- */
section('8. 云环境配置');
const appSrc = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const envM = appSrc.match(/CLOUD_ENV\s*=\s*['"]([^'"]+)['"]/);
if (!envM) {
  bad('app.js 里找不到 CLOUD_ENV');
} else if (/xxx|your|placeholder|todo/i.test(envM[1])) {
  bad('云环境 ID 像占位符', envM[1]);
} else {
  ok('云环境 ID = ' + envM[1]);
}
if (fs.existsSync(path.join(ROOT, 'cloudfunctions', 'submitCorrection', 'node_modules'))) {
  console.log('    · 注：本地已有 node_modules，可支持「上传并部署：所有文件」');
} else {
  console.log('    · 注：本地无 node_modules，上传时请选「上传并部署：云端安装依赖」');
}

/* ---------- 汇总 ---------- */
console.log('\n' + '='.repeat(52));
console.log('检查项 ' + (pass + fail) + ' 个：通过 ' + pass + '，失败 ' + fail);

if (fail) {
  console.log('\n需要处理：');
  problems.forEach((p, i) => console.log('  ' + (i + 1) + '. ' + p));
  console.log('\n❌ 有问题未解决，请先修再上传');
  process.exit(1);
}
console.log('\n✅ 全部通过，可以去开发者工具上传云函数了');
console.log('\n上传步骤（只能手动做，脚本代劳不了）：');
FUNCS.forEach((f, i) => {
  console.log('  ' + (i + 1) + ') 云开发 → 云函数 → 右键 ' + f + ' → 上传并部署：云端安装依赖');
});
console.log('  ' + (FUNCS.length + 1) + ') 两个都传完，回传结果给我，再跑 check-acceptance.js 复核');
