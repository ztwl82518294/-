/**
 * 管理后台（PRD 模块 06）
 *
 * ★ 设计原则：**零依赖**，只用 Node 内置模块。
 *   理由：本项目全栈坚持零依赖（小程序端、云函数、脚本都是），后台如果引入
 *   express + better-sqlite3，就会带来 node_modules 与编译工具链，让「换台
 *   电脑就能把项目跑起来」这件事失效。用 http + fs 手写完全够用。
 *
 * ★ 数据归属：后台**不另建数据源**，直接读写 `admin/data/*.json`，
 *   而该目录由 `scripts/export-seed.js` 从 `data/seed-data.js` 生成，
 *   小程序端读的是云数据库。三者关系：
 *
 *     data/seed-data.js  ──导出──▶  admin/data/*.json  ──导入──▶  云数据库
 *              ▲                          ▲
 *              │                          │（后台读写这里）
 *         (唯一数据源)                (后台工作副本)
 *
 *   这么做的原因：后台的核心职责是「把数据弄进云数据库」，它天然在云端之前，
 *   所以它必须有一份本地可直接编辑的副本。而这份副本的初值来自唯一数据源，
 *   避免出现「样板数据两处不一致」。
 *
 * 分层（PRD 验收 B1~B8 都落在这三层里）：
 *   store.js      纯内存业务逻辑：增删改查、级联维护、质量统计（无 IO）
 *   db.js         只负责读写 JSON 文件（无业务判断）
 *   repository.js 写穿透：业务改动后落盘（把上面两层粘起来）
 *
 * 启动：node admin/server.js  → http://127.0.0.1:8787
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const store = require('./lib/store');
const repo = require('./lib/repository');
const auth = require('./lib/auth');
const importer = require('./lib/importer');
const schema = require('../shared/schema');
const { renderPage } = require('./lib/views');
const api = require('./lib/api');

const PORT = Number(process.env.ADMIN_PORT || 8787);
/** 只绑回环地址：后台不对外网暴露（PRD：唯一的写操作入口，必须关门） */
const HOST = '127.0.0.1';

const PUBLIC_DIR = path.join(__dirname, 'public');

/**
 * 启动前：确保数据文件存在（首次运行自动从 seed 生成）
 *
 * ★ 静默模式（ADMIN_SILENT=1）用于自动化测试：不打印 bootstrap / 启动横幅，
 *   避免污染测试输出。错误仍会打印。
 */
function bootstrap() {
  const quiet = process.env.ADMIN_SILENT === '1';
  const log = quiet ? () => {} : console.log;

  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const files = [store.FILE_COMPANIES, store.FILE_ROUTES, store.FILE_LINKS, store.FILE_CORRECTIONS];
  const missing = files.filter((f) => !fs.existsSync(path.join(dataDir, f)));
  if (!missing.length) return;

  log('[bootstrap] 缺少数据文件：' + missing.join(', ') + '，从 seed 生成…');
  try {
    const seed = require(path.join(__dirname, '..', 'data', 'seed-data.js'));
    const t = seed.buildTables();
    repo.bootstrapFrom(t);
    log('[bootstrap] 已生成 companies=' + t.companies.length +
      ' routes=' + t.routes.length + ' links=' + t.routeCompanies.length);
  } catch (e) {
    console.error('[bootstrap] 失败：' + e.message);
    console.error('  请先运行：node scripts/export-seed.js');
  }
}

/* ============================================================
 * 静态文件
 * ============================================================ */
const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function serveStatic(res, relPath) {
  // 防目录穿越：规范化后必须仍在 PUBLIC_DIR 内
  const safe = path.normalize(relPath).replace(/^([/\\])+/, '');
  const full = path.join(PUBLIC_DIR, safe);
  if (full.indexOf(PUBLIC_DIR) !== 0) {
    res.writeHead(403);
    res.end('403');
    return true;
  }
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return false;
  res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
  res.end(fs.readFileSync(full));
  return true;
}

/* ============================================================
 * 请求体读取
 * ============================================================ */
/**
 * 读取请求体
 *
 * ★ 同时保留两种形态：
 *   - raw（utf8 字符串）：给表单 / JSON 用
 *   - rawBinary（Buffer → latin1 字符串）：给 multipart 里的**文件**用
 *     因为 xlsx 是 zip（二进制），用 utf8 解码会把字节替换成 U+FFFD，
 *     文件就彻底坏了。用 latin1 能保证「一个字节 ↔ 一个字符」无损往返。
 */
