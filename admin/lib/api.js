/**
 * admin/lib/api.js —— JSON 接口层
 *
 * ★ 只有一个入口 `route(ctx)`，返回 { status, body }。
 *   这样 server.js 不需要认识任何业务，只负责把结果序列化出去。
 *
 * 接口约定（与云函数 submitCorrection 保持统一的响应形态）：
 *   成功 → { ok:true, ...data }
 *   失败 → { ok:false, code:'XXX', message:'人能看懂的说明' }
 *
 * ★ 全部写操作都过 repository（写穿透），不会出现「改了内存没落盘」。
 */

const repo = require('./repository');
const store = require('./store');
const importer = require('./importer');
const schema = require('../../shared/schema');

/** 解析 application/x-www-form-urlencoded */
function parseForm(raw) {
  const out = {};
  String(raw || '').split('&').forEach((kv) => {
    if (!kv) return;
    const i = kv.indexOf('=');
    const k = decodeURIComponent((i < 0 ? kv : kv.slice(0, i)).replace(/\+/g, ' '));
    const v = i < 0 ? '' : decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' '));
    if (k) out[k] = v;
  });
  return out;
}

/** 解析 JSON 体 */
function parseJson(raw) {
  try {
    const v = JSON.parse(String(raw || '{}'));
    return v && typeof v === 'object' ? v : {};
  } catch (e) {
    return null;
  }
}

function ok(data) {
  return { status: 200, body: Object.assign({ ok: true }, data || {}) };
}

function fail(code, message, status) {
  return { status: status || 400, body: { ok: false, code: code, message: message } };
}

/** 把 store 返回的 errors 数组拼成一句话（表单页直接显示） */
function errText(errors) {
  return (errors || []).map((e) => e.message).join('；') || '保存失败';
}

/* ============================================================
 * 路由分发
 * ============================================================ */
