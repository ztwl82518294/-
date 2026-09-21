// cloudfunctions/adminStats/index.js
// 管理员统计云函数：按自然月统计"访问用户"活跃度排名（按 openid 聚合）。
// 数据源：stat_events 事件集合（前端 utils/stats.js 写入，PV 口径）。
// 用户身份：小程序端 db.add 时系统自动注入 _openid（真实且不可伪造），直接按其分组。

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const $ = db.command.aggregate;

// 聚合单次返回上限（云开发硬限制）。活跃用户数统计受此限制，超出部分无法计入。
const USER_AGG_CAP = 1000;

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

// 自愈建集合的 Promise 缓存：成功后同实例内复用，失败清空以便下次重试
let _colsReady = null;
function ensureCollections() {
  if (!_colsReady) {
    _colsReady = db.createCollection('stat_events')
      .then(() => true, () => { _colsReady = null; return false; });
  }
  return _colsReady;
}

// 服务器当前自然月 yyyy-MM（云函数默认 UTC 时区，加 8 小时偏移对齐东八区，与前端埋点口径一致）
function currentMonth() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const m = d.getUTCMonth() + 1;
  return d.getUTCFullYear() + '-' + (m < 10 ? '0' + m : '' + m);
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const admins = await getAdmins();
  if (!admins.includes(wxContext.OPENID)) {
    return { error: '无权限操作' };
  }

  const month = event.month || currentMonth();
  const col = db.collection('stat_events');

  // 空结果兜底：集合尚不存在（还没有任何埋点数据）或聚合异常时，返回空榜单而非让函数崩溃
  const empty = { month, totals: { users: 0, usersCapped: false, search: 0, view: 0 }, users: [] };

  // 自愈：集合不存在时先创建（云数据库不会因 add 自动建集合；已存在时报错，忽略即可）。
  // 建过一次后命中缓存，同实例内不再重复请求；失败不缓存，下次调用会再试。
  await ensureCollections();

  try {
    // 按用户（_openid）分组：合计操作数 + 最后活跃时间（仅用最基础的 sum(1)/max，兼容性最好）
    const totalAgg = await col.aggregate()
      .match({ month: month })
      .group({ _id: '$_openid', total: $.sum(1), lastTs: $.max('$ts') })
      .sort({ total: -1 })
      .limit(50)
      .end();

    // 搜索、浏览分别按用户计数（拆成两次基础聚合，避免 sum(cond) 嵌套表达式兼容问题）
    const [searchAgg, viewAgg] = await Promise.all([
      col.aggregate().match({ month: month, type: 'search' })
        .group({ _id: '$_openid', c: $.sum(1) }).end(),
      col.aggregate().match({ month: month, type: 'view' })
        .group({ _id: '$_openid', c: $.sum(1) }).end()
    ]);
    const searchMap = {};
    searchAgg.list.forEach(r => { searchMap[r._id] = r.c; });
    const viewMap = {};
    viewAgg.list.forEach(r => { viewMap[r._id] = r.c; });

    // 当月搜索/浏览总次数（榜单 limit 50，总数需单独统计，否则超 50 人后口径失真）
    const [searchTotal, viewTotal] = await Promise.all([
      col.where({ month: month, type: 'search' }).count(),
      col.where({ month: month, type: 'view' }).count()
    ]);

    // 活跃用户数（按 _openid 去重）。
    // 优先用聚合 $count 阶段——它没有"单次最多 1000 条"的限制，能给出精确值；
    // 若运行环境不支持该阶段，回退 group + limit，此时结果只是下限，置 capped 标记，
    // 由前端展示 "1000+" 并说明，避免把截断值当成精确值解读。
    let realUserCount = 0;
    let usersCapped = false;
    try {
      const counted = await col.aggregate()
        .match({ month: month })
        .group({ _id: '$_openid' })
        .count('userCount')
        .end();
      const n = counted && counted.list && counted.list[0] && counted.list[0].userCount;
      if (typeof n !== 'number') throw new Error('$count 返回格式异常');
      realUserCount = n;
    } catch (e) {
      console.warn('adminStats $count 不可用，回退 group+limit：', e && e.message);
      const fallback = await col.aggregate()
        .match({ month: month })
        .group({ _id: '$_openid' })
        .limit(USER_AGG_CAP)
        .end();
      realUserCount = fallback.list.length;
      usersCapped = realUserCount >= USER_AGG_CAP;
    }

    return {
      month: month,
      totals: {
        users: realUserCount,            // 当月活跃用户数（不受榜单 50 名限制，但最多 1000）
        usersCapped: usersCapped,        // true = 用户数已达统计上限，实际更多
        search: searchTotal.total,       // 搜索总次数
        view: viewTotal.total            // 浏览总次数
      },
      users: totalAgg.list.map(r => ({
        openid: r._id || '未知用户',
        total: r.total,
        search: searchMap[r._id] || 0,
        view: viewMap[r._id] || 0,
        lastTs: r.lastTs || 0
      }))
    };
  } catch (e) {
    // 集合不存在等情况：打印日志并返回空结果，前端正常展示"本月暂无访问记录"
    console.error('adminStats 聚合失败（可能集合尚未创建）：', e);
    return empty;
  }
};
