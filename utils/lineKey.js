// utils/lineKey.js
// 线路定位键的统一解析（详情页 / 管理端编辑页 / 广告关联共用）。
//
// 背景：lines 集合有两个"键"——
//   _id  数据库主键，任何文档必有，字符串；
//   id   业务字段（毫秒时间戳），由 adminLine save/batchSave 生成。
// 历史遗留：旧版云函数批量导入 / 控制台直灌的线路**没有 id 字段**。
// 而分享链接、列表跳转、收藏、编辑长期只认 id，导致这批数据：
//   · 用户端点卡片 → 详情页拿到 NaN → 提示"链接已失效"（线路明明存在）
//   · 收藏 → storage.addFavorite 因缺 id 直接 reject → "操作失败"
//   · 管理端"编辑" → where({id: NaN}) 查不到 → "未找到该专线，可能已删除"
// 这里统一"兼容两种键"：纯数字 → 按 id 查；其余（_id 字符串）→ 按 _id 查，
// 同时服务端在返回/自愈时补 id（见 searchLine.normalizeLine / adminLine.healMissingIds），
// 新旧链路都能落地。

// _id 长度下限：云开发默认 _id 为 24 位十六进制，放宽到 8 位以兼容自定义 _id
const MIN_ID_LEN = 8;

/**
 * 解析页面参数中的线路键。
 * @param {string|number} raw 路由参数（数字 id 或 _id 字符串）
 * @returns {{byId:boolean, value:number|string}|null} null = 参数非法
 */
function parseLineKey(raw) {
  const s = String(raw === undefined || raw === null ? '' : raw).trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return n > 0 ? { byId: true, value: n } : null;
  }
  return s.length >= MIN_ID_LEN ? { byId: false, value: s } : null;
}

/** 线路键 → 数据库查询条件（可直接传给 collection.where） */
function lineWhere(key) {
  if (!key) return null;
  return key.byId ? { id: key.value } : { _id: key.value };
}

/** 线路对象 → 可用于跳转/分享的稳定键（优先主键 _id，其次业务 id） */
function lineRef(line) {
  if (!line) return '';
  return line._id || line.id || '';
}

module.exports = { parseLineKey, lineWhere, lineRef, MIN_ID_LEN };
