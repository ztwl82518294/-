/**
 * admin/lib/views.js —— 服务端渲染（零依赖模板）
 *
 * ★ 为什么服务端渲染而不是 SPA：
 *   后台的全部工作是「看表、改表、审队列」，天然是文档流。SSR 让每一步都能
 *   刷新、能直接改 URL、能被浏览器前进后退正确处理，且不需要构建步骤。
 *   对一个只有一个人用的后台，这是成本最低且最不容易坏的形态。
 *
 * ★ 视觉：与小程序端共用同一套设计令牌（Notion 浅色主题四条铁律），
 *   但后台是「工具」场景，密度更高：更小的字号、更紧的行高、表格优先。
 *   四条铁律照旧：无渐变、无光斑、无半透明染色、无高光内阴影。
 */

/* ============================================================
 * HTML 转义（防 XSS：所有用户/数据库来源的文本都必须过这里）
 * ============================================================ */
function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 用于 HTML 属性里放 JSON（额外转义引号与斜杠） */
function escAttr(v) {
  return esc(JSON.stringify(v)).replace(/\\/g, '&#92;');
}

/* ============================================================
 * 格式化
 * ============================================================ */
const SCALE_LABELS = { large: '大', medium: '中', small: '小' };
const FREQ_LABELS = { daily: '天天发车', weekday: '工作日发车', weekly: '每周发车', irregular: '不定期' };
const CORRECTION_STATUS_LABELS = {
  pending: '待审核', accepted: '已采纳', rejected: '已驳回', hold: '待定'
};
const CORRECTION_TYPE_LABELS = {
  phone_wrong: '电话有误', company_closed: '公司已停业', route_gone: '线路已取消',
  incomplete: '信息不完整', other: '其他'
};

function fmtTime(ts) {
  const t = Number(ts);
  if (!t || !isFinite(t) || t <= 0) return '—';
  const d = new Date(t);
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
    ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function fmtDate(ts) {
  const t = Number(ts);
  if (!t || !isFinite(t) || t <= 0) return '—';
  const d = new Date(t);
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/** 相对天数（用于「超 90 天未更新」这类判断的展示） */
function daysAgo(ts) {
  const t = Number(ts);
  if (!t || !isFinite(t) || t <= 0) return null;
  return Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000));
}

/* ============================================================
 * 通用片段
 * ============================================================ */
function nav(active) {
  const items = [
    { href: '/', key: 'dashboard', text: '总览' },
    { href: '/companies', key: 'companies', text: '公司' },
    { href: '/routes', key: 'routes', text: '线路' },
    { href: '/links', key: 'links', text: '线路公司' },
    { href: '/corrections', key: 'corrections', text: '纠错审核' },
    { href: '/import', key: 'import', text: '批量导入' },
    { href: '/quality', key: 'quality', text: '数据质量' }
  ];
  return '<nav class="nav">' + items.map((i) =>
    '<a class="nav__item' + (i.key === active ? ' is-active' : '') + '" href="' + i.href + '">' + i.text + '</a>'
  ).join('') + '</nav>';
}

function pagination(base, page, pages, total, kw) {
  if (pages <= 1) return '';
  const q = kw ? '&q=' + encodeURIComponent(kw) : '';
  const link = (p, text, disabled) => {
    if (disabled) return '<span class="pg__item is-disabled">' + text + '</span>';
    return '<a class="pg__item" href="' + base + '?page=' + p + q + '">' + text + '</a>';
  };
  return '<div class="pg">' +
    link(page - 1, '上一页', page <= 1) +
    '<span class="pg__info">第 ' + page + ' / ' + pages + ' 页 · 共 ' + total + ' 条</span>' +
    link(page + 1, '下一页', page >= pages) +
    '</div>';
}

function emptyRow(cols, text) {
  return '<tr><td class="empty" colspan="' + cols + '">' + esc(text || '没有数据') + '</td></tr>';
}

function badges(errors) {
  if (!errors || !errors.length) return '';
  return '<div class="alert alert--error">' + errors.map((e) => esc(e.message || e)).join('<br>') + '</div>';
}

/* ============================================================
 * 页面
 * ============================================================ */
const PAGES = {};

/* ---------- 登录 ---------- */
PAGES.login = function (d) {
  return '<div class="login">' +
    '<form class="login__box" method="POST" action="/login">' +
    '<h1 class="login__title">物流专线查询 · 管理后台</h1>' +
    '<p class="login__sub">仅限管理员使用。本页面仅监听本机，不对外网开放。</p>' +
    (d.error ? '<div class="alert alert--error">' + esc(d.error) + '</div>' : '') +
    '<label class="field"><span class="field__label">账号</span>' +
    '<input class="input" name="username" autocomplete="username" autofocus></label>' +
    '<label class="field"><span class="field__label">密码</span>' +
    '<input class="input" type="password" name="password" autocomplete="current-password"></label>' +
    '<button class="btn btn--primary" type="submit">登录</button>' +
    '</form></div>';
};