async function route(ctx) {
  const p = ctx.pathname;
  const m = ctx.method;
  const q = ctx.query || {};
  const raw = ctx.raw || '';

  if (ctx.tooLarge) return fail('TOO_LARGE', '内容过大（上限 8MB）', 413);

  /* ---------- 公司 ---------- */
  if (p === '/api/company/save' && m === 'POST') {
    const form = parseForm(raw);
    const isNew = !form._id;
    const payload = {
      name: form.name,
      shortName: form.shortName,
      initial: form.initial,
      pinyin: form.pinyin,
      phone: form.phone,
      backupPhone: form.backupPhone,
      address: form.address,
      city: form.city,
      province: form.province,
      scale: form.scale,
      intro: form.intro,
      verified: form.verified,
      departureStations: parseStationsFromForm(form, 'departure'),
      arrivalStations: parseStationsFromForm(form, 'arrival')
    };
    const r = isNew ? repo.createCompany(payload) : repo.updateCompany(form._id, payload);
    if (!r.ok) return fail('VALIDATION', errText(r.errors));
    return ok({ id: r.company._id, created: isNew });
  }

  if (p === '/api/company/delete' && m === 'POST') {
    const form = parseForm(raw);
    if (!form._id) return fail('BAD_REQUEST', '缺少 id');
    const r = repo.deleteCompany(form._id);
    if (!r.ok) return fail('NOT_FOUND', r.message);
    return ok({ cascadedLinks: r.cascadedLinks });
  }

  /* ---------- 线路 ---------- */
  if (p === '/api/route/save' && m === 'POST') {
    const form = parseForm(raw);
    const isNew = !form._id;
    const payload = {
      fromCity: form.fromCity,
      fromProvince: form.fromProvince,
      toCity: form.toCity,
      toProvince: form.toProvince
    };
    const r = isNew ? repo.createRoute(payload) : repo.updateRoute(form._id, payload);
    if (!r.ok) return fail('VALIDATION', errText(r.errors));
    return ok({ id: r.route._id, created: isNew });
  }

  if (p === '/api/route/delete' && m === 'POST') {
    const form = parseForm(raw);
    const r = repo.deleteRoute(form._id);
    if (!r.ok) return fail('NOT_FOUND', r.message);
    return ok({ cascadedLinks: r.cascadedLinks });
  }

  /* ---------- 关联（线路公司） ---------- */
  if (p === '/api/link/save' && m === 'POST') {
    const form = parseForm(raw);
    const isNew = !form._id;
    const payload = {
      routeId: form.routeId,
      companyId: form.companyId,
      transitDays: form.transitDays === '' ? null : form.transitDays,
      isDirect: form.isDirect,
      frequency: form.frequency,
      priceNote: form.priceNote,
      remark: form.remark
    };
    const r = isNew ? repo.createLink(payload) : repo.updateLink(form._id, payload);
    if (!r.ok) return fail('VALIDATION', errText(r.errors));
    return ok({ id: r.link._id, created: isNew });
  }

  if (p === '/api/link/delete' && m === 'POST') {
    const form = parseForm(raw);
    const r = repo.deleteLink(form._id);
    if (!r.ok) return fail('NOT_FOUND', r.message);
    return ok({});
  }

  /* 某公司可挂的线路下拉（含已挂标记） */
  if (p === '/api/link/options' && m === 'GET') {
    const companyId = String(q.companyId || '');
    const routeId = String(q.routeId || '');
    const t = store.tables();
    const routes = t.routes.map((r) => ({
      id: r._id,
      label: r.routeKey,
      taken: t.route_companies.some((l) => l.routeId === r._id && l.companyId === companyId)
    })).sort((a, b) => a.label.localeCompare(b.label, 'zh'));
    const companies = t.companies.map((c) => ({
      id: c._id,
      label: c.name,
      taken: t.route_companies.some((l) => l.companyId === c._id && l.routeId === routeId)
    })).sort((a, b) => a.label.localeCompare(b.label, 'zh'));
    return ok({ routes: routes, companies: companies });
  }

  /* ---------- 纠错审核 ---------- */
  if (p === '/api/correction/review' && m === 'POST') {
    const form = parseForm(raw);
    const r = repo.reviewCorrection(form._id, form.status, form.note);
    if (!r.ok) return fail('VALIDATION', r.message);
    return ok({ status: r.correction.status });
  }

  if (p === '/api/correction/delete' && m === 'POST') {
    const form = parseForm(raw);
    const r = repo.deleteCorrection(form._id);
    if (!r.ok) return fail('NOT_FOUND', r.message);
    return ok({});
  }

  /* 把云数据库导出的纠错 JSON 并入本地队列（人工拉取线上反馈） */
  if (p === '/api/correction/merge' && m === 'POST') {
    const body = parseJson(raw);
    if (!body || !Array.isArray(body.rows)) return fail('BAD_REQUEST', '需要 { rows: [...] }');
    const r = repo.mergeCorrections(body.rows);
    return ok(r);
  }

  /* ---------- 导入 ---------- */
  if (p === '/api/import/preview' && m === 'POST') {
    /*
     * 前端用 multipart/form-data 上传。手写解析 multipart 只为取一个文件字段，
     * 这里只解析出第一个文件，够用且不引入依赖。
     */
    const parsed = parseMultipart(ctx.rawBinary || raw, ctx.headers && ctx.headers['content-type']);
    if (!parsed) return fail('BAD_REQUEST', '请上传文件（xlsx 或 csv）');

    // latin1 → Buffer，逐字节无损还原
    let buf;
    try {
      buf = Buffer.from(parsed.content, 'latin1');
    } catch (e) {
      return fail('BAD_REQUEST', '文件内容无法还原');
    }

    let table;
    try {
      table = importer.parse(buf, parsed.filename);
    } catch (e) {
      return fail('PARSE_FAILED', e.message);
    }
    if (!table.headers.length) return fail('EMPTY', '文件里没有可识别的表头');

    // 支持前端手工指定映射（重新校验时传回来）
    let mapping = importer.autoMap(table.headers);
    if (parsed.mapping) {
      try {
        const m = JSON.parse(parsed.mapping);
        if (Array.isArray(m) && m.length === table.headers.length) mapping = m;
      } catch (e) { /* 解析不了就用自动映射 */ }
    }

    const mapped = importer.mapRows(table.headers, table.rows, mapping);
    const check = store.validateImportRows(mapped);

    return ok({
      filename: parsed.filename,
      headers: table.headers,
      mapping: mapping,
      fields: importer.FIELD_LABELS,
      preview: check.valid.slice(0, 20).map((v) => ({ lineNo: v.lineNo, row: v.row })),
      invalid: check.invalid.slice(0, 100),
      summary: check.summary,
      /** 供确认导入时回传（前端不必重解析文件） */
      valid: check.valid
    });
  }

  if (p === '/api/import/apply' && m === 'POST') {
    const body = parseJson(raw);
    if (!body || !Array.isArray(body.valid)) return fail('BAD_REQUEST', '缺少待导入数据');
    if (body.valid.length > 5000) return fail('TOO_MANY', '单次导入上限 5000 行');
    const r = repo.applyImport(body.valid);
    return ok(r);
  }

  if (p === '/api/import/validate' && m === 'POST') {
    // 用户在映射界面手工调整了映射，重新校验
    const body = parseJson(raw);
    if (!body || !Array.isArray(body.headers) || !Array.isArray(body.rows)) {
      return fail('BAD_REQUEST', '需要 headers 与 rows');
    }
    const mapped = importer.mapRows(body.headers, body.rows, body.mapping);
    const check = store.validateImportRows(mapped);
    return ok({
      valid: check.valid,
      invalid: check.invalid.slice(0, 100),
      summary: check.summary
    });
  }

  /* ---------- 查表数据（表单下拉用） ---------- */
  if (p === '/api/meta' && m === 'GET') {
    return ok({
      scales: schema.SCALE_OPTIONS,
      frequencies: schema.FREQUENCY_OPTIONS,
      correctionTypes: schema.CORRECTION_TYPES,
      correctionStatus: schema.CORRECTION_STATUS_LABELS
    });
  }

  /* ---------- 质量看板（异步刷新用） ---------- */
  if (p === '/api/quality' && m === 'GET') {
    return ok({ stats: store.qualityStats() });
  }

  return fail('NOT_FOUND', '没有这个接口', 404);
}

