// cloudfunctions/adminAd/index.js
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// ===== 管理员白名单（单点配置于数据库 app_config/admins，硬编码仅兜底，与 adminLine 保持一致） =====
const FALLBACK_ADMINS = ['oxWBc15BpD7x2BR7O5u1O7TjBnGo'];
let _admins = null, _adminsTs = 0;
async function getAdmins() {
  if (_admins && Date.now() - _adminsTs < 300000) return _admins;
  try {
    const doc = await db.collection('app_config').doc('admins').get();
    const ids = doc.data && doc.data.openids;
    if (Array.isArray(ids) && ids.length) {
      _admins = ids; _adminsTs = Date.now();
      return _admins;
    }
  } catch (e) { /* 文档不存在，走兜底 */ }
  try {
    await db.collection('app_config').add({ data: { _id: 'admins', openids: FALLBACK_ADMINS.slice() } });
  } catch (e) { /* 已存在，忽略 */ }
  _admins = FALLBACK_ADMINS.slice(); _adminsTs = Date.now();
  return _admins;
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const admins = await getAdmins();
  if (!admins.includes(wxContext.OPENID)) return { error: '无权限操作' };

  const { action } = event;
  const data = event.data || {};   // 防崩溃：未传 data 时原来是 data.companyName 直接 TypeError

  // 保存（有就更新，没有就新增）
  if (action === 'save') {
    // id 必填且须为 1-10 的整数：首页按 id 定位 10 个广告位，
    // 缺失/非法 id 会新增一条无 id 的脏 doc，首页永远匹配不到（存了不显示）
    const id = Number(data.id);
    if (!Number.isInteger(id) || id < 1 || id > 10) return { error: '广告位编号不合法（应为 1-10）' };
    // lineId 支持两种键：数字业务 id（新数据）、_id 字符串（缺 id 的历史线路）。
    // 原来统一 Number() 强转会把 _id 变成 NaN→0，导致广告关联失效、点击跳不动
    const rawLineId = String(data.lineId === undefined || data.lineId === null ? '' : data.lineId).trim();
    const asNum = Number(rawLineId);
    const lineId = rawLineId ? (Number.isFinite(asNum) && asNum > 0 ? asNum : rawLineId) : 0;
    const fields = {
      companyName: String(data.companyName || '').trim(),
      region: String(data.region || '').trim(),
      number: Number(data.number) || 0,
      lineId: lineId
    };
    const exist = await db.collection('ads').where({ id }).get();
    if (exist.data.length > 0) {
      return await db.collection('ads').doc(exist.data[0]._id).update({ data: fields });
    } else {
      return await db.collection('ads').add({ data: Object.assign({ id }, fields) });
    }
  }

  // 列表
  if (action === 'list') {
    return await db.collection('ads').orderBy('id', 'asc').get();
  }

  return { error: '未知操作' };
};