/* ---------- 总览 ---------- */
PAGES.dashboard = function (d) {
  const s = d.stats;
  const c = d.recentCorrections;
  const card = (label, value, sub, href) => {
    const body = '<div class="stat__value">' + esc(value) + '</div>' +
      '<div class="stat__label">' + esc(label) + '</div>' +
      (sub ? '<div class="stat__sub">' + sub + '</div>' : '');
    return href
      ? '<a class="stat" href="' + href + '">' + body + '</a>'
      : '<div class="stat">' + body + '</div>';
  };

  const blocking = s.blocking;
  const blockTotal = blocking.countMismatch + blocking.orphan + blocking.emptyRoutes;

  return '<div class="page">' +
    '<h1 class="page__title">总览</h1>' +

    (blockTotal
      ? '<div class="alert alert--error"><strong>有 ' + blockTotal + ' 处数据一致性问题需要修复</strong>' +
        '（计数不一致 ' + blocking.countMismatch + ' · 悬空关联 ' + blocking.orphan +
        ' · 空线路 ' + blocking.emptyRoutes + '）。去 <a href="/quality">数据质量</a> 查看明细。</div>'
      : '<div class="alert alert--ok">数据一致性检查通过：计数一致、无悬空关联、无空线路。</div>') +

    '<div class="stats">' +
    card('公司', s.companies.total, s.companies.noPhone ? '缺电话 ' + s.companies.noPhone + ' 家' : '电话齐全', '/companies') +
    card('线路', s.routes.total, s.routes.empty ? '空线路 ' + s.routes.empty : '都有公司', '/routes') +
    card('线路公司关联', s.links.total, s.links.noTransit ? '缺时效 ' + s.links.noTransit + ' 条' : '时效齐全', '/links') +
    card('待审核纠错', s.corrections.pending, '共收到 ' + s.corrections.all + ' 条', '/corrections') +
    card('缺电话公司', s.companies.noPhone, s.companies.noPhonePct + '%', '/quality') +
    card('超 90 天未更新', s.companies.stale + s.links.stale, '公司 ' + s.companies.stale + ' · 关联 ' + s.links.stale, '/quality') +
    '</div>' +

    '<h2 class="sec__title">最近提交的纠错</h2>' +
    '<table class="tb"><thead><tr><th>提交时间</th><th>对象</th><th>类型</th><th>说明</th><th></th></tr></thead><tbody>' +
    (c.rows.length ? c.rows.map((x) =>
      '<tr>' +
      '<td class="nowrap">' + fmtTime(x.createdAt) + '</td>' +
      '<td>' + esc(x.targetSummary || x.targetId || '—') + '</td>' +
      '<td><span class="tag">' + esc(CORRECTION_TYPE_LABELS[x.type] || x.type || '—') + '</span></td>' +
      '<td class="clip">' + esc(x.content || '') + '</td>' +
      '<td><a class="link" href="/corrections">去审核</a></td>' +
      '</tr>'
    ).join('') : emptyRow(5, '暂无待审核纠错')) +
    '</tbody></table>' +

    '<h2 class="sec__title">数据文件</h2>' +
    '<p class="hint">后台读写 <code>admin/data/</code> 下的 JSON。小程序端读的是云数据库，' +
    '两者通过「批量导入」与「导出 JSONL」衔接。</p>' +
    '</div>';
};

/* ---------- 公司列表 ---------- */
PAGES.companies = function (d) {
  return '<div class="page">' +
    '<div class="page__head">' +
    '<h1 class="page__title">公司 <span class="count">' + d.total + '</span></h1>' +
    '<a class="btn btn--primary" href="/companies/edit">新建公司</a>' +
    '</div>' +

    '<form class="searchbar" method="GET" action="/companies">' +
    '<input class="input" name="q" value="' + esc(d.kw) + '" placeholder="搜索公司名 / 简称 / 拼音 / 首字母">' +
    '<button class="btn" type="submit">搜索</button>' +
    (d.kw ? '<a class="btn btn--ghost" href="/companies">清空</a>' : '') +
    '</form>' +

    '<table class="tb"><thead><tr>' +
    '<th>公司全称</th><th>简称</th><th>城市</th><th>电话</th><th>规模</th>' +
    '<th class="tc">线路</th><th class="tc">核实</th><th>更新时间</th><th class="tr">操作</th>' +
    '</tr></thead><tbody>' +
    (d.rows.length ? d.rows.map((c) => {
      const linkCount = d.linkCount ? d.linkCount[c._id] : undefined;
      return '<tr>' +
        '<td><a class="link" href="/companies/edit?id=' + encodeURIComponent(c._id) + '">' + esc(c.name) + '</a></td>' +
        '<td>' + esc(c.shortName || '—') + '</td>' +
        '<td class="nowrap">' + esc(c.city || '—') + '</td>' +
        '<td class="nowrap mono">' + (c.phone ? esc(c.phone) : '<span class="warn">缺</span>') + '</td>' +
        '<td>' + esc(SCALE_LABELS[c.scale] || c.scale || '—') + '</td>' +
        '<td class="tc">' + (linkCount === undefined ? '—' : linkCount) + '</td>' +
        '<td class="tc">' + (c.verified ? '<span class="tag tag--ok">是</span>' : '<span class="tag">否</span>') + '</td>' +
        '<td class="nowrap">' + fmtDate(c.updatedAt) + '</td>' +
        '<td class="tr nowrap">' +
        '<a class="link" href="/companies/edit?id=' + encodeURIComponent(c._id) + '">编辑</a>' +
        '<button class="link link--danger" data-del-company="' + esc(c._id) + '" data-del-name="' + esc(c.name) + '">删除</button>' +
        '</td>' +
        '</tr>';
    }).join('') : emptyRow(9, d.kw ? '没有匹配的公司' : '还没有公司数据')) +
    '</tbody></table>' +
    pagination('/companies', d.page, d.pages, d.total, d.kw) +
    '</div>';
};

