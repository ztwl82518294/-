/**
 * 小程序端后台的数据通道（PRD 模块 06 的小程序形态）
 *
 * ★★ 为什么必须走云函数，不能让页面直接读写数据库：
 *   1. 云数据库默认权限是「仅创建者可读写」，管理员根本读不到别人创建的数据；
 *   2. 项目硬规定：**小程序页面里不允许出现 .collection(**（静态断言守着）；
 *   3. 最重要的 —— 身份必须在服务端校验。若在前端判断「是不是管理员」，
 *      任何人改一下本地状态就能进后台。云函数 adminApi 里比对 openid 白名单，
 *      前端拿不到也改不了。
 *
 * ★ 本文件只做三件事：
 *   1. 把 wx.cloud.callFunction 包一层，统一错误形状（页面里不要再各写一套）
 *   2. 定义六种数据类型的元信息（列表怎么显示、表单有哪些字段）
 *   3. 提供一些纯函数小工具（站点文本 ↔ 数组、日期 ↔ 时间戳）
 *
 * ★ 小程序端禁用的语法（会被 SWC 编译成 require('@swc/runtime/...') 导致白屏）：
 *   数组解构 / 对象展开 / 数组展开 / for...of —— 本文件全部避开。
 */

const schema = require('../shared/schema');

/** 云函数名（唯一数据通道） */
const CLOUD_NAME = 'adminApi';

/* ============================================================
 * 枚举 → 标签
 * ============================================================ */

function toLabelMap(list) {
  const m = {};
  (list || []).forEach((o) => { m[o.value] = o.label; });
  return m;
}

const SCALE_LABELS = toLabelMap(schema.SCALE_OPTIONS);
const FREQUENCY_LABELS = toLabelMap(schema.FREQUENCY_OPTIONS);
const LEVEL_LABELS = toLabelMap(schema.ANNOUNCEMENT_LEVELS);
const CORRECTION_TYPE_LABELS = toLabelMap(schema.CORRECTION_TYPES);
const CORRECTION_STATUS_LABELS = schema.CORRECTION_STATUS_LABELS;

/** 频率的「未填」选项 —— 关联表允许不填发车频率，picker 得有个空位 */
const FREQUENCY_PICKER = [{ value: '', label: '未填写' }].concat(schema.FREQUENCY_OPTIONS);

/* ============================================================
 * 类型元信息
 *
 * 小程序屏太小，不按桌面后台那样一个表一个页面，
 * 而是「通用列表 + 通用表单」由 type 驱动 —— 功能一一对应，页面数少一半。
 * ============================================================ */

