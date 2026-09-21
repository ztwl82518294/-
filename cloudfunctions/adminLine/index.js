// cloudfunctions/adminLine/index.js
// 专线管理云函数（管理端专用）。
// 权限：管理员名单单点配置于数据库 app_config 集合 doc 'admins'（openids 数组），
//       本地 FALLBACK_ADMINS 仅作集合未初始化时的兜底（首次调用会自动把兜底名单写入库）。
//       以后增减管理员直接改 app_config/admins 文档即可，无需重新部署云函数。
// action:
//   save      —— 新增/更新一条专线（服务端字段白名单 + 类型归一）
//   batchSave —— 批量导入（全新记录，重新生成 id）
//   remove    —— 删除
//   toggle    —— 上下架
//   list      —— 全量列表（含 isVip 旧数据到期时间自愈迁移）
//   batchVip  —— 按公司批量开通/续费 VIP（companyName + days 天，clear=true 停用）

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// ===== 管理员白名单（单点配置，硬编码仅兜底） =====
const FALLBACK_ADMINS = [
  'oxWBc15BpD7x2BR7O5u1O7TjBnGo'
];
let _admins = null, _adminsTs = 0;
async function getAdmins() {
  if (_admins && Date.now() - _adminsTs < 300000) return _admins; // 实例内缓存 5 分钟
  try {
    const doc = await db.collection('app_config').doc('admins').get();
    const ids = doc.data && doc.data.openids;
    if (Array.isArray(ids) && ids.length) {
      _admins = ids; _adminsTs = Date.now();
      return _admins;
    }
  } catch (e) { /* 文档不存在，走兜底 */ }
  // 自愈：把兜底名单写入数据库，之后改名单直接在控制台改库
  try {
    await db.collection('app_config').add({ data: { _id: 'admins', openids: FALLBACK_ADMINS.slice() } });
  } catch (e) { /* 已存在或其他错误，忽略 */ }
  _admins = FALLBACK_ADMINS.slice(); _adminsTs = Date.now();
  return _admins;
}

// save 字段白名单：防止误传/多余字段污染线路文档
const FIELD_WHITELIST = [
  'title', 'companyName', 'fromCityId', 'toCityId',
  'fromCityName', 'toCityName', 'fromAddress', 'toAddress', 'toAreas',
  'latitude', 'longitude', 'toLatitude', 'toLongitude',
  'aging', 'priceDesc', 'lineType', 'phone', 'fromPhone', 'toPhone', 'tags',
  'isVip', 'vipExpireAt', 'certified', 'status',
  // 网点（一址一话的精确配对）：详情页按"第1组/第2组"展示依赖此字段
  'fromOutlets', 'toOutlets'
];
const NUMBER_FIELDS = ['fromCityId', 'toCityId', 'latitude', 'longitude', 'toLatitude', 'toLongitude', 'isVip', 'vipExpireAt', 'certified', 'status'];

// 数组字段：批量导入模板里写成逗号字符串（"直达,天天发车"），
// 而展示端（wx:for 渲染标签）和编辑页（.join()）都按数组处理。
// 统一在写入端归一为字符串数组，避免"字符串 join is not a function"类崩溃。
const ARRAY_FIELDS = ['toAreas', 'tags'];
const ARR_SPLIT = /[,，、;；/|\s]+/;

function toArr(v) {
  if (v === undefined || v === null || v === '') return [];
  if (Array.isArray(v)) return v.map(x => String(x).trim()).filter(Boolean);
  return String(v).split(ARR_SPLIT).map(x => x.trim()).filter(Boolean);
}