/* ---------- 公司编辑 ---------- */
PAGES['company-edit'] = function (d) {
  const c = d.company || {
    _id: '', name: '', shortName: '', initial: '', pinyin: '', phone: '', backupPhone: '',
    address: '', city: '', province: '', scale: 'small', intro: '', verified: false,
    departureStations: [{ address: '', phone: '' }], arrivalStations: [{ address: '', phone: '' }]
  };
  const isNew = !d.company;

  const stationBlock = (prefix, title, list) => {
    const rows = (list && list.length ? list : [{ address: '', phone: '' }]).map((s, i) =>
      '<div class="station">' +
      '<input class="input" name="' + prefix + '_address_' + i + '" value="' + esc(s.address) + '" placeholder="地址">' +
      '<input class="input mono" name="' + prefix + '_phone_' + i + '" value="' + esc(s.phone) + '" placeholder="电话">' +
      '</div>'
    ).join('');
    return '<div class="fieldset"><div class="fieldset__title">' + title +
      '<span class="hint">地址与电话一一对应；一行一个网点，最多 10 个</span></div>' +
      rows + '</div>';
  };

  return '<div class="page">' +
    '<div class="page__head">' +
    '<h1 class="page__title">' + (isNew ? '新建公司' : '编辑公司') + '</h1>' +
    '<a class="btn btn--ghost" href="/companies">返回列表</a>' +
    '</div>' +

    '<div id="form-error"></div>' +

    '<form class="form" id="company-form" data-id="' + esc(c._id) + '">' +

    '<div class="fieldset"><div class="fieldset__title">基本信息</div>' +
    '<div class="grid grid--2">' +
    '<label class="field"><span class="field__label">公司全称 <b class="req">*</b></span>' +
    '<input class="input" name="name" value="' + esc(c.name) + '" required></label>' +
    '<label class="field"><span class="field__label">公司简称</span>' +
    '<input class="input" name="shortName" value="' + esc(c.shortName) + '"></label>' +
    '<label class="field"><span class="field__label">拼音全拼<span class="hint">搜索用，如 jinanlutong</span></span>' +
    '<input class="input" name="pinyin" value="' + esc(c.pinyin) + '"></label>' +
    '<label class="field"><span class="field__label">首字母<span class="hint">如 ltwl</span></span>' +
    '<input class="input" name="initial" value="' + esc(c.initial) + '"></label>' +
    '</div></div>' +

    '<div class="fieldset"><div class="fieldset__title">联系方式</div>' +
    '<div class="grid grid--2">' +
    '<label class="field"><span class="field__label">主电话 <b class="req">*</b></span>' +
    '<input class="input mono" name="phone" value="' + esc(c.phone) + '" required></label>' +
    '<label class="field"><span class="field__label">备用电话</span>' +
    '<input class="input mono" name="backupPhone" value="' + esc(c.backupPhone) + '"></label>' +
    '</div></div>' +

    '<div class="fieldset"><div class="fieldset__title">位置与规模</div>' +
    '<div class="grid grid--2">' +
    '<label class="field"><span class="field__label">所在城市 <b class="req">*</b></span>' +
    '<input class="input" name="city" value="' + esc(c.city) + '" required></label>' +
    '<label class="field"><span class="field__label">所在省份</span>' +
    '<input class="input" name="province" value="' + esc(c.province) + '"></label>' +
    '</div>' +
    '<label class="field"><span class="field__label">公司地址</span>' +
    '<input class="input" name="address" value="' + esc(c.address) + '"></label>' +
    '<div class="grid grid--2">' +
    '<label class="field"><span class="field__label">规模</span>' +
    '<select class="input" name="scale">' +
    ['large', 'medium', 'small'].map((v) =>
      '<option value="' + v + '"' + (c.scale === v ? ' selected' : '') + '>' +
      ({ large: '大（自有车队/多网点）', medium: '中', small: '小（个体/小型）' }[v]) + '</option>'
    ).join('') + '</select></label>' +
    '<label class="field field--check"><span class="field__label">是否已核实</span>' +
    '<label class="check"><input type="checkbox" name="verified"' + (c.verified ? ' checked' : '') +
    '> 已电话/实地核实过</label></label>' +
    '</div>' +
    '<label class="field"><span class="field__label">公司简介</span>' +
    '<textarea class="input" name="intro" rows="3">' + esc(c.intro) + '</textarea></label>' +
    '</div>' +

    stationBlock('departure', '发站（提货点）', c.departureStations) +
    stationBlock('arrival', '到站（送货点）', c.arrivalStations) +

    '<div class="actions">' +
    '<button class="btn btn--primary" type="submit">保存</button>' +
    '<a class="btn btn--ghost" href="/companies">取消</a>' +
    (isNew ? '' : '<button class="btn btn--danger" type="button" id="btn-delete">删除这家公司</button>') +
    '</div>' +
    '</form>' +
    '</div>';
};

