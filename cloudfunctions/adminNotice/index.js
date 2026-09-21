// cloudfunctions/adminNotice/index.js
// 管理员公告管理云函数（带权限校验）

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// ===== 管理员白名单（单点配置于数据库 app_config/admins，硬编码仅兜底，与 adminLine 保持一致） =====
const FALLBACK_ADMINS = [
  'oxWBc15BpD7x2BR7O5u1O7TjBnGo'
];
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

// 公告用固定 _id，方便幂等 upsert，避免 limit(1).get() 无序匹配历史脏 doc
const NOTICE_ID = 'current';

exports.main = async (event) => {
  // 权限校验：不是管理员直接拒绝
  const wxContext = cloud.getWXContext();
  const admins = await getAdmins();
  if (!admins.includes(wxContext.OPENID)) {
    return { error: '无权限操作' };
  }

  const { action } = event;
  const data = event.data || {};   // 防崩溃：未传 data 时原来是 data.text 直接 TypeError

  // 保存公告：用固定 _id 做幂等 upsert（已存在则更新，不存在则新增）
  if (action === 'save') {
    // 公告跑马灯展示，超长会撑破首页卡片，这里截到 500 字
    const payload = { text: String(data.text || '').trim().slice(0, 500), ts: Date.now() };
    try {
      // 先尝试更新固定 doc
      await db.collection('notice').doc(NOTICE_ID).update({ data: payload });
    } catch (e) {
      // doc 不存在则 add（add 失败一般是已存在，吞错即可）
      try {
        await db.collection('notice').add({ data: Object.assign({ _id: NOTICE_ID }, payload) });
      } catch (e2) {
        return { error: '保存失败：' + (e2.errMsg || e2.message || String(e2)) };
      }
    }
    return { ok: true };
  }

  return { error: '未知操作' };
};