// ===== 网点（outlets）：一址一话的精确配对 =====
// 背景：老数据 fromAddress 是多行文本、fromPhone 是逗号串，导入时无从得知
// "哪个电话属于哪个地址"，详情页只能按下标对位，网点多电话时会对错。
// 新模板支持按行写 "地址 | 电话"，服务端解析成 [{addr, phone}] 精确保序。
const OUTLET_FIELDS = ['fromOutlets', 'toOutlets'];
const OUTLET_ROW_SPLIT = /[\r\n;；]+/;      // 行分隔（不用逗号：地址内部常含逗号）
const OUTLET_CELL_SPLIT = /[|｜\t]+/;       // 行内分隔：地址 | 电话
const ADDR_SPLIT = /[\r\n;；|｜]+/;         // 多地址拆分
const PHONE_SPLIT = /[,，、;；/|\s]+/;      // 多电话拆分

function splitAddrs(v) {
  return String(v || '').split(ADDR_SPLIT).map(x => x.trim()).filter(Boolean);
}
function splitPhones(v) {
  return String(v || '').split(PHONE_SPLIT).map(x => x.trim()).filter(Boolean);
}

// 解析单行为 {addr, phone}；只有一列时按形态判断是地址还是电话
function parseOutletRow(s) {
  const text = String(s || '').trim();
  if (!text) return { addr: '', phone: '' };
  const parts = text.split(OUTLET_CELL_SPLIT).map(x => x.trim()).filter(Boolean);
  if (parts.length >= 2) return { addr: parts[0], phone: parts.slice(1).join(',') };
  const one = parts[0] || '';
  // 纯数字/带 - 且数字位 ≥7 视为电话，否则视为地址
  const isPhoneLike = /^[0-9+\-()（）\s]+$/.test(one) && one.replace(/\D/g, '').length >= 7;
  return isPhoneLike ? { addr: '', phone: one } : { addr: one, phone: '' };
}

// 归一为 [{addr, phone}]：支持对象数组、"地址|电话"字符串数组、整段换行文本
function toOutlets(v) {
  if (!v) return [];
  let rows = [];
  if (Array.isArray(v)) {
    rows = v.map(x => {
      if (x && typeof x === 'object') {
        return { addr: String(x.addr || x.address || '').trim(), phone: String(x.phone || x.tel || '').trim() };
      }
      return parseOutletRow(x);
    });
  } else {
    rows = String(v).split(OUTLET_ROW_SPLIT).map(parseOutletRow);
  }
  return rows.filter(r => r.addr || r.phone);
}

// 网点 ↔ 地址/电话 互派生：
//   给了网点 → 反推 fromAddress/fromPhone（保证老字段与配对一致）
//   没给网点 → 按 fromAddress/fromPhone 下标对位重建网点（兼容老数据与编辑页单条修改）
function deriveOutlets(out, side) {
  const ok = side === 'from' ? 'fromOutlets' : 'toOutlets';
  const ak = side === 'from' ? 'fromAddress' : 'toAddress';
  const pk = side === 'from' ? 'fromPhone' : 'toPhone';
  const outs = out[ok];
  if (Array.isArray(outs) && outs.length) {
    const addrs = outs.map(o => o.addr).filter(Boolean);
    const phones = outs.map(o => o.phone).filter(Boolean);
    if (addrs.length) out[ak] = addrs.join('\n');
    if (phones.length) out[pk] = phones.join(',');
    return;
  }
  const addrs = splitAddrs(out[ak] || '');
  const phones = splitPhones(out[pk] || '');
  // 【修复】网点/地址/电话三者都未提交时不动网点字段：
  // 部分字段的更新（如只改标题）不应把库里已有的网点清空
  if (!addrs.length && !phones.length && out[ak] === undefined && out[pk] === undefined) return;
  // 【修复】单地址多电话（一个园区挂多个号码的常见形态）→ 保持一个网点挂多号，
  // 避免按上标对位把"1 组网点"拆散成"1 组地址 + n 组纯电话"
  if (addrs.length === 1 && phones.length > 1) {
    out[ok] = [{ addr: addrs[0], phone: phones.join(',') }];
    return;
  }
  const n = Math.max(addrs.length, phones.length);
  const pairs = [];
  for (let i = 0; i < n; i++) pairs.push({ addr: addrs[i] || '', phone: phones[i] || '' });
  out[ok] = pairs;
}