/* ---------- 线路列表 ---------- */
PAGES.routes = function (d) {
  return '<div class="page">' +
    '<div class="page__head">' +
    '<h1 class="page__title">线路 <span class="count">' + d.total + '</span></h1>' +
    '<a class="btn btn--primary" href="/routes/edit">新建线路</a>' +
    '</div>' +

    '<form class="searchbar" method="GET" action="/routes">' +
    '<input class="input" name="q" value="' + esc(d.kw) + '" placeholder="搜索线路，如 济南 或 济南-广州">' +
    '<button class="btn" type="submit">搜索</button>' +
    (d.kw ? '<a class="btn btn--ghost" href="/routes">清空</a>' : '') +
    '</form>' +

    '<table class="tb"><thead><tr>' +
    '<th>线路</th><th>出发省</th><th>到达省</th><th>routeKey</th>' +
    '<th class="tc">公司数</th><th>更新时间</th><th class="tr">操作</th>' +
    '</tr></thead><tbody>' +
    (d.rows.length ? d.rows.map((r) =>
      '<tr>' +
      '<td><a class="link" href="/routes/edit?id=' + encodeURIComponent(r._id) + '">' + esc(r.routeKey) + '</a></td>' +
      '<td>' + esc(r.fromProvince || '—') + '</td>' +
      '<td>' + esc(r.toProvince || '—') + '</td>' +
      '<td class="mono dim">' + esc(r.routeKey) + '</td>' +
      '<td class="tc">' + (r.companyCount || 0) +
      ((r.companyCount || 0) === 0 ? ' <span class="tag tag--warn">空</span>' : '') + '</td>' +
      '<td class="nowrap">' + fmtDate(r.updatedAt) + '</td>' +
      '<td class="tr nowrap">' +
      '<a class="link" href="/routes/edit?id=' + encodeURIComponent(r._id) + '">编辑</a>' +
      '<a class="link" href="/links?q=' + encodeURIComponent(r.routeKey) + '">公司</a>' +
      '<button class="link link--danger" data-del-route="' + esc(r._id) + '" data-del-name="' + esc(r.routeKey) + '">删除</button>' +
      '</td>' +
      '</tr>'
    ).join('') : emptyRow(7, d.kw ? '没有匹配的线路' : '还没有线路数据')) +
    '</tbody></table>' +
    pagination('/routes', d.page, d.pages, d.total, d.kw) +
    '</div>';
};

/* ---------- 线路编辑 ---------- */
PAGES['route-edit'] = function (d) {
  const r = d.route || { _id: '', fromCity: '', fromProvince: '', toCity: '', toProvince: '' };
  const isNew = !d.route;
  return '<div class="page">' +
    '<div class="page__head">' +
    '<h1 class="page__title">' + (isNew ? '新建线路' : '编辑线路') + '</h1>' +
    '<a class="btn btn--ghost" href="/routes">返回列表</a>' +
    '</div>' +

    '<div id="form-error"></div>' +

    '<form class="form" id="route-form" data-id="' + esc(r._id) + '">' +
    '<div class="fieldset"><div class="fieldset__title">城市' +
    '<span class="hint">不必带「市/省」后缀，系统会归一（济南市 = 济南）</span></div>' +
    '<div class="grid grid--2">' +
    '<label class="field"><span class="field__label">出发城市 <b class="req">*</b></span>' +
    '<input class="input" name="fromCity" value="' + esc(r.fromCity) + '" required></label>' +
    '<label class="field"><span class="field__label">出发省份</span>' +
    '<input class="input" name="fromProvince" value="' + esc(r.fromProvince) + '"></label>' +
    '<label class="field"><span class="field__label">到达城市 <b class="req">*</b></span>' +
    '<input class="input" name="toCity" value="' + esc(r.toCity) + '" required></label>' +
    '<label class="field"><span class="field__label">到达省份</span>' +
    '<input class="input" name="toProvince" value="' + esc(r.toProvince) + '"></label>' +
    '</div>' +
    (isNew ? '' : '<p class="hint">当前 routeKey：<code>' + esc(r.routeKey) + '</code>，' +
      '冗余计数：<code>' + (r.companyCount || 0) + '</code> 家' +
      '（计数会在增删关联时自动重算，无需手改）</p>') +
    '</div>' +

    '<div class="actions">' +
    '<button class="btn btn--primary" type="submit">保存</button>' +
    '<a class="btn btn--ghost" href="/routes">取消</a>' +
    (isNew ? '' : '<a class="btn btn--ghost" href="/links">管理这条线路的公司</a>') +
    (isNew ? '' : '<button class="btn btn--danger" type="button" id="btn-delete">删除这条线路</button>') +
    '</div>' +
    '</form>' +
    '</div>';
};