/* ============================================================
 * 辅助
 * ============================================================ */

/** 从表单里取 departure/arrival 的发站数组（address/phone 成对出现） */
function parseStationsFromForm(form, prefix) {
  const out = [];
  for (let i = 0; i < 10; i++) {
    const a = form[prefix + '_address_' + i];
    const p = form[prefix + '_phone_' + i];
    if ((a && a.trim()) || (p && p.trim())) {
      out.push({ address: String(a || '').trim(), phone: String(p || '').trim() });
    }
  }
  // 兼容单字段形态：departure_address / departure_phone
  const sa = form[prefix + '_address'];
  const sp = form[prefix + '_phone'];
  if ((sa && sa.trim()) || (sp && sp.trim())) {
    out.push({ address: String(sa || '').trim(), phone: String(sp || '').trim() });
  }
  return out;
}

/**
 * 极简 multipart/form-data 解析
 *
 * ★ 为什么手写：为了零依赖。解析器只需处理浏览器上传「一个文件 + 几个普通字段」
 *   这一个场景：分隔串 --boundary，每段有头部与内容。
 *
 * ★ 输入必须是 latin1 无损字符串（ctx.rawBinary），不能用 utf8 ——
 *   xlsx 是二进制，utf8 解码会把非法字节变成 U+FFFD 导致文件损坏。
 *
 * @returns {{filename:string, content:string, mapping:string}|null}
 *          content 是 latin1 字符串，调用方用 Buffer.from(x, 'binary') 还原
 */
function parseMultipart(rawBinary, contentType) {
  const ct = String(contentType || '');
  const bm = ct.match(/boundary=([^;]+)/);
  if (!bm) return null;
  const boundary = '--' + bm[1].trim();
  const buf = Buffer.from(String(rawBinary || ''), 'latin1');
  const bBuf = Buffer.from(boundary);

  const out = { filename: '', content: '', mapping: '' };
  let pos = buf.indexOf(bBuf);
  if (pos < 0) return null;

  while (pos >= 0) {
    const headStart = pos + bBuf.length;
    const headEnd = buf.indexOf(Buffer.from('\r\n\r\n'), headStart);
    if (headEnd < 0) break;
    const headers = buf.slice(headStart, headEnd).toString('utf8');
    let next = buf.indexOf(bBuf, headEnd);

    let contentEnd = next < 0 ? buf.length : next;
    // 每段末尾有一个 \r\n，必须去掉，否则会在文件尾部多出两个字节
    if (contentEnd - 2 >= 0 && buf[contentEnd - 2] === 0x0D && buf[contentEnd - 1] === 0x0A) {
      contentEnd -= 2;
    }
    const chunk = buf.slice(headEnd + 4, contentEnd);

    const fnM = headers.match(/filename="([^"]*)"/);
    const nameM = headers.match(/name="([^"]*)"/);

    if (fnM && fnM[1]) {
      out.filename = fnM[1];
      out.content = chunk.toString('latin1');
    } else if (nameM && nameM[1] === 'mapping') {
      out.mapping = chunk.toString('utf8');
    }

    if (next < 0) break;
    pos = next;
  }

  return out.filename ? out : null;
}

module.exports = { route, parseForm, parseJson, parseMultipart, parseStationsFromForm };
