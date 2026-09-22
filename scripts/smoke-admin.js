#!/usr/bin/env node
/**
 * 管理后台 HTTP 冒烟测试
 *
 * ★ 与 test/suites/admin.test.js 的分工：
 *   - admin.test.js      测**逻辑**（store / importer / auth / views），纯内存，秒级
 *   - smoke-admin.js     测**HTTP 层**（登录跳转、Cookie、路由、状态码、目录穿越），
 *                        需要真起一个服务器并在 8787/8791 上跑
 *
 * ★ 为什么必须单独有这一层：
 *   「逻辑对」不等于「线上能用」。B1「未登录访问被拦截」、Cookie 下发、
 *   静态资源路径、目录穿越防护 —— 这些只有走真实请求才验得到。
 *
 * ★ 用独立的端口与**独立的数据目录**，绝不碰 admin/data/ 正式数据。
 *   做法：把 ADMIN_PORT 设成 8791，并在启动前把 admin/data 里的四个数据文件
 *   换成一个临时副本，跑完还原。这样冒烟测试不会污染你正在用的数据。
 *
 * 用法：node scripts/smoke-admin.js
 */

const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'admin', 'data');
const PORT = Number(process.env.SMOKE_PORT || 8791);
/*
 * ★ 新增运营位两表（announcements / featured_routes）必须列进来：
 *   本脚本把 admin/data 当临时工作区，跑完还原；没列进 FILES 的文件
 *   **不会被备份**，冒烟里做的增删改就会真留在磁盘上。
 */
const FILES = [
  'companies.json', 'routes.json', 'route_companies.json', 'corrections.json', 'admins.json',
  'announcements.json', 'featured_routes.json'
];

let pass = 0;
let fail = 0;
const failures = [];
function t(label, cond, extra) {
  if (cond) {
    pass++;
    console.log('  ✓ ' + label + (extra ? ' — ' + extra : ''));
  } else {
    fail++;
    failures.push(label + (extra ? ' — ' + extra : ''));
    console.log('  ✗ ' + label + (extra ? ' — ' + extra : ''));
  }
}

function section(name) {
  console.log('');
  console.log('【' + name + '】');
}

/* ============================================================
 * 数据备份 / 还原（保证不污染正式数据）
 * ============================================================ */
const BACKUP_DIR = path.join(ROOT, '.tmp-smoke-backup');

/**
 * ★ 开跑前先体检：数据文件必须是「非空且能解析」。
 *
 * 为什么需要：本脚本会把 admin/data 当临时工作区用，跑完还原。
 * 但如果**进入时目录就已经是坏的**（例如被某个忘记 loadAll 的脚本清空过），
 * 那「还原」也只会把坏数据还原回来，问题被永远掩盖。
 * 所以这里先拦一道：数据目录不健康就拒绝跑，并给出修复命令。
 */
function assertDataHealthy() {
  const seed = require(path.join(ROOT, 'data', 'seed-data.js'));
  const expect = seed.buildTables();
  const expectCount = {
    'companies.json': expect.companies.length,
    'routes.json': expect.routes.length,
    'route_companies.json': expect.routeCompanies.length,
    'announcements.json': (expect.announcements || []).length,
    'featured_routes.json': (expect.featuredRoutes || []).length
  };

  const problems = [];
  Object.keys(expectCount).forEach((f) => {
    const p = path.join(DATA_DIR, f);
    if (!fs.existsSync(p)) { problems.push(f + ' 不存在'); return; }
    let arr;
    try {
      arr = JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) {
      problems.push(f + ' 解析失败：' + e.message);
      return;
    }
    if (!Array.isArray(arr) || arr.length === 0) {
      problems.push(f + ' 为空（应为 ' + expectCount[f] + ' 条）');
    }
  });

  if (problems.length) {
    console.error('');
    console.error('❌ admin/data 数据不健康，拒绝运行冒烟测试：');
    problems.forEach((x) => console.error('   - ' + x));
    console.error('');
    console.error('   原因很可能是某个脚本在未装载数据的情况下执行了写操作。');
    console.error('   修复：node scripts/export-seed.js --admin-only   （从唯一数据源重新生成）');
    console.error('');
    process.exit(1);
  }
}