function readBody(req, limitBytes) {
  const limit = limitBytes || 20 * 1024 * 1024; // 20MB：够 Excel 上传
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        req.destroy();
        resolve({ tooLarge: true, raw: '', rawBinary: '' });
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      resolve({
        tooLarge: false,
        raw: buf.toString('utf8'),
        rawBinary: buf.toString('latin1')
      });
    });
    req.on('error', () => resolve({ tooLarge: false, raw: '', rawBinary: '' }));
  });
}

/* ============================================================
 * 路由
 * ============================================================ */
async function handle(req, res) {
  const parsed = url.parse(req.url, true);
  const pathname = decodeURIComponent(parsed.pathname || '/');
  const query = parsed.query || {};

  /* ---------- 静态资源 ---------- */
  if (pathname.startsWith('/static/')) {
    if (serveStatic(res, pathname.slice('/static/'.length))) return;
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404');
    return;
  }

  /* ---------- 导入模板（无需鉴权） ----------
   * ★ 模板是**公开资源**：内容只是一个空表头 + 一行示例，不含任何业务数据，
   *   不含任何运营信息。放到鉴权之前有实际好处 —— 运营人员在还没登录、
   *   或者把链接发给同事时都能直接拿到模板，少一道无意义的墙。
   *   （注意：必须放在 `const sess = ...` 之前，否则未登录会被 401 拦掉）
   */
  if (pathname === '/api/import/template') {
    const csv = importer.templateCsv();
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="import-template.csv"',
      'Cache-Control': 'no-store'
    });
    res.end(csv);
    return;
  }

  /* ---------- 登录页（无需鉴权） ---------- */
  if (pathname === '/login') {
    if (req.method === 'POST') {
      const body = await readBody(req);
      const form = api.parseForm(body.raw);
      const result = auth.login(form.username, form.password);
      if (!result.ok) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderPage('login', { error: result.message }));
        return;
      }
      res.writeHead(302, {
        'Set-Cookie': auth.cookieFor(result.token),
        Location: '/'
      });
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderPage('login', { error: '' }));
    return;
  }

  if (pathname === '/logout') {
    res.writeHead(302, { 'Set-Cookie': auth.expiredCookie(), Location: '/login' });
    res.end();
    return;
  }

  /* ---------- 以下全部需要登录（B1：未登录访问被拦截） ---------- */
  const sess = auth.fromCookie(req.headers.cookie);
  if (!sess) {
    // API 请求返回 JSON，页面请求跳登录
    if (pathname.startsWith('/api/')) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, code: 'UNAUTHORIZED', message: '请先登录' }));
      return;
    }
    res.writeHead(302, { Location: '/login' });
    res.end();
    return;
  }

  /* ---------- API ---------- */
  if (pathname.startsWith('/api/')) {
    const body = req.method === 'POST' ? await readBody(req) : { raw: '' };
    const out = await api.route({
      pathname: pathname,
      method: req.method,
      query: query,
      raw: body.raw,
      rawBinary: body.rawBinary,
      tooLarge: body.tooLarge,
      headers: req.headers,
      user: sess
    });
    res.writeHead(out.status || 200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify(out.body));
    return;
  }

  /* ---------- 页面 ---------- */
  const page = PAGE_ROUTES[pathname];
  if (page) {
    const data = await page.data(query);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(renderPage(page.view, Object.assign({ user: sess }, data)));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(renderPage('notfound', {}));
}

/* ============================================================
 * 页面路由表
 * ============================================================ */
