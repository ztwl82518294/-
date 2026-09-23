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
const { stripComments } = require('./lib/src-scan');

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
/**
 * 提醒（不计入失败）
 *
 * ★ 为什么不直接算失败：这类项不是「代码错了」，而是「部署后某个功能还用不了」。
 *   空态不等于失败态 —— 白名单还没填是等待人工，把它算成红灯，只会让人习惯性忽略红灯。
 *   但也不能不吭声（那是另一种失职），所以汇总时单独列出来。
 */
const notices = [];
function warn(msg, detail) {
  notices.push(msg + (detail ? ' —— ' + detail : ''));
  console.log('  ! ' + msg + (detail ? ' —— ' + detail : ''));
}
function section(t) {
  console.log('\n【' + t + '】');
}

/*
 * ★ 新增云函数必须登记在这里 —— 否则部署检查根本不会看它，
 *   一个缺 package.json 的云函数会一路绿灯直到上传时才炸。
 */
const FUNCS = ['submitCorrection', 'trackCompanyView', 'adminApi'];

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

/**
 * ★ 例外：集合名全部取自 shared/schema.js 的云函数，静态扫不出来但天然合法。
 *   adminApi 写成 `C.COMPANIES`（C = schema.COLLECTIONS）与 `COLLECTION_OF[type]`（动态），
 *   正则既匹配不到 `C.COMPANIES` 也解析不出动态取值 —— 硬凑正则只会误报。
 *   认这个模式即可：来源是 schema，就不可能越出已声明的集合。
 */
function usesSchemaCollections(src) {
  return /=\s*schema\.COLLECTIONS\b/.test(src) || /COLLECTION_OF\s*=/.test(src);
}

for (const f of FUNCS) {
  if (!funcSrc[f]) continue;
  if (usesSchemaCollections(funcSrc[f])) {
    ok(f + ' 的集合名全部取自 shared/schema.js（天然合法，无需逐个匹配）');
    continue;
  }
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

/* ---------- 8. 云函数里的共用模块副本与主仓库一致 ---------- */
section('8. 云函数副本未漂移');
/*
 * ★ 云函数部署时只上传自己的目录，所以 shared/ 与 utils/ 的共用模块在
 *   cloudfunctions/<fn>/ 下各有一份副本（由 scripts/sync-cloud-shared.js 生成）。
 *   改了主仓库却没同步 ⇒ 本地测试全绿（跑的是主仓库那份），云端跑旧逻辑，且不报错。
 *   这一步就是把「同步」变成可验证的，而不是靠记性。
 */
const { spawnSync } = require('child_process');
const syncScript = path.join(ROOT, 'scripts', 'sync-cloud-shared.js');
if (!fs.existsSync(syncScript)) {
  bad('scripts/sync-cloud-shared.js 缺失（无法校验云函数副本是否漂移）');
} else {
  const r = spawnSync(process.execPath, [syncScript, '--check'], { encoding: 'utf8' });
  const out = ((r.stdout || '') + (r.stderr || '')).trim();
  if (r.status === 0) {
    ok('云函数副本与主仓库一致');
  } else {
    bad('云函数副本与主仓库不一致', out.split('\n').slice(0, 4).join(' / '));
  }
}

/* ---------- 9. 云环境 ID ---------- */
section('9. 云环境配置');
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

/* ---------- 10. 小程序端后台（pages/admin）完备性 ---------- */
section('10. 小程序端后台（pages/admin）');
/*
 * ★ 为什么要单独查这一节：
 *   小程序后台是第二个写入口，而且它**直接写云端**。它的五页里任何一页缺文件、
 *   没注册、或绕过 utils/admin 直连数据库，表现出来都不是「报错」——
 *   而是「页面打不开」或「权限校验被架空」，属于上线后才发现的那类问题。
 */
const ADMIN_PAGES = ['index', 'list', 'edit', 'quality', 'import'];
const appJsonSrc = fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8');
const appJson = JSON.parse(appJsonSrc);
const registered = appJson.pages || [];
let adminBad = 0;

for (const p of ADMIN_PAGES) {
  const rel = 'pages/admin/' + p + '/index';
  const missing = ['.js', '.json', '.wxml', '.wxss'].filter((ext) => !fs.existsSync(path.join(ROOT, rel + ext)));
  if (missing.length) {
    bad(rel + ' 缺文件', missing.join(' '));
    adminBad++;
    continue;
  }
  if (registered.indexOf(rel) < 0) {
    bad(rel + ' 未在 app.json 注册');
    adminBad++;
    continue;
  }
  /*
   * ★ 必须先剥注释再扫：
   *   utils/admin.js 的注释里写着「页面里不允许出现 .collection(」—— 不剥注释的话，
   *   这句解释禁令的注释会被当成违反禁令的代码，产生假警报（check-requires.js 同坑）。
   */
  const src = stripComments(fs.readFileSync(path.join(ROOT, rel + '.js'), 'utf8'));
  if (/require\(['"][^'"]*utils\/admin['"]\)/.test(src)) {
    // 走通道，无话可说
  } else {
    bad(rel + ' 没有走 utils/admin 通道（云端鉴权会被绕开）');
    adminBad++;
  }
  if (/\.collection\(/.test(src)) {
    bad(rel + ' 直接操作了数据库（必须走云函数 adminApi）');
    adminBad++;
  }
}
/*
 * ★ 整勾条件打印：上面具体的 bad 已经一条条报过了，这里不能再无条件打 ✓，
 *   否则出现「一行红一行绿」的自相矛盾输出，反而掩盖问题。
 */
if (adminBad === 0) {
  ok('后台 ' + ADMIN_PAGES.length + ' 页文件齐全、已注册、且统一走 utils/admin 通道');
}

/* ADMIN_OPENIDS：空 ⇒ 后台谁也进不去（含管理员自己），属于待办不是错误 */
const adminApiSrc = funcSrc['adminApi'] || fs.readFileSync(path.join(ROOT, 'cloudfunctions', 'adminApi', 'index.js'), 'utf8');
const idsM = adminApiSrc.match(/const\s+ADMIN_OPENIDS\s*=\s*\[([\s\S]*?)\]/);
if (!idsM) {
  bad('adminApi 里找不到 ADMIN_OPENIDS 定义');
} else {
  const raw = idsM[1];
  /*
   * ★ 先剥注释再数字面量 —— 否则会把注释占位那一行也计入：
   *   原文件的数组体里全是 `// 'oXXX...' ← 管理员 A`，
   *   按逗号切一切、去首尾空格，第二段的开头其实是「← 管理员 A」而不是 '//'，
   *   于是被当成真配了一个管理员 —— 典型的**假绿**（比报错更危险）。
   */
  const body = raw.replace(/\/\/[^\n]*/g, '');
  const ids = (body.match(/['"][^'"]+['"]/g) || []);
  if (ids.length === 0) {
    warn('ADMIN_OPENIDS 为空：部署后小程序后台对所有人不可用', '先用微信打开后台页抄 openid 再重传');
  } else {
    ok('ADMIN_OPENIDS 已配置 ' + ids.length + ' 个管理员');
  }
}

/* ---------- 汇总 ---------- */
console.log('\n' + '='.repeat(52));
console.log('检查项 ' + (pass + fail) + ' 个：通过 ' + pass + '，失败 ' + fail);
if (notices.length) {
  console.log('待办提醒 ' + notices.length + ' 项：');
  notices.forEach((n, i) => console.log('  ' + (i + 1) + '. ' + n));
}

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