/* ---------- 线路公司（关联）列表 ---------- */
PAGES.links = function (d) {
  return '<div class="page">' +
    '<div class="page__head">' +
    '<h1 class="page__title">线路公司 <span class="count">' + d.total + '</span></h1>' +
    '</div>' +
    '<p class="hint">时效、是否直达、发车频率等属性挂在**关联**上，' +
    '而不是公司或线路上 —— 同一家公司跑不同线路时效本就不同。</p>' +

    '<form class="searchbar" method="GET" action="/links">' +
    '<input class="input" name="q" value="' + esc(d.kw) + '" placeholder="搜索公司名 / 线路 / 价格备注">' +
    '<button class="btn" type="submit">搜索</button>' +
    (d.kw ? '<a class="btn btn--ghost" href="/links">清空</a>' : '') +
    '</form>' +

    '<table class="tb"><thead><tr>' +
    '<th>公司</th><th>线路</th><th class="tc">时效</th><th class="tc">直达</th>' +
    '<th>频率</th><th>价格备注</th><th>更新时间</th><th class="tr">操作</th>' +
    '</tr></thead><tbody>' +
    (d.rows.length ? d.rows.map((x) => {
      const l = x.link;
      const days = Number(l.transitDays);
      const hasDays = isFinite(days) && days > 0;
      return '<tr>' +
        '<td>' + (x.company
          ? '<a class="link" href="/companies/edit?id=' + encodeURIComponent(x.company._id) + '">' +
            esc(x.company.shortName || x.company.name) + '</a>'
          : '<span class="warn">公司已删除</span>') + '</td>' +
        '<td class="nowrap">' + esc(l.routeKey || (x.route ? x.route.routeKey : '—')) + '</td>' +
        '<td class="tc">' + (hasDays ? days + ' 天' : '<span class="warn">缺</span>') + '</td>' +
        '<td class="tc">' + (l.isDirect ? '<span class="tag tag--ok">直达</span>' : '<span class="tag">中转</span>') + '</td>' +
        '<td class="nowrap">' + esc(FREQ_LABELS[l.frequency] || l.frequency || '—') + '</td>' +
        '<td class="clip dim">' + esc(l.priceNote || '—') + '</td>' +
        '<td class="nowrap">' + fmtDate(l.updatedAt) + '</td>' +
        '<td class="tr nowrap">' +
        '<a class="link" href="/links/edit?id=' + encodeURIComponent(l._id) + '">编辑</a>' +
        '<button class="link link--danger" data-del-link="' + esc(l._id) + '">删除</button>' +
        '</td>' +
        '</tr>';
    }).join('') : emptyRow(8, d.kw ? '没有匹配的记录' : '还没有关联数据')) +
    '</tbody></table>' +
    pagination('/links', d.page, d.pages, d.total, d.kw) +
    '</div>';
};