const PAGE_ROUTES = {
  '/': {
    view: 'dashboard',
    data: (q) => ({ stats: repo.qualityStats(), recentCorrections: repo.listCorrections({ status: 'pending' }, 1, 5) })
  },
  '/companies': {
    view: 'companies',
    data: (q) => {
      const p = Math.max(1, Number(q.page) || 1);
      const kw = String(q.q || '').trim();
      return Object.assign({ kw: kw }, repo.listCompanies(kw, p, 20));
    }
  },
  '/companies/edit': {
    view: 'company-edit',
    data: (q) => ({ company: q.id ? repo.getCompany(q.id) : null, id: q.id || '' })
  },
  '/routes': {
    view: 'routes',
    data: (q) => {
      const p = Math.max(1, Number(q.page) || 1);
      const kw = String(q.q || '').trim();
      return Object.assign({ kw: kw }, repo.listRoutes(kw, p, 20));
    }
  },
  '/routes/edit': {
    view: 'route-edit',
    data: (q) => ({ route: q.id ? repo.getRoute(q.id) : null, id: q.id || '' })
  },
  '/links': {
    view: 'links',
    data: (q) => {
      const p = Math.max(1, Number(q.page) || 1);
      const kw = String(q.q || '').trim();
      return Object.assign({ kw: kw }, repo.listLinks(kw, p, 20));
    }
  },
  '/links/edit': {
    view: 'link-edit',
    data: (q) => {
      const t = repo.tables();
      const editId = String(q.id || '');
      const link = editId ? repo.getLink(editId) : null;
      const companyId = String(q.companyId || (link ? link.companyId : ''));
      const routeId = String(q.routeId || (link ? link.routeId : ''));

      return {
        link: link,
        id: editId,
        routes: t.routes
          .map((r) => ({
            id: r._id,
            label: r.routeKey,
            // 新建时提示哪些线路该公司已挂过，避免重复挂载
            taken: !!companyId && t.route_companies.some(
              (l) => l.routeId === r._id && l.companyId === companyId && l._id !== editId
            )
          }))
          .sort((a, b) => a.label.localeCompare(b.label, 'zh')),
        companies: t.companies
          .map((c) => ({
            id: c._id,
            label: c.name,
            taken: !!routeId && t.route_companies.some(
              (l) => l.companyId === c._id && l.routeId === routeId && l._id !== editId
            )
          }))
          .sort((a, b) => a.label.localeCompare(b.label, 'zh')),
        frequencies: schema.FREQUENCY_OPTIONS
      };
    }
  },
  '/announcements': {
    view: 'announcements',
    data: () => ({ rows: repo.listAnnouncements() })
  },
  '/announcements/edit': {
    view: 'announcement-edit',
    data: (q) => ({
      announcement: q.id ? repo.getAnnouncement(q.id) : null,
      levels: schema.ANNOUNCEMENT_LEVELS
    })
  },
  '/featured': {
    view: 'featured',
    data: () => ({ rows: repo.listFeatured() })
  },
  '/featured/edit': {
    view: 'featured-edit',
    data: (q) => {
      const t = repo.tables();
      const used = {};
      t.featured_routes.forEach((x) => { used[x.routeKey] = true; });
      return {
        featured: q.id ? repo.getFeatured(q.id) : null,
        routes: t.routes
          .map((r) => ({
            routeKey: r.routeKey,
            label: r.routeKey + '（' + (r.companyCount || 0) + ' 家）',
            taken: !!used[r.routeKey]
          }))
          .sort((a, b) => a.routeKey.localeCompare(b.routeKey, 'zh'))
      };
    }
  },
  '/corrections': {
    view: 'corrections',
    data: (q) => {
      const p = Math.max(1, Number(q.page) || 1);
      const status = String(q.status || 'pending');
      return Object.assign({ status: status }, repo.listCorrections({ status: status }, p, 20));
    }
  },
  '/import': {
    view: 'import',
    data: () => ({ mapping: importer.FIELD_LABELS })
  },
  '/quality': {
    view: 'quality',
    data: () => ({ stats: repo.qualityStats() })
  }
};

/* ============================================================
 * 启动
 * ============================================================ */
function start() {
  bootstrap();
  /*
   * ★ 装载失败绝不能吞掉：未装载时内存是空表，任何写操作都会把
   *   运营数据覆盖成 `[]`（repository.flush 里另有护栏，这里是第二道防线）。
   *   所以这里让错误直接冒出去，进程起不来总比数据没了强。
   */
  repo.loadAll();
  auth.ensureDefaultAdmin();

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      console.error('[admin] 未捕获异常：', e);
      try {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, code: 'INTERNAL', message: '服务器内部错误' }));
      } catch (_) { /* 响应已发送，忽略 */ }
    });
  });

  server.listen(PORT, HOST, () => {
    if (process.env.ADMIN_SILENT === '1') return;
    console.log('');
    console.log('物流专线查询 · 管理后台');
    console.log('  http://' + HOST + ':' + PORT);
    console.log('  数据目录 admin/data/  ·  仅监听本机，不对外网开放');
    console.log('  默认账号 ' + auth.DEFAULT_USERNAME + ' / ' + auth.DEFAULT_PASSWORD + '（请尽快修改）');
    console.log('');
  });

  return server;
}

if (require.main === module) start();

module.exports = { start, handle, PAGE_ROUTES };