const TYPES = {
  companies: {
    key: 'companies',
    label: '公司',
    desc: '物流公司档案：名称、电话、所在城市',
    searchable: true,
    editable: true,
    deletable: true,
    fields: [
      { key: 'name', label: '公司全称', kind: 'text', required: true, placeholder: '如 济南鲁通物流有限公司' },
      { key: 'shortName', label: '简称', kind: 'text', placeholder: '如 鲁通物流' },
      { key: 'phone', label: '主电话', kind: 'text', required: true, placeholder: '多个号码用逗号分隔' },
      { key: 'backupPhone', label: '备用电话', kind: 'text', placeholder: '选填' },
      { key: 'city', label: '所在城市', kind: 'text', placeholder: '如 济南' },
      { key: 'province', label: '所在省', kind: 'text', placeholder: '如 山东' },
      { key: 'scale', label: '规模', kind: 'picker', options: schema.SCALE_OPTIONS, def: 'small' },
      { key: 'verified', label: '已核实', kind: 'switch', def: false },
      { key: 'address', label: '总部地址', kind: 'text', placeholder: '选填' },
      { key: 'intro', label: '简介', kind: 'textarea', placeholder: '选填，200 字内' },
      { key: 'pinyin', label: '全拼', kind: 'text', placeholder: '选填，用于拼音搜索，如 jinanlutong' },
      { key: 'initial', label: '首字母', kind: 'text', placeholder: '选填，如 jnlt' },
      {
        key: 'departureStations', label: '发站', kind: 'textarea',
        placeholder: '一行一个站点：地址 | 电话',
        hint: '每行一个站点，地址与电话之间用竖线分隔；只填地址也可以'
      },
      {
        key: 'arrivalStations', label: '到站', kind: 'textarea',
        placeholder: '一行一个站点：地址 | 电话',
        hint: '每行一个站点，地址与电话之间用竖线分隔；只填地址也可以'
      }
    ]
  },

  routes: {
    key: 'routes',
    label: '线路',
    desc: '出发城市 → 到达城市，是查询的枢纽',
    searchable: true,
    editable: true,
    deletable: true,
    fields: [
      { key: 'fromCity', label: '出发城市', kind: 'text', required: true, placeholder: '如 济南' },
      { key: 'toCity', label: '到达城市', kind: 'text', required: true, placeholder: '如 广州' },
      { key: 'fromProvince', label: '出发省', kind: 'text', placeholder: '选填' },
      { key: 'toProvince', label: '到达省', kind: 'text', placeholder: '选填' }
    ],
    // ★ 提示：routeKey 由城市派生，改城市就等于改主键，关联会自动跟着走
    note: '线路主键由「出发城市-到达城市」派生，改城市会自动同步已有关联，不需要手工改。'
  },

  links: {
    key: 'links',
    label: '关联',
    desc: '哪家公司跑哪条线、几天到、是否直达',
    searchable: true,
    editable: true,
    deletable: true,
    fields: [
      { key: 'routeId', label: '线路', kind: 'picker', source: 'routes', required: true },
      { key: 'companyId', label: '公司', kind: 'picker', source: 'companies', required: true },
      { key: 'transitDays', label: '时效（天）', kind: 'number', placeholder: '如 2' },
      { key: 'isDirect', label: '直达', kind: 'switch', def: false },
      { key: 'frequency', label: '发车频率', kind: 'picker', options: FREQUENCY_PICKER, def: '' },
      { key: 'priceNote', label: '价格备注', kind: 'text', placeholder: '选填，如 重货 300/吨' },
      { key: 'remark', label: '备注', kind: 'textarea', placeholder: '选填' }
    ],
    // ★ 核心取舍：时效/直达/频率挂关联表，不挂公司表
    note: '时效、是否直达、发车频率属于「这家公司跑这条线」的属性，所以记在关联上。'
  },

  announcements: {
    key: 'announcements',
    label: '公告',
    desc: '首页公告栏滚动播的内容',
    searchable: false,
    editable: true,
    deletable: true,
    fields: [
      { key: 'title', label: '标题', kind: 'text', required: true, maxlength: 40, placeholder: '滚动条里展示的主文案' },
      { key: 'content', label: '正文', kind: 'textarea', required: true, placeholder: '点开后看到的详情' },
      { key: 'level', label: '级别', kind: 'picker', options: schema.ANNOUNCEMENT_LEVELS, def: 'info' },
      {
        key: 'link', label: '跳转页面', kind: 'text',
        placeholder: '选填，如 /pages/privacy/index',
        hint: '只允许填本小程序的页面路径（以 / 开头），外链点了不会有反应'
      },
      { key: 'enabled', label: '上线', kind: 'switch', def: true },
      { key: 'sortOrder', label: '排序号', kind: 'number', def: 10, placeholder: '越小越靠前' },
      { key: 'startAt', label: '生效日期', kind: 'date', placeholder: '选填，不填表示不限' },
      { key: 'endAt', label: '失效日期', kind: 'date', placeholder: '选填，不填表示不限' }
    ],
    note: '时间窗倒挂（生效晚于失效）会被服务端拒绝。'
  },

  featured: {
    key: 'featured',
    label: '推广位',
    desc: '首页「优质线路」区块展示什么',
    searchable: false,
    editable: true,
    deletable: true,
    fields: [
      { key: 'fromCity', label: '出发城市', kind: 'text', required: true, placeholder: '如 济南' },
      { key: 'toCity', label: '到达城市', kind: 'text', required: true, placeholder: '如 广州' },
      { key: 'tag', label: '角标', kind: 'text', required: true, maxlength: 8, placeholder: '如 天天发车' },
      { key: 'reason', label: '推荐理由', kind: 'text', maxlength: 60, placeholder: '如 济南发货首选，2 天到' },
      { key: 'enabled', label: '上线', kind: 'switch', def: true },
      { key: 'sortOrder', label: '排序号', kind: 'number', def: 10, placeholder: '越小越靠前' }
    ],
    note: '推广位指向的线路必须已存在，同城会被服务端拒绝。'
  },

  corrections: {
    key: 'corrections',
    label: '纠错',
    desc: '用户提交的信息纠错，审核后可采纳或驳回',
    searchable: false,
    editable: false,   // 内容是用户提交的凭证，只改状态不改内容
    deletable: true,
    fields: []
  }
};

const TYPE_KEYS = Object.keys(TYPES);

/* ============================================================
 * 云函数调用
 * ============================================================ */

/**
 * 统一调用入口
 *
 * @returns {Promise<{ok:boolean, code?:string, message?:string, ...}>}
 *
 * ★ 云函数没部署 / 网络断了，这里也要返回一个**形状一致**的结果，
 *   页面就不用在每个 catch 里重写一遍错误文案。
 */
