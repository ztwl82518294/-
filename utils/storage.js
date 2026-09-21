// utils/storage.js
const db = wx.cloud.database();
const HISTORY_KEY = 'logistics_search_history';
const vip = require('./vip.js');

// ==================== 查询历史（本地） ====================
function getSearchHistory() {
  return wx.getStorageSync(HISTORY_KEY) || [];
}

function addSearchHistory(record) {
  let list = getSearchHistory();
  // 首页改为自由输入城市后 fromCityId/toCityId 恒为 0，不能再用 id 去重
  // （否则 findIndex 永远命中第 0 条，导致历史每次只剩最新 1 条）。
  // 改为按“出发→到达”城市名去重：同一路线再次查询时移除旧记录、置顶新记录。
  const from = (record.fromCityName || '').trim();
  const to = (record.toCityName || '').trim();
  const i = list.findIndex(x => (x.fromCityName || '').trim() === from && (x.toCityName || '').trim() === to);
  if (i > -1) list.splice(i, 1);
  // 时间统一格式 MM-DD HH:mm（toLocaleString 各机型格式不一）
  const now = new Date();
  const p = n => (n < 10 ? '0' + n : '' + n);
  record.time = p(now.getMonth() + 1) + '-' + p(now.getDate()) + ' ' + p(now.getHours()) + ':' + p(now.getMinutes());
  list.unshift(record);
  if (list.length > 20) list = list.slice(0, 20);
  wx.setStorageSync(HISTORY_KEY, list);
}

function clearSearchHistory() {
  wx.setStorageSync(HISTORY_KEY, []);
}

// ==================== 收藏（云端） ====================

/**
 * 读取收藏列表。
 * @param {Function} [onError] 可选失败回调。内部默认吞错返回空数组，
 *   传此回调可让页面区分"真的没有收藏"和"读取失败"，展示错误态 + 重试。
 */
function getFavorites(onError) {
  // 小程序端 collection.get() 单次默认只返回 20 条，必须循环分页拉全，
  // 否则收藏超过 20 条后第 21 条起会静默丢失（确定性数据丢失 Bug）
  const PAGE = 20;
  const MAX = 1000;
  let all = [];
  const fetchPage = skip => db.collection('favorites')
    .orderBy('createTime', 'desc')
    .skip(skip)
    .limit(PAGE)
    .get();

  return fetchPage(0).then(function loop(res) {
    all = all.concat(res.data);
    if (res.data.length < PAGE || all.length >= MAX) return all;
    return fetchPage(all.length).then(loop);
  }).then(res => {
    // 收藏的是专线快照，isVip 可能已过期：读出时统一修正为"有效会员"口径
    return res.map(r => {
      const line = r.line;
      if (line) line.isVip = vip.effectiveVip(line);
      return line;
    }).filter(Boolean);   // 快照缺失的脏收藏会产出 undefined 项，过滤掉避免渲染空白卡片/跳转报错
  })
    .catch(err => {
      // 出错时打印并返回空数组，避免页面崩溃；
      // 同时回调告知调用方，让页面能区分"没有收藏"和"读取失败"
      console.error('读取收藏失败：', err);
      if (typeof onError === 'function') {
        try { onError(err); } catch (e) { /* 回调自身出错不影响主流程 */ }
      }
      return [];
    });
}

function addFavorite(line) {
  // 收藏键以业务 id 为准（历史数据口径），缺 id 的历史线路用主键 _id 兜底，
  // 否则这批线路点收藏会直接报"缺少线路 id"失败
  const lineId = line && (line.id || line._id);
  if (!lineId) return Promise.reject(new Error('缺少线路 id，无法收藏'));

  // 先按 lineId 查重，避免重复收藏产生脏数据（幂等）
  return db.collection('favorites')
    .where({ lineId: lineId })
    .get()
    .then(res => {
      if (res.data.length > 0) {
        return res.data[0];
      }
      return db.collection('favorites')
        .add({
          data: {
            lineId: lineId,
            line: line,
            // 用时间戳（数字）排序，最稳妥
            createTime: Date.now()
          }
        });
    })
    .catch(err => {
      // 连点并发时"先查后插"之间可能已被插一条，若 favorites 已建 _openid+lineId 唯一索引，
      // 这次 add 会抛重复键错误——收藏本就已存在，按成功处理，不向用户报错。
      const msg = (err && (err.errMsg || err.message)) || '';
      if (/duplicate|unique|E11000|already exists/i.test(msg)) {
        return { duplicated: true };
      }
      console.error('添加收藏失败：', err);
      throw err;
    });
}

function removeFavorite(lineId) {
  return db.collection('favorites')
    .where({ lineId: lineId })
    .get()
    .then(res => {
      // 历史脏数据可能同一条线路收藏了多次（唯一索引建立前产生），
      // 只删第一条会导致"取消收藏后列表里还在"，故全部清理
      return Promise.all(res.data.map(r => db.collection('favorites').doc(r._id).remove()));
    })
    .catch(err => {
      console.error('取消收藏失败：', err);
      throw err; // 向上抛错，让调用方能感知失败（与 addFavorite 行为一致）
    });
}

function isFavorite(lineId) {
  return db.collection('favorites')
    .where({ lineId: lineId })
    .get()
    .then(res => res.data.length > 0)
    .catch(err => {
      console.error('查询收藏失败：', err);
      return false;
    });
}

module.exports = {
  getSearchHistory, addSearchHistory, clearSearchHistory,
  getFavorites, addFavorite, removeFavorite, isFavorite
};