// ===== 标准城市名规范化 =====
// 城市级搜索索引字段：fromCityName="济南市" → fromCity="济南"。
// 大数据量（万股级）下搜索/中转查询全部走 fromCity/toCity 复合索引精确匹配，
// 不再依赖"拉全量内存过滤"。
function normCity(s) {
  if (!s) return '';
  return String(s).trim().replace(/(市|区|县|省|自治州|盟|地区)$/, '');
}

function pickFields(data) {
  const out = {};
  FIELD_WHITELIST.forEach(f => {
    if (data[f] === undefined) return;
    if (OUTLET_FIELDS.indexOf(f) > -1) { out[f] = toOutlets(data[f]); return; }
    if (ARRAY_FIELDS.indexOf(f) > -1) { out[f] = toArr(data[f]); return; }
    out[f] = NUMBER_FIELDS.indexOf(f) > -1 ? Number(data[f]) || 0 : data[f];
  });
  // 网点配对：始终保证 fromOutlets/fromAddress/fromPhone 三者一致（两端分别处理）
  deriveOutlets(out, 'from');
  deriveOutlets(out, 'to');
  // 标准城市字段由服务端从城市名派生，不信任客户端传值。
  // 【修复】仅当本次提交带了城市名才派生：局部更新（只改标题/状态）时若无条件
  // 赋 normCity(undefined)===''，会把库里已有的 fromCity/toCity 索引清空，
  // 该线路随即从所有搜索中消失。
  if (out.fromCityName !== undefined) out.fromCity = normCity(out.fromCityName);
  if (out.toCityName !== undefined) out.toCity = normCity(out.toCityName);
  // phone 兼容字段自动派生（= 发站电话，缺省到站电话）：
  // 新导入模板只填 fromPhone/toPhone，老版本详情页/分享卡片仍读 phone
  if (!out.phone) out.phone = out.fromPhone || out.toPhone || '';
  return out;
}

// ===== 一次性自愈：把历史/导入数据里存成逗号字符串的 tags、toAreas 归一为数组 =====
// 用 app_config/migrated_arrays_v1 记录进度（cursor）与完成标记：
// 每次调用最多扫描 limitDocs 条，翻完一遍后打上 done，之后不再扫描。
const MIGRATE_FLAG = 'migrated_arrays_v1';
async function migrateArrayFields(limitDocs) {
  let cursor = 0, done = false, flagExists = false;
  try {
    const f = await db.collection('app_config').doc(MIGRATE_FLAG).get();
    if (f.data && f.data.done) return { skipped: true, scanned: 0, fixed: 0 };
    cursor = Number(f.data && f.data.cursor) || 0;
    flagExists = true;
  } catch (e) { /* 首次执行，文档不存在 */ }

  const PAGE = 100;
  let scanned = 0, fixed = 0;
  while (scanned < limitDocs) {
    const res = await db.collection('lines').skip(cursor).limit(PAGE).get();
    if (!res.data.length) { done = true; break; }
    cursor += res.data.length;
    scanned += res.data.length;
    for (const line of res.data) {
      const patch = {};
      if (line.tags !== undefined && !Array.isArray(line.tags)) patch.tags = toArr(line.tags);
      if (line.toAreas !== undefined && !Array.isArray(line.toAreas)) patch.toAreas = toArr(line.toAreas);
      if (Object.keys(patch).length) {
        try { await db.collection('lines').doc(line._id).update({ data: patch }); fixed++; } catch (e) { /* 单条失败不影响整体 */ }
      }
    }
    if (res.data.length < PAGE) { done = true; break; }
  }

  const payload = { cursor, done, scanned, fixed, at: Date.now() };
  try {
    if (flagExists) await db.collection('app_config').doc(MIGRATE_FLAG).update({ data: payload });
    else await db.collection('app_config').add({ data: Object.assign({ _id: MIGRATE_FLAG }, payload) });
  } catch (e) { /* 进度写入失败仅影响下次续扫，不影响数据正确性 */ }
  return payload;
}