/* ---------- 关联编辑 ---------- */
PAGES['link-edit'] = function (d) {
  const l = d.link || {
    _id: '', routeId: '', companyId: '', transitDays: '', isDirect: false,
    frequency: 'daily', priceNote: '', remark: ''
  };
  const isNew = !d.link;

  const opt = (list, sel, withTaken) => list.map((x) =>
    '<option value="' + esc(x.id) + '"' + (x.id === sel ? ' selected' : '') + '>' +
    esc(x.label) + (withTaken && x.taken ? '（已挂）' : '') + '</option>'
  ).join('');

  return '<div class="page">' +
    '<div class="page__head">' +
    '<h1 class="page__title">' + (isNew ? '挂载公司到线路' : '编辑关联') + '</h1>' +
    '<a class="btn btn--ghost" href="/links">返回列表</a>' +
    '</div>' +

    '<div id="form-error"></div>' +

    '<form class="form" id="link-form" data-id="' + esc(l._id) + '">' +
    '<div class="fieldset"><div class="fieldset__title">归属</div>' +
    '<div class="grid grid--2">' +
    '<label class="field"><span class="field__label">线路 <b class="req">*</b></span>' +
    '<select class="input" name="routeId" required>' +
    '<option value="">请选择线路…</option>' + opt(d.routes, l.routeId, false) +
    '</select></label>' +
    '<label class="field"><span class="field__label">公司 <b class="req">*</b></span>' +
    '<select class="input" name="companyId" required>' +
    '<option value="">请选择公司…</option>' + opt(d.companies, l.companyId, false) +
    '</select></label>' +
    '</div></div>' +

    '<div class="fieldset"><div class="fieldset__title">线路属性' +
    '<span class="hint">这些属性属于「公司 × 线路」，不是公司属性</span></div>' +
    '<div class="grid grid--3">' +
    '<label class="field"><span class="field__label">时效（天）<span class="hint">留空=未知</span></span>' +
    '<input class="input" type="number" name="transitDays" min="0" max="60" step="1" value="' +
    esc(l.transitDays === null || l.transitDays === undefined ? '' : l.transitDays) + '"></label>' +
    '<label class="field"><span class="field__label">发车频率 <b class="req">*</b></span>' +
    '<select class="input" name="frequency" required>' +
    d.frequencies.map((f) =>
      '<option value="' + esc(f.value) + '"' + (l.frequency === f.value ? ' selected' : '') + '>' +
      esc(f.label) + '</option>').join('') +
    '</select></label>' +
    '<label class="field field--check"><span class="field__label">是否直达</span>' +
    '<label class="check"><input type="checkbox" name="isDirect"' + (l.isDirect ? ' checked' : '') +
    '> 直达不中转</label></label>' +
    '</div>' +
    '<label class="field"><span class="field__label">价格备注</span>' +
    '<input class="input" name="priceNote" value="' + esc(l.priceNote) + '" placeholder="如 重货 480 元/吨起"></label>' +
    '<label class="field"><span class="field__label">备注</span>' +
    '<input class="input" name="remark" value="' + esc(l.remark) + '" placeholder="如 天天发车，下午 6 点前装车"></label>' +
    '</div>' +

    '<div class="actions">' +
    '<button class="btn btn--primary" type="submit">保存</button>' +
    '<a class="btn btn--ghost" href="/links">取消</a>' +
    (isNew ? '' : '<button class="btn btn--danger" type="button" id="btn-delete">删除这条关联</button>') +
    '</div>' +
    '</form>' +
    '</div>';
};

/* ---------- 纠错审核 ---------- */
PAGES.corrections = function (d) {
  const counts = d.counts || {};
  const tab = (key, label) => {
    const n = counts[key];
    return '<a class="tab' + (d.status === key ? ' is-active' : '') + '" href="/corrections?status=' + key + '">' +
      label + (n !== undefined ? ' <span class="tab__n">' + n + '</span>' : '') + '</a>';
  };

  return '<div class="page">' +
    '<h1 class="page__title">纠错审核 <span class="count">' + d.total + '</span></h1>' +

    '<div class="tabs">' +
    tab('pending', '待审核') + tab('hold', '待定') +
    tab('accepted', '已采纳') + tab('rejected', '已驳回') + tab('all', '全部') +
    '</div>' +

    '<p class="hint">采纳表示「这条反馈有效，已人工修正数据」。' +
    '因为用户描述通常是自然语言（「电话打不通」），无法据此推断正确号码，' +
    '所以系统不自动改数据 —— 请在采纳后到对应记录里修正，并在备注里写清改了什么。</p>' +

    (d.rows.length ? d.rows.map((c) =>
      '<div class="corr">' +
      '<div class="corr__head">' +
      '<span class="tag tag--' + (c.status === 'pending' ? 'warn' : c.status === 'accepted' ? 'ok' : '') + '">' +
      esc(CORRECTION_STATUS_LABELS[c.status] || c.status) + '</span>' +
      '<span class="corr__type">' + esc(CORRECTION_TYPE_LABELS[c.type] || c.type || '—') + '</span>' +
      '<span class="corr__time">' + fmtTime(c.createdAt) + '</span>' +
      '</div>' +

      '<div class="corr__target">' +
      '<span class="dim">' + (c.targetType === 'company' ? '公司' : c.targetType === 'route_company' ? '线路公司' : '其他') + '：</span>' +
      esc(c.targetSummary || '—') +
      (c.targetId
        ? ' <a class="link" href="' + (c.targetType === 'company'
            ? '/companies/edit?id=' + encodeURIComponent(c.targetId)
            : '/links?q=' + encodeURIComponent(c.targetSummary || '')) + '">查看记录</a>'
        : '') +
      '</div>' +

      '<div class="corr__content">' + esc(c.content || '') + '</div>' +

      (c.images && c.images.length
        ? '<div class="corr__images">凭证 ' + c.images.length + ' 张：' +
          c.images.map((i) => '<code>' + esc(String(i).slice(0, 40)) + '</code>').join(' ') + '</div>'
        : '') +

      (c.contact ? '<div class="corr__contact">联系方式：<span class="mono">' + esc(c.contact) + '</span></div>' : '') +

      (c.status === 'pending' || c.status === 'hold'
        ? '<form class="corr__actions" data-review="' + esc(c._id) + '">' +
          '<input class="input input--sm" name="note" placeholder="审核备注（改了什么，可留空）" value="' + esc(c.reviewNote || '') + '">' +
          '<button class="btn btn--sm btn--primary" data-status="accepted" type="submit">采纳</button>' +
          '<button class="btn btn--sm" data-status="hold" type="submit">待定</button>' +
          '<button class="btn btn--sm btn--danger" data-status="rejected" type="submit">驳回</button>' +
          '</form>'
        : '<div class="corr__reviewed">已' +
          esc(CORRECTION_STATUS_LABELS[c.status] || c.status) +
          (c.reviewedAt ? ' · ' + fmtTime(c.reviewedAt) : '') +
          (c.reviewNote ? ' · 备注：' + esc(c.reviewNote) : '') +
          '</div>') +
      '</div>'
    ).join('') : '<div class="empty-box">' + esc(
      d.status === 'pending' ? '没有待审核的纠错。' : '这个分类下没有记录。'
    ) + '</div>') +

    pagination('/corrections?status=' + encodeURIComponent(d.status), d.page, d.pages, d.total, '') +
    '</div>';
};