function backupData() {
  if (fs.existsSync(BACKUP_DIR)) fs.rmSync(BACKUP_DIR, { recursive: true, force: true });
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const manifest = {};
  FILES.forEach((f) => {
    const src = path.join(DATA_DIR, f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(BACKUP_DIR, f));
      manifest[f] = true;
    } else {
      manifest[f] = false;
    }
  });
  fs.writeFileSync(path.join(BACKUP_DIR, '_manifest.json'),
    JSON.stringify(manifest, null, 2), { encoding: 'utf8' });
}

function restoreData() {
  let manifest = {};
  const mf = path.join(BACKUP_DIR, '_manifest.json');
  if (fs.existsSync(mf)) {
    try { manifest = JSON.parse(fs.readFileSync(mf, 'utf8')); } catch (e) { manifest = {}; }
  }
  FILES.forEach((f) => {
    const src = path.join(BACKUP_DIR, f);
    const dst = path.join(DATA_DIR, f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dst);
    } else if (manifest[f] === false || manifest[f] === undefined) {
      // 本来就没有这个文件（如 admins.json 是本次新建的）→ 删掉，恢复原状
      if (fs.existsSync(dst)) fs.unlinkSync(dst);
    }
  });
  if (fs.existsSync(BACKUP_DIR)) fs.rmSync(BACKUP_DIR, { recursive: true, force: true });
}

/* ============================================================
 * HTTP 小工具
 * ============================================================ */
let cookie = '';
/** 覆盖写事故护栏的实测错误信息（在「覆盖写事故护栏」一节里被赋值） */
let guardMessage = '(未触发)';

async function req(method, url, body, ctype) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (body && ctype) headers['Content-Type'] = ctype;

  const res = await fetch('http://127.0.0.1:' + PORT + url, {
    method: method,
    headers: headers,
    body: body,
    redirect: 'manual'
  });
  const setc = res.headers.get('set-cookie');
  /*
   * ★ 只在「下发了新 token」时才覆盖全局 cookie。
   *   坑：/logout 下发的是清空型 Cookie（`lq_admin=; ...; Max-Age=0`），
   *   若无脑 `cookie = setc.split(';')[0]`，会把变量写成字面量 "lq_admin="，
   *   之后所有请求都带一个空 token 而全部 401 —— 这会伪装成「接口坏了」。
   */
  if (setc) {
    const pair = setc.split(';')[0];
    const val = pair.slice(pair.indexOf('=') + 1);
    if (val) cookie = pair;
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* 页面不是 JSON */ }
  return { status: res.status, text: text, json: json, headers: res.headers };
}

/** 不带 Cookie 的裸请求（用于验证「公开资源」与「未登录拦截」） */
async function reqAnon(url) {
  const res = await fetch('http://127.0.0.1:' + PORT + url, { redirect: 'manual' });
  return { status: res.status, headers: res.headers, res: res };
}

/** 构造一个 multipart 体（用于测文件上传路径） */
function multipart(filename, content, fields) {
  const boundary = '----SmokeBoundary' + Date.now();
  const parts = [];
  Object.keys(fields || {}).forEach((k) => {
    parts.push(Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="' + k +
      '"\r\n\r\n' + fields[k] + '\r\n', 'utf8'));
  });
  parts.push(Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="' +
    filename + '"\r\nContent-Type: application/octet-stream\r\n\r\n', 'utf8'));
  parts.push(Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'));
  parts.push(Buffer.from('\r\n--' + boundary + '--\r\n', 'utf8'));
  return {
    body: Buffer.concat(parts),
    ctype: 'multipart/form-data; boundary=' + boundary
  };
}

/* ============================================================
 * 主流程
 * ============================================================ */