const DAY = 86400000;

// ===== 自愈：给缺 id 字段的历史线路补唯一 id =====
// id 是详情页/收藏/管理端编辑的业务键，旧版批量导入/控制台直灌未写入该字段，
// 缺失时用户端表现为"点开提示链接已失效 / 收藏失败"，管理端表现为"编辑提示未找到"。
// 逐条补（每条值不同，无法批量 update）；每轮按 where({id: 缺}) 取 100 条，
// 补过的记录不再匹配，因此轮次自然收敛。
const ID_HEAL_BATCH = 100;
const ID_HEAL_MAX = 2000;   // 单次调用上限，避免拖慢管理端首屏
async function healMissingIds(maxDocs) {
  const limit = Math.max(ID_HEAL_BATCH, Math.min(Number(maxDocs) || ID_HEAL_MAX, ID_HEAL_MAX));
  const base = Date.now();  // 递增序号保证同批次内 id 唯一
  let seq = 0, scanned = 0, fixed = 0;
  while (scanned < limit) {
    const res = await db.collection('lines').where({ id: _.exists(false) }).limit(ID_HEAL_BATCH).get();
    if (!res.data.length) break;
    for (const doc of res.data) {
      try {
        await db.collection('lines').doc(doc._id).update({ data: { id: base + (seq++) } });
        fixed++;
      } catch (e) { /* 单条失败跳过，下一轮会再取到 */ }
    }
    scanned += res.data.length;
    // 本轮恰好取满说明可能还有；不足一批则已扫完
    if (res.data.length < ID_HEAL_BATCH) break;
  }
  return { scanned, fixed };
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const admins = await getAdmins();
  if (!admins.includes(wxContext.OPENID)) {
    return { error: '无权限操作' };
  }

  const { action, data } = event;

  if (action === 'save') {
    const clean = pickFields(data || {});
    if (data && data._id) {
      const _id = data._id;
      return await db.collection('lines').doc(_id).update({ data: clean });
    } else {
      clean.id = Date.now(); // 新增记录生成唯一 id（详情页/收藏按 id 检索）
      return await db.collection('lines').add({ data: clean });
    }
  }

  // 批量导入：data 为专线数组，逐条 add，返回成功/失败统计
  if (action === 'batchSave') {
    const list = Array.isArray(data) ? data : [];
    let success = 0;
    const errors = [];
    for (let i = 0; i < list.length; i++) {
      const item = pickFields(Object.assign({}, list[i]));
      // 导入一律作为全新记录：去掉带来的 _id，并重新生成唯一 id。
      // 若保留导出文件里的旧 id，重复导入会产生相同 id 的多条记录，
      // 而详情/编辑页用 where({id}) 取 res.data[0]，可能命中错误记录
      delete item._id;
      delete item.id;
      item.id = Date.now() + i;
      // 导入数据兼容：isVip=1 但无到期时间时补一年，保证 VIP 口径统一
      if (item.isVip === 1 && !item.vipExpireAt) item.vipExpireAt = Date.now() + 365 * DAY;
      try {
        await db.collection('lines').add({ data: item });
        success++;
      } catch (e) {
        errors.push({ index: i, msg: (e && e.errMsg) || String(e) });
      }
    }
    return { total: list.length, success, failed: list.length - success, errors };
  }

  if (action === 'remove') {
    return await db.collection('lines').doc(data._id).remove();
  }

  if (action === 'toggle') {
    return await db.collection('lines').doc(data._id).update({ data: { status: Number(data.status) ? 1 : 0 } });
  }

  // 分页列表：data.page（默认 1）、data.pageSize（默认 50，上限 100）、data.keyword（服务端正则搜索）
  // 大数据量（万股级）下必须分页加载，前端滚动翻页
  if (action === 'list') {
    const page = Math.max(1, Number((data && data.page) || 1));
    const pageSize = Math.min(100, Math.max(10, Number((data && data.pageSize) || 50)));
    const keyword = String((data && data.keyword) || '').trim();

    // 自愈迁移只在第 1 页且无关键词时执行（避免每次翻页都全表扫描）
    if (page === 1 && !keyword) {
      await db.collection('lines')
        .where({ status: _.exists(false) })
        .update({ data: { status: 1 } });
      // VIP 旧数据补到期时间（isVip=1 且无 vipExpireAt → 自当日起 1 年）
      await db.collection('lines')
        .where({ isVip: 1, vipExpireAt: _.exists(false) })
        .update({ data: { vipExpireAt: Date.now() + 365 * DAY } });
      // 数组字段自愈：分批扫描（每次最多 1000 条），翻完一遍后打标记不再执行
      try { await migrateArrayFields(1000); } catch (e) { /* 自愈失败不阻塞列表 */ }
      // 缺 id 的历史线路补 id（不补则用户端"点不开"、管理端"编辑不了"）
      try { await healMissingIds(500); } catch (e) { /* 同上，失败不阻塞列表 */ }
    }

    const where = keyword
      ? _.or(['title', 'companyName', 'fromCityName', 'toCityName'].map(f => ({
          [f]: db.RegExp({ regexp: keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), options: 'i' })
        })))
      : {};

    const [countRes, listRes] = await Promise.all([
      db.collection('lines').where(where).count(),
      db.collection('lines')
        .where(where)
        .orderBy('id', 'desc')          // 新线路在前，万股量级下更实用
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .get()
    ]);
    return {
      data: listRes.data,
      total: countRes.total,
      page,
      pageSize,
      hasMore: page * pageSize < countRes.total
    };
  }

  // 按公司批量开通/续费 VIP：base = max(现有到期时间, 当前时间) + days
  if (action === 'batchVip') {
    const companyName = String((data && data.companyName) || '').trim();
    const days = Number((data && data.days) || 0);
    const clear = !!(data && data.clear);
    if (!companyName) return { error: '请提供公司名称' };
    if (!clear && (!days || days <= 0)) return { error: 'days 必须为正数' };
    // 【修复】原来单次 limit(1000) 取完就结束：一家公司线路超过 1000 条时，
    // 只有前 1000 条被续费，其余静默漏掉（用户续了费却仍是过期会员）。
    // 改为 skip 分页循环（companyName 不会被本次更新改动，分页稳定）。
    const PAGE = 1000, MAX_PAGE = 20;   // 上限 2 万条，防异常跑飞
    let updated = 0;
    for (let p = 0; p < MAX_PAGE; p++) {
      const res = await db.collection('lines').where({ companyName }).skip(p * PAGE).limit(PAGE).get();
      if (!res.data.length) break;
      for (const line of res.data) {
        if (clear) {
          await db.collection('lines').doc(line._id).update({ data: { isVip: 0, vipExpireAt: 0 } });
        } else {
          const base = (line.vipExpireAt && line.vipExpireAt > Date.now()) ? line.vipExpireAt : Date.now();
          await db.collection('lines').doc(line._id).update({
            data: { isVip: 1, vipExpireAt: base + days * DAY }
          });
        }
        updated++;
      }
      if (res.data.length < PAGE) break;
    }
    return { ok: true, companyName, updated };
  }

  // 手动触发数组字段自愈（可在云开发控制台测试时传 { action: 'migrateArrays', data: { limit: 5000 } }）
  if (action === 'migrateArrays') {
    const limit = Math.min(20000, Math.max(100, Number((data && data.limit) || 5000)));
    const r = await migrateArrayFields(limit);
    return Object.assign({ ok: true }, r);
  }

  // 手动触发缺 id 自愈（控制台可传 { action: 'healIds', data: { limit: 2000 } }）
  if (action === 'healIds') {
    const r = await healMissingIds((data && data.limit) || ID_HEAL_MAX);
    return Object.assign({ ok: true }, r);
  }

  return { error: '未知操作' };
};
