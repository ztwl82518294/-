// cloudfunctions/statLog/index.js
// 用户行为埋点写入（服务端版，防刷量）。
// 背景：此前 stat_events 由小程序端直连写入，任何人可用脚本高频写入 search/view
//      事件冲高活跃数据，使统计榜单失真。现改为经本云函数写入，服务端做频控：
//      同一用户（openid）同一自然日最多写入 DAILY_CAP 条事件，超出部分静默丢弃。
// 口径保持不变：
//   - stat_events 集合，PV 口径；month(yyyy-MM)/day(yyyy-MM-DD) 均按东八区；
//   - _openid 由服务端取 getWXContext().OPENID 显式注入（云函数写入不会自动注入，
//     adminStats 按字段 _openid 聚合，口径必须一致）；
//   - 前端 fire-and-forget，任何失败不影响用户操作。
// action:
//   log —— 写一条事件 {type, key}（默认）

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 单用户单日事件写入上限（search/view 合计）。
// 口径：一次搜索 = 1 条 search + 用户点开详情产生的若干条 view，
// 正常用户一天查十来条线路就会产生几十条事件，30 会把重度用户提前封顶，
// 而月度榜单一按事件总数排名 —— 等于变相惩罚活跃用户（榜单失真）。
// 100 条足以覆盖真实使用强度，仍能拦住脚本刷量（脚本是千/万级）。
const DAILY_CAP = 100;

// 自愈建集合的 Promise 缓存。
// 原来每次埋点都 await 两次 createCollection，绝大多数情况下集合早已存在，
// 等于每次埋点白搭两次网络往返（本函数是全小程序调用最频繁的接口）。
// 改为成功后缓存 Promise，同实例内后续调用直接复用；失败则清空缓存以便下次重试。
let _colsReady = null;
function ensureCollections() {
  if (!_colsReady) {
    _colsReady = Promise.all([
      // app_errors 是 app.js onError 错误上报的目标集合，借本高频函数顺带创建，
      // 避免小程序端直写不存在的集合报 -502005。
      db.createCollection('stat_events').catch(() => {}),
      db.createCollection('app_errors').catch(() => {})
    ]).then(() => true, (e) => {
      _colsReady = null; // 失败不缓存，下次调用再试一次
      console.warn('statLog 建集合失败：', e && e.errMsg);
      return false;
    });
  }
  return _colsReady;
}

function pad(n) { return n < 10 ? '0' + n : '' + n; }

// 东八区当前时间 → { month: 'yyyy-MM', day: 'yyyy-MM-DD' }
function eastEightNow() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return {
    month: d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1),
    day: d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate())
  };
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, reason: 'no-openid' };

  const action = event.action || 'log';
  if (action !== 'log') return { ok: false, reason: 'unknown-action' };

  const type = String(event.type || '');
  const key = String(event.key || '');
  if (!type || !key) return { ok: false, reason: 'bad-params' };

  const { month, day } = eastEightNow();

  // 自愈建集合（已存在时报错，忽略；已建过则命中缓存，不再重复请求）
  await ensureCollections();

  // 频控：统计该用户当日已写入条数（仅按 day 过滤，无需索引 month）
  try {
    const cnt = await db.collection('stat_events')
      .where({ _openid: OPENID, day: day })
      .count();
    if (cnt.total >= DAILY_CAP) {
      console.warn('statLog 频控触发：', OPENID, day, cnt.total);
      return { ok: false, reason: 'rate-limited' };
    }
  } catch (e) {
    // 计数失败时保守放行，不阻塞正常埋点（宁多记勿漏记）
    console.warn('statLog 频控查询失败：', e && e.errMsg);
  }

  try {
    await db.collection('stat_events').add({
      data: {
        type: type,       // 'search'=搜索路线 | 'view'=浏览专线详情
        key: key,         // search: 出发→到达；view: 专线 id
        month: month,     // yyyy-MM，与 adminStats 聚合口径一致
        day: day,         // yyyy-MM-DD，用于频控
        ts: Date.now(),
        _openid: OPENID   // 服务端显式注入（云函数写入不自动带）
      }
    });
    return { ok: true };
  } catch (e) {
    console.error('statLog 写入失败：', e && e.errMsg);
    return { ok: false, reason: 'write-failed' };
  }
};
