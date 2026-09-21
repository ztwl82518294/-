// utils/stats.js
// 用户行为统计埋点（搜索 / 浏览专线）。
// 口径：每次触发经 statLog 云函数写入 stat_events（PV 口径，不去重）；
//       云函数内做频控（同用户单日上限），adminStats / prize 按自然月聚合排名。
// 所有写入均为 fire-and-forget：失败只打日志，绝不阻塞用户操作。
// 【部署提醒】需在开发者工具上传部署 statLog 云函数后本模块才生效；
// 　改为服务端写入是为了防止脚本直刷 stat_events 冲活跃榜。

function logEvent(type, key) {
  if (!type || !key) return;
  wx.cloud.callFunction({
    name: 'statLog',
    data: { action: 'log', type: type, key: String(key) }
  }).catch(err => {
    // 静默失败：统计不属于关键路径，只打日志
    console.warn('统计事件写入失败：', err);
  });
}

// 搜索事件：key 为"出发 → 到达"
function logSearch(fromText, toText) {
  logEvent('search', (fromText || '') + ' → ' + (toText || ''));
}

// 浏览事件：key 为专线 id（仅作事件明细，用户排名按服务端注入的 _openid 聚合）
function logView(line) {
  if (!line || !line.id) return;
  logEvent('view', line.id);
}

module.exports = { logSearch, logView };