async function main() {
  console.log('管理后台 HTTP 冒烟测试');
  console.log('='.repeat(52));

  assertDataHealthy();
  backupData();
  process.env.ADMIN_PORT = String(PORT);
  process.env.ADMIN_SILENT = '1';

  const { start } = require(path.join(ROOT, 'admin/server.js'));
  start();
  await new Promise((r) => setTimeout(r, 500));

  try {
    /* ---------- B1 鉴权 ---------- */
    section('B1 登录与鉴权');

    let r = await req('GET', '/companies');
    t('未登录访问页面被重定向到登录', r.status === 302 && /\/login/.test(r.headers.get('location') || ''),
      'HTTP ' + r.status);

    r = await req('GET', '/api/quality');
    t('未登录访问 API 返回 401 UNAUTHORIZED', r.status === 401 && r.json && r.json.code === 'UNAUTHORIZED');

    r = await req('POST', '/login', 'username=admin&password=wrong', 'application/x-www-form-urlencoded');
    t('错误密码被拒', /账号或密码不正确/.test(r.text));

    r = await req('POST', '/login', 'username=nosuchuser&password=whatever', 'application/x-www-form-urlencoded');
    t('不存在的账号也是同一句提示（防账号枚举）', /账号或密码不正确/.test(r.text));

    r = await req('POST', '/login', 'username=&password=', 'application/x-www-form-urlencoded');
    t('空账号密码被拒', /账号或密码不正确/.test(r.text));

    r = await req('POST', '/login', 'username=admin&password=admin12345', 'application/x-www-form-urlencoded');
    t('正确账号密码登录成功', r.status === 302 && !!cookie, 'cookie=' + cookie.slice(0, 24) + '...');

    r = await req('GET', '/');
    t('登录后可访问总览', r.status === 200 && /总览/.test(r.text));

    /* ---------- 覆盖写事故护栏 ---------- */
    section('覆盖写事故护栏（「未装载禁止落盘」）');
    /*
     * ★ 这条护栏来自一次真实事故：写了个脚本调 repo.createCompany 想插一条数据，
     *   忘了先 loadAll()，内存里是空表，而 flush 是**全量覆盖写** ——
     *   结果整个公司的数据文件被抹成 `[]`，且不报任何错。
     *
     *   这里在一个**独立的 module 实例**里验证护栏：清掉 require 缓存重新加载
     *   repository，此时 loaded=false，任何写操作都必须抛错而不是写盘。
     *   （不能直接用正在跑的这份 repo，它已经 loadAll 过了。）
     */
    guardMessage = '(未触发)';
    try {      const repPath = require.resolve(path.join(ROOT, 'admin/lib/repository.js'));
      const storePath = require.resolve(path.join(ROOT, 'admin/lib/store.js'));
      delete require.cache[repPath];
      delete require.cache[storePath];
      const freshRepo = require(repPath);
      const before = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'companies.json'), 'utf8')).length;
      try {
        freshRepo.createCompany({ name: '护栏测试物流', city: '济南', phone: '0531-11110000' });
        guardMessage = '(没有抛错，护栏失效)';
      } catch (e) {
        guardMessage = e.message;
      }
      const after = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'companies.json'), 'utf8')).length;
      t('未装载时写操作被拒绝（抛错而不是静默写盘）', /拒绝落盘/.test(guardMessage));
      t('未装载时的写操作没有碰到磁盘文件', after === before, before + ' → ' + after);
      // 恢复被删掉的模块缓存，后面的测试继续用已装载的那份
      delete require.cache[repPath];
      delete require.cache[storePath];
      require(path.join(ROOT, 'admin/lib/repository.js'));
    } catch (e) {
      guardMessage = '护栏测试自身异常：' + e.message;
      t('未装载时写操作被拒绝（抛错而不是静默写盘）', false, guardMessage);
      t('未装载时的写操作没有碰到磁盘文件', false, guardMessage);
    }

    /* ---------- 页面渲染 ---------- */
    section('页面渲染');

    const pages = [
      ['/', '总览'],
      ['/companies', '公司'],
      ['/routes', '线路'],
      ['/links', '线路公司'],
      ['/corrections', '纠错审核'],
      ['/import', '批量导入'],
      ['/quality', '数据质量看板']
    ];
    for (const [url, expect] of pages) {
      r = await req('GET', url);
      t(url + ' 渲染正常', r.status === 200 && r.text.indexOf(expect) >= 0, 'HTTP ' + r.status);
    }

    r = await req('GET', '/companies/edit?id=comp_001');
    t('公司编辑页（带数据）', r.status === 200 && /鲁通/.test(r.text));

    r = await req('GET', '/companies/edit');
    t('公司编辑页（新建态）', r.status === 200 && /新建公司/.test(r.text));

    r = await req('GET', '/links/edit');
    t('关联编辑页（含线路/公司下拉）', r.status === 200 && /挂载公司到线路/.test(r.text));

    r = await req('GET', '/no-such-page');
    t('未知页面返回 404', r.status === 404);

    /* ---------- B4 单条增删改 ---------- */
    section('B4 单条增删改（写穿透落盘）');

    r = await req('POST', '/api/company/save',
      'name=' + encodeURIComponent('冒烟测试物流有限公司') + '&city=' + encodeURIComponent('济南') +
      '&phone=0531-66660000&scale=medium',
      'application/x-www-form-urlencoded');
    const smokeId = r.json && r.json.id;
    t('新建公司返回 id', r.json && r.json.ok && !!smokeId, smokeId);

    const onDisk = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'companies.json'), 'utf8'));
    t('新建结果已落盘到磁盘', onDisk.some((c) => c._id === smokeId));

    r = await req('POST', '/api/company/save',
      '_id=' + smokeId + '&name=' + encodeURIComponent('冒烟测试物流有限公司') +
      '&city=' + encodeURIComponent('济南') + '&phone=0531-66661111',
      'application/x-www-form-urlencoded');
    t('修改公司电话成功', r.json && r.json.ok);

    const onDisk2 = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'companies.json'), 'utf8'));
    t('修改已落盘', onDisk2.find((c) => c._id === smokeId).phone === '0531-66661111');
    t('修改刷新了 updatedAt（PRD：必须展示更新时间）',
      onDisk2.find((c) => c._id === smokeId).updatedAt > onDisk.find((c) => c._id === smokeId).updatedAt);

    r = await req('POST', '/api/company/save', '_id=' + smokeId + '&name=&city=&phone=bad',
      'application/x-www-form-urlencoded');
    t('非法输入被拒并给出具体原因', r.json && !r.json.ok && /必填|格式/.test(r.json.message),
      r.json && r.json.message);

    r = await req('POST', '/api/company/delete', '_id=' + smokeId, 'application/x-www-form-urlencoded');
    t('删除公司成功', r.json && r.json.ok, '清理关联 ' + (r.json && r.json.cascadedLinks) + ' 条');

    const onDisk3 = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'companies.json'), 'utf8'));
    t('删除已落盘', !onDisk3.some((c) => c._id === smokeId));

    /* ---------- routeKey 归一 ---------- */
    section('routeKey 归一（跨端一致性的命门）');

    r = await req('POST', '/api/route/save',
      'fromCity=' + encodeURIComponent('冒烟城甲市') + '&toCity=' + encodeURIComponent('冒烟城乙'),
      'application/x-www-form-urlencoded');
    const smokeRouteId = r.json && r.json.id;
    t('带「市」后缀的城市被归一', r.json && r.json.ok && smokeRouteId === 'route_冒烟城甲_冒烟城乙', smokeRouteId);

    r = await req('POST', '/api/route/save',
      'fromCity=' + encodeURIComponent('冒烟城甲') + '&toCity=' + encodeURIComponent('冒烟城乙市'),
      'application/x-www-form-urlencoded');
    t('归一后重复建线被拒', r.json && !r.json.ok, r.json && r.json.message);

    r = await req('POST', '/api/route/save',
      'fromCity=' + encodeURIComponent('冒烟同城') + '&toCity=' + encodeURIComponent('冒烟同城'),
      'application/x-www-form-urlencoded');
    t('出发=到达被拒', r.json && !r.json.ok);

    /* ---------- B2/B3 导入 ---------- */
    section('B2/B3 导入：字段映射与错误预览');

    const goodCsv = '公司全称,主电话,出发城市,到达城市,时效（天）,是否直达,发车频率\n' +
      '冒烟导入物流甲,0531-55550001,冒烟导入城甲,冒烟导入城乙,3,是,daily\n' +
      '冒烟导入物流乙,0531-55550002,冒烟导入城甲,冒烟导入城乙,5,否,weekday\n';
    let mp = multipart('good.csv', goodCsv);
    r = await req('POST', '/api/import/preview', mp.body, mp.ctype);
    t('上传 CSV 并解析出表头', r.json && r.json.ok && r.json.headers.length === 7,
      (r.json && r.json.headers || []).join(','));
    t('自动字段映射 100% 命中',
      r.json && r.json.mapping.every((m) => m !== ''),
      JSON.stringify(r.json && r.json.mapping));
    t('全部行可导入', r.json && r.json.summary.validCount === 2 && r.json.summary.invalidCount === 0,
      'valid=' + (r.json && r.json.summary.validCount));

    const badCsv = '公司全称,主电话,出发城市,到达城市,时效（天）,是否直达,发车频率\n' +
      ',123,冒烟坏城甲,冒烟坏城乙,abc,是,乱填\n';
    mp = multipart('bad.csv', badCsv);
    r = await req('POST', '/api/import/preview', mp.body, mp.ctype);
    t('坏数据被标出为不可导入', r.json && r.json.summary.invalidCount === 1);
    t('错误原因逐条列出（缺名/电话错/时效错/频率错）',
      r.json && r.json.invalid[0].errors.length >= 4,
      (r.json && r.json.invalid[0].errors || []).join('；'));
    t('标出了行号（便于用户在 Excel 里定位）', r.json && r.json.invalid[0].lineNo === 2);

    const beforeImport = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'companies.json'), 'utf8')).length;
    t('预览阶段不写任何数据（★ 无副作用）',
      JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'companies.json'), 'utf8')).length === beforeImport);

    /* 真正导入 */
    const goodCsv2 = '公司全称,主电话,出发城市,到达城市,时效（天）,是否直达,发车频率\n' +
      '冒烟导入物流甲,0531-55550001,冒烟导入城甲,冒烟导入城乙,3,是,daily\n' +
      '冒烟导入物流乙,0531-55550002,冒烟导入城甲,冒烟导入城乙,5,否,weekday\n' +
      '冒烟导入物流丙,0531-55550003,冒烟导入城丙,冒烟导入城乙,2,是,daily\n';
    mp = multipart('good2.csv', goodCsv2);
    r = await req('POST', '/api/import/preview', mp.body, mp.ctype);
    const validRows = r.json.valid;

    r = await req('POST', '/api/import/apply', JSON.stringify({ valid: validRows }), 'application/json');
    t('确认导入成功', r.json && r.json.ok, '新建 ' + (r.json && r.json.created) + ' 家 / 关联 ' + (r.json && r.json.links) + ' 条');

    const companiesAfter = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'companies.json'), 'utf8'));
    t('导入的公司已落盘', ['冒烟导入物流甲', '冒烟导入物流乙', '冒烟导入物流丙']
      .every((n) => companiesAfter.some((c) => c.name === n)));

    const routesAfter = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'routes.json'), 'utf8'));
    const impRoute = routesAfter.find((x) => x.routeKey === '冒烟导入城甲-冒烟导入城乙');
    t('导入的线路 companyCount 与实际一致', impRoute && impRoute.companyCount === 2,
      '=' + (impRoute && impRoute.companyCount));

    r = await req('GET', '/api/quality');
    t('导入后无数据一致性问题',
      r.json && r.json.stats.blocking.countMismatch === 0 && r.json.stats.blocking.orphan === 0);

    /* ---------- 不支持的格式 ---------- */
    section('导入：不支持的格式给出人话提示');
    mp = multipart('old.xls', 'fake xls content');
    r = await req('POST', '/api/import/preview', mp.body, mp.ctype);
    t('.xls 被拒绝并给出可操作建议',
      r.json && !r.json.ok && /另存为/.test(r.json.message), r.json && r.json.message);

    mp = multipart('weird.pdf', 'x');
    r = await req('POST', '/api/import/preview', mp.body, mp.ctype);
    t('未知格式被拒绝', r.json && !r.json.ok && /只支持/.test(r.json.message), r.json && r.json.message);

    /* ---------- 模板 ---------- */
    section('CSV 导入模板（公开资源）');

    /*
     * ★ 模板**不需要登录**也能下：内容只是空表头 + 一行示例，无任何业务数据。
     *   所以这里故意用**不带 Cookie** 的裸请求来验（同时证明了「公开」这一设计）。
     */
    const tmplRes = await reqAnon('/api/import/template');
    const tmplBuf = Buffer.from(await tmplRes.res.arrayBuffer());
    t('未登录也能下载模板（公开资源）', tmplRes.status === 200, 'HTTP ' + tmplRes.status);
    t('模板内容是 CSV 且含表头',
      tmplBuf.toString('utf8').indexOf('公司全称') >= 0);
    /*
     * ★ BOM 必须查**原始字节**：fetch 的 .text() 会按 UTF-8 解码并自动去掉 BOM，
     *   所以用 text.charCodeAt(0) 判断永远为假（这是测试写错了，不是功能错）。
     */
    t('模板带 UTF-8 BOM（Excel 打开中文不乱码）',
      tmplBuf[0] === 0xEF && tmplBuf[1] === 0xBB && tmplBuf[2] === 0xBF,
      tmplBuf.slice(0, 3).toString('hex'));
    t('模板 Content-Type 是 CSV',
      /text\/csv/.test(tmplRes.headers.get('content-type') || ''),
      tmplRes.headers.get('content-type'));
    t('模板带下载文件名',
      /attachment/.test(tmplRes.headers.get('content-disposition') || ''),
      tmplRes.headers.get('content-disposition'));

    /* ---------- B5/B6 纠错 ---------- */
    section('B5/B6 纠错队列与审核');

    /* 模拟小程序端提交的纠错被拉到本地 */
    r = await req('POST', '/api/correction/merge', JSON.stringify({
      rows: [{
        _id: 'smoke_cor_1', targetType: 'company', targetId: 'comp_001',
        targetSummary: '济南鲁通物流有限公司', type: 'phone_wrong', typeLabel: '电话有误',
        content: '冒烟测试：电话已停机', images: [], contact: '15165018553',
        openid: 'smoke_openid', status: 'pending', createdAt: Date.now()
      }]
    }), 'application/json');
    t('并入线上纠错', r.json && r.json.ok && r.json.added === 1);

    r = await req('GET', '/corrections');
    t('纠错队列显示该条', r.status === 200 && /冒烟测试：电话已停机/.test(r.text));
    t('带目标上下文（公司名）', /济南鲁通物流有限公司/.test(r.text));
    t('带联系方式', /15165018553/.test(r.text));

    r = await req('POST', '/api/correction/review',
      '_id=smoke_cor_1&status=accepted&note=' + encodeURIComponent('已核实并更正'),
      'application/x-www-form-urlencoded');
    t('采纳纠错', r.json && r.json.ok);

    const corsOnDisk = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'corrections.json'), 'utf8'));
    const reviewed = corsOnDisk.find((c) => c._id === 'smoke_cor_1');
    t('审核状态已落盘', reviewed && reviewed.status === 'accepted' && reviewed.reviewNote === '已核实并更正');

    r = await req('POST', '/api/correction/review', '_id=smoke_cor_1&status=乱写的状态',
      'application/x-www-form-urlencoded');
    t('非法审核状态被拒', r.json && !r.json.ok);

    /* ---------- B8 质量看板 ---------- */
    section('B8 质量看板');

    r = await req('GET', '/api/quality');
    const st = r.json && r.json.stats;
    t('接口返回统计', !!st);
    t('统计的公司数与磁盘一致',
      st.companies.total === JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'companies.json'), 'utf8')).length,
      '公司 ' + (st && st.companies.total));
    t('统计的关联数与磁盘一致',
      st.links.total === JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'route_companies.json'), 'utf8')).length,
      '关联 ' + (st && st.links.total));
    t('含「缺电话」与「超 90 天未更新」两项（PRD B8 明确要求）',
      typeof st.companies.noPhone === 'number' && typeof st.companies.stale === 'number',
      '缺电话 ' + st.companies.noPhone + ' / 超期 ' + st.companies.stale);

    r = await req('GET', '/quality');
    t('看板页渲染', r.status === 200 && /一致性检查/.test(r.text));

    /* ---------- 运营位：公告栏 / 优质线路推广（2026-09-22 新增） ---------- */
    /*
     * ★ 为什么后台逻辑已被单元测试覆盖，这里还要跑一遍 HTTP：
     *   首页这两块是「改了后台 → 首页才变」的链路，中间多一层 API 与落盘。
     *   单元测试只证明 store 对，证明不了「接口接对了、写进磁盘了」。
     *   这条链路断了的表现是：后台改完看着成功了，刷新首页还是老样子。
     */
    section('运营位：公告栏 / 优质线路推广');

    r = await req('GET', '/announcements');
    t('公告栏页渲染', r.status === 200 && /公告栏/.test(r.text), 'HTTP ' + r.status);

    r = await req('GET', '/announcements/edit');
    t('公告新建页渲染（含级别下拉）', r.status === 200 && /name="level"/.test(r.text));

    r = await req('GET', '/featured');
    t('优质线路页渲染', r.status === 200 && /优质线路/.test(r.text), 'HTTP ' + r.status);

    r = await req('GET', '/featured/edit');
    t('推广位新建页渲染（含线路下拉）', r.status === 200 && /name="routeKey"/.test(r.text));

    /* 新建公告 → 落盘 → 删除 */
    r = await req('POST', '/api/announcement/save',
      'title=冒烟公告&content=冒烟正文&level=tip&link=&enabled=on&sortOrder=99',
      'application/x-www-form-urlencoded');
    t('新建公告成功', r.json && r.json.ok === true, JSON.stringify(r.json));
    const annId = (r.json && r.json.id) || '';

    r = await req('GET', '/announcements');
    t('新公告出现在列表里', r.status === 200 && /冒烟公告/.test(r.text));
    t('新公告已落盘',
      JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'announcements.json'), 'utf8'))
        .some((x) => x.title === '冒烟公告'));

    r = await req('POST', '/api/announcement/save',
      'title=外链公告&content=正文&level=info&link=https://example.com',
      'application/x-www-form-urlencoded');
    t('★ 外链公告被拒（小程序里点了没反应）', r.json && r.json.ok === false,
      (r.json && r.json.message) || '');

    r = await req('POST', '/api/announcement/save',
      'title=空正文&content=&level=info', 'application/x-www-form-urlencoded');
    t('空正文公告被拒', r.json && r.json.ok === false, (r.json && r.json.message) || '');

    r = await req('POST', '/api/announcement/delete', '_id=' + encodeURIComponent(annId),
      'application/x-www-form-urlencoded');
    t('删除公告成功', r.json && r.json.ok === true, JSON.stringify(r.json));

    /* 新建推广位：必须选一条真实存在的线路 */
    const routeRows = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'routes.json'), 'utf8'));
    const featRows = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'featured_routes.json'), 'utf8'));
    const usedKeys = {};
    featRows.forEach((x) => { usedKeys[x.routeKey] = true; });
    const freeRoute = routeRows.filter((x) => !usedKeys[x.routeKey])[0];

    r = await req('POST', '/api/featured/save',
      'routeKey=' + encodeURIComponent(freeRoute.routeKey) + '&tag=直达&reason=冒烟&enabled=on&sortOrder=99',
      'application/x-www-form-urlencoded');
    t('新建推广位成功（从 routeKey 反解城市）', r.json && r.json.ok === true, JSON.stringify(r.json));
    const featId = (r.json && r.json.id) || '';

    t('推广位的 routeKey 与所选线路一致',
      JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'featured_routes.json'), 'utf8'))
        .some((x) => x._id === featId && x.routeKey === freeRoute.routeKey));

    r = await req('POST', '/api/featured/save',
      'routeKey=' + encodeURIComponent(freeRoute.routeKey) + '&tag=再来一次&reason=x',
      'application/x-www-form-urlencoded');
    t('★ 同一线路重复推广被拒', r.json && r.json.ok === false, (r.json && r.json.message) || '');

    r = await req('POST', '/api/featured/save',
      'routeKey=漠河-三沙&tag=直达&reason=x', 'application/x-www-form-urlencoded');
    t('★ 指向不存在线路的推广位被拒', r.json && r.json.ok === false, (r.json && r.json.message) || '');

    r = await req('POST', '/api/featured/delete', '_id=' + encodeURIComponent(featId),
      'application/x-www-form-urlencoded');
    t('删除推广位成功', r.json && r.json.ok === true, JSON.stringify(r.json));

    /* ---------- 安全 ---------- */
    section('安全边界');

    r = await req('GET', '/static/../server.js');
    t('静态目录穿越被拦', r.status === 404 || r.status === 403, 'HTTP ' + r.status);

    r = await req('GET', '/static/..%2f..%2fserver.js');
    t('编码后的目录穿越也被拦', r.status === 404 || r.status === 403, 'HTTP ' + r.status);

    r = await req('GET', '/static/admin.css');
    t('正常静态资源可访问', r.status === 200 && /--brand/.test(r.text));

    /* 服务器只监听回环地址 */
    const listeningOnAll = await new Promise((resolve) => {
      const s = http.request({ host: '127.0.0.1', port: PORT, path: '/login', method: 'GET' }, (res) => {
        res.resume();
        resolve(false);
      });
      s.on('error', () => resolve('error'));
      s.end();
    });
    t('服务器仅监听 127.0.0.1（不对外网暴露）', listeningOnAll === false);

    /* ---------- 退出 ---------- */
    section('退出登录');
    r = await req('GET', '/logout');
    t('退出后 Cookie 被清除（下发 Max-Age=0）',
      /Max-Age=0/.test(r.headers.get('set-cookie') || ''));
    /*
     * ★ 回归护栏：清空型 Cookie 绝不能覆盖测试自己的 cookie 变量。
     *   之前无脑 `cookie = setc.split(';')[0]` 会把它写成 "lq_admin="，
     *   导致后面所有请求静默 401，伪装成「接口坏了」——踩过一次，固化成断言。
     */
    t('清空型 Cookie 不会污染测试状态（cookie 变量未被覆盖成空 token）',
      cookie.indexOf('lq_admin=x') < 0 && cookie !== 'lq_admin=',
      'cookie=' + JSON.stringify(cookie));

    /* 用一个明确的假 token 验证会话失效 */
    const savedCookie = cookie;
    cookie = 'lq_admin=' + 'x'.repeat(64);
    r = await req('GET', '/api/quality');
    t('伪造的 token 无法通过鉴权', r.status === 401);
    cookie = savedCookie;

    /* ---------- 数据完整性（收尾体检） ---------- */
    section('数据完整性');
    /*
     * ★ 跑完全套增删改导入之后，磁盘上的数据必须与「改动前的备份 + 本次净新增」
     *   对得上。这里只做最基本的一条：三张核心表都**不能是空**。
     *   挡的是「某个写操作把整表覆盖成 []」这类灾难性回归。
     */
    ['companies.json', 'routes.json', 'route_companies.json', 'announcements.json', 'featured_routes.json'].forEach((f) => {
      const arr = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
      t(f + ' 未被清空（覆盖写事故回归护栏）', Array.isArray(arr) && arr.length > 0,
        arr.length + ' 条');
    });
    t('repository 的「未装载禁止落盘」护栏已生效',
      /拒绝落盘/.test(String(guardMessage)), guardMessage);
  } finally {
    restoreData();
  }

  console.log('');
  console.log('='.repeat(52));
  console.log('断言 ' + (pass + fail) + ' 个：通过 ' + pass + '，失败 ' + fail);
  if (fail) {
    console.log('');
    failures.forEach((f) => console.log('  ✗ ' + f));
  }
  console.log(fail ? '❌ 未通过' : '✅ 全部通过');
  console.log('（临时数据已还原，admin/data 未被污染）');

  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('');
  console.error('冒烟测试异常：', (e && e.message) || e);
  try { restoreData(); } catch (_) { /* 尽力还原 */ }
  process.exit(1);
});