/* ---------- 批量导入 ---------- */
PAGES.import = function (d) {
  return '<div class="page">' +
    '<h1 class="page__title">批量导入</h1>' +
    '<p class="hint">支持 <b>.xlsx</b> 与 <b>.csv</b>。先上传预览，确认字段映射与错误行后再入库 —— ' +
    '错误行会被标出并跳过，不会污染数据。</p>' +

    '<div class="fieldset">' +
    '<div class="fieldset__title">第 1 步 · 选择文件</div>' +
    '<div class="row">' +
    '<input type="file" id="file" accept=".xlsx,.csv">' +
    '<button class="btn" id="btn-preview">解析并预览</button>' +
    '<a class="btn btn--ghost" href="/api/import/template">下载 CSV 模板</a>' +
    '</div>' +
    '<div id="import-msg"></div>' +
    '</div>' +

    '<div id="import-step2" class="hidden">' +
    '<div class="fieldset">' +
    '<div class="fieldset__title">第 2 步 · 字段映射' +
    '<span class="hint">左侧是文件表头，右侧选择对应字段；不需要的列选「忽略」</span></div>' +
    '<div id="mapping"></div>' +
    '<button class="btn" id="btn-revalidate">按当前映射重新校验</button>' +
    '</div>' +

    '<div class="fieldset">' +
    '<div class="fieldset__title">第 3 步 · 预览与确认</div>' +
    '<div id="summary"></div>' +
    '<div id="invalid-box"></div>' +
    '<div id="valid-box"></div>' +
    '<button class="btn btn--primary" id="btn-apply" disabled>确认导入</button>' +
    '</div>' +
    '</div>' +

    '<div class="fieldset">' +
    '<div class="fieldset__title">字段说明</div>' +
    '<table class="tb tb--sm"><thead><tr><th>字段</th><th>必填</th><th>说明</th></tr></thead><tbody>' +
    d.mapping.map((f) =>
      '<tr><td class="mono">' + esc(f.key) + '</td>' +
      '<td>' + (f.required ? '<b class="req">必填</b>' : '—') + '</td>' +
      '<td>' + esc(f.label) + (f.hint ? ' <span class="dim">' + esc(f.hint) + '</span>' : '') + '</td></tr>'
    ).join('') +
    '</tbody></table>' +
    '</div>' +
    '</div>';
};