async function call(data) {
  try {
    const res = await wx.cloud.callFunction({ name: CLOUD_NAME, data: data || {} });
    const r = (res && res.result) || {};
    // 云函数没接住异常时会返回 null —— 也要当成失败，不然页面会拿着 undefined 往下走
    if (!r || typeof r !== 'object') {
      return { ok: false, code: 'BAD_RESULT', message: '后台返回异常，请重试' };
    }
    return r;
  } catch (e) {
    const msg = (e && (e.errMsg || e.message)) || '';
    if (/not found|FUNCTION_NOT_FOUND|-501000/i.test(msg)) {
      return {
        ok: false,
        code: 'NO_FUNC',
        message: '后台云函数 adminApi 尚未部署，请在开发者工具里上传后再试'
      };
    }
    return { ok: false, code: 'NETWORK', message: '网络异常，请稍后重试' };
  }
}

/** 是否是「再试也没用」的错误（没权限 / 没配置 / 没部署），页面应给指引而不是重试按钮 */
function isFatal(code) {
  return code === 'NOT_ADMIN' || code === 'NOT_CONFIGURED' || code === 'NO_FUNC' || code === 'NO_OPENID';
}

/* ============================================================
 * 各 action
 * ============================================================ */

/** 我是谁（唯一不校验管理员的 action —— 页面要靠它显示 openid） */
function whoami() {
  return call({ action: 'whoami' });
}

function overview() {
  return call({ action: 'overview' });
}

function quality() {
  return call({ action: 'quality' });
}

/** 编辑页的下拉选项：线路列表 + 公司列表 */
function options() {
  return call({ action: 'options' });
}

function list(type, kw, page, pageSize) {
  return call({
    action: 'list',
    type: type,
    kw: kw || '',
    page: page || 1,
    pageSize: pageSize || 20
  });
}

function get(type, id) {
  return call({ action: 'get', type: type, id: id });
}

function save(type, id, data) {
  return call({ action: 'save', type: type, id: id || '', data: data || {} });
}

function remove(type, id) {
  return call({ action: 'remove', type: type, id: id });
}

/** 纠错审核：只改状态与备注 */
function review(id, status, note) {
  return call({ action: 'review', id: id, status: status, note: note || '' });
}

function importPreview(text) {
  return call({ action: 'importPreview', text: text });
}

function importCommit(text) {
  return call({ action: 'importCommit', text: text });
}

/* ============================================================
 * 纯函数小工具
 * ============================================================ */

/**
 * 站点数组 → 文本框文本
 *   形如 [{address:'济南市…', phone:'0531-…'}] → "济南市… | 0531-…"
 */
function stationsToText(list) {
  if (!Array.isArray(list)) return '';
  const out = [];
  list.forEach((s) => {
    if (!s) return;
    const a = String(s.address || '').trim();
    const p = String(s.phone || '').trim();
    if (!a && !p) return;
    out.push(p ? a + ' | ' + p : a);
  });
  return out.join('\n');
}

/** 文本框文本 → 站点数组（每行一个，地址与电话用竖线分隔） */
function textToStations(text) {
  const out = [];
  String(text || '').split(/\r?\n/).forEach((line) => {
    const t = line.trim();
    if (!t) return;
    const idx = t.indexOf('|');
    if (idx < 0) {
      out.push({ address: t, phone: '' });
      return;
    }
    out.push({
      address: t.slice(0, idx).trim(),
      phone: t.slice(idx + 1).trim()
    });
  });
  return out;
}

/** 时间戳 → 'YYYY-MM-DD'（空则 ''） */
function tsToDate(ts) {
  const t = Number(ts);
  if (!t || !isFinite(t)) return '';
  const d = new Date(t);
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/**
 * 'YYYY-MM-DD' → 当天 00:00 的时间戳
 * ★ 与桌面后台同口径：只取到「天」，不取时分秒，避免同一天填两次算出不同值。
 */
function dateToTs(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
  if (!m) return 0;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0).getTime();
}

/** 按 key 生成一个定长空表单（新建时用） */
function blankForm(type) {
  const meta = TYPES[type];
  const form = {};
  if (!meta) return form;
  meta.fields.forEach((f) => {
    form[f.key] = f.def === undefined ? '' : f.def;
  });
  // 站点类字段是数组形态，文本框里用字符串
  form.departureStations = '';
  form.arrivalStations = '';
  return form;
}

/** 服务端记录 → 表单值（编辑时用） */
function rowToForm(type, row) {
  const meta = TYPES[type];
  const form = blankForm(type);
  if (!meta || !row) return form;
  meta.fields.forEach((f) => {
    const v = row[f.key];
    if (f.kind === 'switch') {
      form[f.key] = v === true || v === 'true';
      return;
    }
    if (f.kind === 'date') {
      form[f.key] = tsToDate(v);
      return;
    }
    if (f.key === 'departureStations' || f.key === 'arrivalStations') {
      form[f.key] = stationsToText(v);
      return;
    }
    if (f.kind === 'number') {
      form[f.key] = (v === null || v === undefined || v === '') ? '' : Number(v);
      return;
    }
    form[f.key] = v === null || v === undefined ? '' : v;
  });
  return form;
}