/* ---------- 数据质量看板 ---------- */
PAGES.quality = function (d) {
  const s = d.stats;
  const bar = (n, total, label) => {
    const pct = total ? Math.round((n / total) * 100) : 0;
    return '<div class="qrow">' +
      '<div class="qrow__label">' + esc(label) + '</div>' +
      '<div class="qbar"><div class="qbar__fill" style="width:' + pct + '%"></div></div>' +
      '<div class="qrow__num">' + n + ' / ' + total + '（' + pct + '%）</div>' +
      '</div>';
  };

  const listBox = (title, items, render, emptyText) =>
    '<div class="fieldset"><div class="fieldset__title">' + title +
    ' <span class="hint">' + (items.length ? '前 50 条' : '') + '</span></div>' +
    (items.length
      ? '<table class="tb tb--sm"><tbody>' + items.slice(0, 50).map(render).join('') + '</tbody></table>'
      : '<p class="hint">' + esc(emptyText || '没有问题') + '</p>') +
    '</div>';

  const b = s.blocking;
  const blockTotal = b.countMismatch + b.orphan + b.emptyRoutes;

  return '<div class="page">' +
    '<h1 class="page__title">数据质量看板</h1>' +
    '<p class="hint">生成时间 ' + fmtTime(s.generatedAt) + '。' +
    '「一致性」三项属于程序性错误，必须为 0；「完整度」三项属于录入质量问题，按运营节奏补齐。</p>' +

    (blockTotal
      ? '<div class="alert alert--error"><strong>一致性检查未通过</strong>：' +
        '计数不一致 ' + b.countMismatch + ' · 悬空关联 ' + b.orphan + ' · 空线路 ' + b.emptyRoutes +
        '。这些会让小程序端出现死链，请优先修复。</div>'
      : '<div class="alert alert--ok">一致性检查通过。</div>') +

    '<div class="fieldset"><div class="fieldset__title">公司完整度（共 ' + s.companies.total + ' 家）</div>' +
    bar(s.companies.noPhone, s.companies.total, '缺主电话（最影响转化）') +
    bar(s.companies.noStation, s.companies.total, '缺发站信息') +
    bar(s.companies.noAddress, s.companies.total, '缺公司地址') +
    bar(s.companies.noIntro, s.companies.total, '缺简介') +
    bar(s.companies.notVerified, s.companies.total, '未标记为已核实') +
    bar(s.companies.stale, s.companies.total, '超 90 天未更新') +
    '</div>' +

    '<div class="fieldset"><div class="fieldset__title">线路公司完整度（共 ' + s.links.total + ' 条）</div>' +
    bar(s.links.noTransit, s.links.total, '缺时效（会让「时效筛选」失效）') +
    bar(s.links.noPrice, s.links.total, '缺价格备注') +
    bar(s.links.stale, s.links.total, '超 90 天未更新') +
    '</div>' +

    listBox('缺主电话的公司', s.details.noPhone,
      (x) => '<tr><td><a class="link" href="/companies/edit?id=' + encodeURIComponent(x.id) + '">' +
        esc(x.name) + '</a></td><td class="tr"><a class="link" href="/companies/edit?id=' +
        encodeURIComponent(x.id) + '">去补</a></td></tr>',
      '所有公司都有主电话') +

    listBox('计数不一致的线路', s.details.countMismatch,
      (x) => '<tr><td>' + esc(x.routeKey) + '</td>' +
        '<td class="dim">标记 ' + x.declared + ' · 实际 ' + x.actual + '</td>' +
        '<td class="tr"><button class="link" data-fix-count="' + esc(x.id) + '">重算</button></td></tr>',
      '所有线路的计数都与实际关联数一致') +

    listBox('悬空关联（指向已删除的公司或线路）', s.details.orphan,
      (x) => '<tr><td class="mono dim">' + esc(x.id) + '</td>' +
        '<td class="tr"><button class="link link--danger" data-del-link="' + esc(x.id) + '">删除</button></td></tr>',
      '没有悬空关联') +

    listBox('超 90 天未更新的公司', s.details.staleCompanies,
      (x) => '<tr><td><a class="link" href="/companies/edit?id=' + encodeURIComponent(x.id) + '">' +
        esc(x.name) + '</a></td><td class="dim">' + fmtDate(x.updatedAt) + '</td>' +
        '<td class="tr">' + (daysAgo(x.updatedAt) || 0) + ' 天前</td></tr>',
      '没有过期数据') +

    listBox('缺时效的线路公司', s.details.noTransit,
      (x) => '<tr><td>' + esc(x.routeKey) + '</td>' +
        '<td class="tr"><a class="link" href="/links?q=' + encodeURIComponent(x.routeKey) + '">去补</a></td></tr>',
      '所有关联都有时效') +
    '</div>';
};

/* ---------- 404 ---------- */
PAGES.notfound = function () {
  return '<div class="page"><h1 class="page__title">404</h1>' +
    '<p>没有这个页面。<a class="link" href="/">回到总览</a></p></div>';
};

/* ============================================================
 * 外壳
 * ============================================================ */
function shell(view, data) {
  const isLogin = view === 'login';
  const bodyClass = isLogin ? 'body--login' : '';

  return '<!DOCTYPE html>' +
    '<html lang="zh-CN"><head>' +
    '<meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex,nofollow">' +
    '<title>' + esc(viewTitle(view)) + ' · 物流专线查询后台</title>' +
    '<link rel="stylesheet" href="/static/admin.css">' +
    '</head><body class="' + bodyClass + '">' +
    (isLogin ? '' :
      '<header class="top">' +
      '<div class="top__brand">物流专线查询 · 管理后台</div>' +
      nav(view) +
      '<div class="top__right">' +
      '<span class="top__user">' + esc((data.user && data.user.username) || '') + '</span>' +
      '<a class="top__logout" href="/logout">退出</a>' +
      '</div>' +
      '</header>') +
    '<main class="main">' + PAGES[view](data) + '</main>' +
    (isLogin ? '' : '<script src="/static/admin.js"></script>') +
    '</body></html>';
}

const VIEW_TITLES = {
  dashboard: '总览', companies: '公司', 'company-edit': '编辑公司',
  routes: '线路', 'route-edit': '编辑线路', links: '线路公司', 'link-edit': '编辑关联',
  corrections: '纠错审核', import: '批量导入', quality: '数据质量',
  login: '登录', notfound: '未找到'
};

function viewTitle(view) {
  return VIEW_TITLES[view] || view;
}

function renderPage(view, data) {
  const fn = PAGES[view];
  if (!fn) return '<!DOCTYPE html><html><body><h1>未知页面：' + esc(view) + '</h1></body></html>';
  return shell(view, data || {});
}

module.exports = {
  renderPage, esc, escAttr, fmtTime, fmtDate, daysAgo,
  SCALE_LABELS, FREQ_LABELS, CORRECTION_STATUS_LABELS, CORRECTION_TYPE_LABELS
};