/** 表单值 → 提交给服务端的数据（日期转时间戳、站点转数组） */
function formToPayload(type, form) {
  const meta = TYPES[type];
  const out = {};
  if (!meta) return out;
  meta.fields.forEach((f) => {
    const v = form[f.key];
    if (f.kind === 'date') {
      out[f.key] = dateToTs(v);
      return;
    }
    if (f.key === 'departureStations' || f.key === 'arrivalStations') {
      out[f.key] = textToStations(v);
      return;
    }
    if (f.kind === 'number') {
      out[f.key] = (v === '' || v === null || v === undefined) ? null : Number(v);
      return;
    }
    if (f.kind === 'switch') {
      out[f.key] = v === true;
      return;
    }
    out[f.key] = v === null || v === undefined ? '' : v;
  });
  return out;
}

/**
 * 列表行 → 展示用的 { title, sub, chips }
 *
 * 六种数据类型形状各异，统一在 JS 里拼好再交给 WXML，
 * 模板里就不必塞一堆 wx:if 分支（那样改起来很痛）。
 */
function buildRow(type, item) {
  const row = { id: item._id || '', title: '', sub: '', chips: [], raw: item };

  if (type === 'companies') {
    row.title = item.name || '(未命名公司)';
    const bits = [];
    if (item.city) bits.push(item.city);
    if (item.phone) bits.push(item.phone);
    row.sub = bits.join(' · ');
    if (item.scale) row.chips.push({ text: SCALE_LABELS[item.scale] || item.scale, tone: 'blue' });
    if (item.verified) row.chips.push({ text: '已核实', tone: 'green' });
    return row;
  }

  if (type === 'routes') {
    row.title = item.routeKey || '(无效线路)';
    const n = Number(item.companyCount) || 0;
    row.sub = n > 0 ? n + ' 家公司在跑' : '还没有公司跑这条线';
    if (n === 0) row.chips.push({ text: '空线路', tone: 'amber' });
    return row;
  }

  if (type === 'links') {
    const route = item.route || {};
    const company = item.company || {};
    const link = item.link || item;
    row.title = route.routeKey || '(线路缺失)';
    row.sub = company.name || '(公司缺失)';
    const d = Number(link.transitDays);
    if (isFinite(d) && d > 0) row.chips.push({ text: d + ' 天', tone: 'violet' });
    else row.chips.push({ text: '时效未填', tone: 'amber' });
    if (link.isDirect) row.chips.push({ text: '直达', tone: 'green' });
    if (link.frequency) row.chips.push({ text: FREQUENCY_LABELS[link.frequency] || link.frequency, tone: 'blue' });
    return row;
  }

  if (type === 'announcements') {
    row.title = item.title || '(无标题)';
    row.sub = item.content || '';
    row.chips.push({ text: LEVEL_LABELS[item.level] || '通知', tone: item.level === 'warning' ? 'amber' : 'blue' });
    row.chips.push({ text: item.enabled === false ? '已下线' : '已上线', tone: item.enabled === false ? 'gray' : 'green' });
    return row;
  }

  if (type === 'featured') {
    row.title = (item.fromCity || '?') + ' → ' + (item.toCity || '?');
    row.sub = item.reason || '';
    if (item.tag) row.chips.push({ text: item.tag, tone: 'peach' });
    row.chips.push({ text: item.enabled === false ? '已下线' : '已上线', tone: item.enabled === false ? 'gray' : 'green' });
    return row;
  }

  if (type === 'corrections') {
    row.title = item.targetSummary || item.content || '(无内容)';
    row.sub = (CORRECTION_TYPE_LABELS[item.type] || '其他') + ' · ' + tsToDate(item.createdAt);
    row.chips.push({
      text: CORRECTION_STATUS_LABELS[item.status] || item.status || '待审核',
      tone: item.status === 'accepted' ? 'green'
        : (item.status === 'rejected' ? 'gray' : (item.status === 'hold' ? 'amber' : 'peach'))
    });
    return row;
  }

  return row;
}

module.exports = {
  CLOUD_NAME,
  TYPES,
  TYPE_KEYS,
  SCALE_LABELS,
  FREQUENCY_LABELS,
  LEVEL_LABELS,
  CORRECTION_TYPE_LABELS,
  CORRECTION_STATUS_LABELS,
  call,
  isFatal,
  whoami,
  overview,
  quality,
  options,
  list,
  get,
  save,
  remove,
  review,
  importPreview,
  importCommit,
  stationsToText,
  textToStations,
  tsToDate,
  dateToTs,
  blankForm,
  rowToForm,
  formToPayload,
  buildRow
};
