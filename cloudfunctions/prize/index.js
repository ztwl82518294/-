// cloudfunctions/prize/index.js
// 兑奖码轻量版：月度活跃前 N 名生成兑奖码，用户凭码联系管理员核销。
// 集合 prize_codes 全部经本云函数读写（用户端不直连，默认权限即可，避免越权）。
// 中奖状态机：未核销(claimed=false) → 已核销(claimed=true) → 已发放(shipped=true)
// action:
//   myPrize  —— 普通用户：查自己的兑奖码/名次
//   generate —— 管理员：为指定月（默认上月）前 5 名幂等生成兑奖码
//   list     —— 管理员：查看某月兑奖码名单
//   verify   —— 管理员：输入兑奖码核销
//   update   —— 管理员：单条状态流转（op: ship 发放 / unship 撤销发放 / unclaim 撤销核销）
//   remove   —— 管理员：作废删除一条兑奖码
//   assign   —— 管理员：手动指定用户中奖（绕过榜单，按 openid 发码，manual 标记）
//   logs     —— 管理员：查看操作日志（最近 50 条，可按月份过滤）
// 所有管理员写操作均记录到 prize_logs 集合（操作人/对象/时间/中文描述）。

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const $ = db.command.aggregate;

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

const TOP_N = 5;

function pad(n) { return n < 10 ? '0' + n : '' + n; }
// 东八区当前自然月
function currentMonth() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1);
}
// 月份加减
function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1);
}

// 取某月活跃榜前 TOP_N（按操作总次数降序，与月度统计页口径一致）
async function topUsers(month) {
  const agg = await db.collection('stat_events').aggregate()
    .match({ month: month })
    .group({ _id: '$_openid', total: $.sum(1) })
    .sort({ total: -1 })
    .limit(TOP_N)
    .end();
  return agg.list;
}

// 生成 8 位兑奖码（去除易混淆字符 0/O、1/I）
function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 8; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}

// openid 脱敏展示（保留前6后4）
function mask(openid) {
  if (!openid) return '未知';
  return openid.length > 12 ? openid.slice(0, 6) + '****' + openid.slice(-4) : openid;
}

// 自愈建集合的 Promise 缓存：成功后同实例内复用，失败清空以便下次重试
let _colsReady = null;
function ensureCollections() {
  if (!_colsReady) {
    _colsReady = Promise.all([
      db.createCollection('prize_codes').catch(() => {}),
      db.createCollection('prize_logs').catch(() => {})
    ]).then(() => true, () => { _colsReady = null; return false; });
  }
  return _colsReady;
}

// 操作日志：失败不影响主流程（仅吞错打日志）
async function writeLog(entry) {
  try {
    await db.collection('prize_logs').add({ data: entry });
  } catch (e) {
    console.warn('操作日志写入失败：', e && e.errMsg);
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action || 'myPrize';
  const col = db.collection('prize_codes');
  // 自愈建集合（已存在时报错忽略；已建过则命中缓存，不再重复请求）
  await ensureCollections();

  // ===== 管理员：生成兑奖码（幂等：已生成过的用户不重复发码）=====
  if (action === 'generate') {
    if (!(await getAdmins()).includes(OPENID)) return { error: '无权限操作' };
    const month = event.month || shiftMonth(currentMonth(), -1);
    let top;
    try { top = await topUsers(month); } catch (e) {
      return { error: '统计数据读取失败（stat_events 集合可能尚未生成）' };
    }
    if (!top.length) return { error: '该月份暂无统计数据，无法生成兑奖码' };
    const list = [];
    let newCount = 0;
    for (let i = 0; i < top.length; i++) {
      const openid = top[i]._id;
      if (!openid) continue;
      const rank = i + 1;
      const exist = await col.where({ month, openid }).get();
      if (exist.data.length) { list.push(exist.data[0]); continue; }
      const doc = { month, openid, rank, code: genCode(), claimed: false, createdTs: Date.now() };
      await col.add({ data: doc });
      list.push(doc);
      newCount++;
    }
    await writeLog({
      ts: Date.now(), month, actor: OPENID, actorMask: mask(OPENID),
      op: 'generate', target: '', targetMask: '',
      desc: `生成${month}榜单兑奖码：本次新发 ${newCount} 个，累计 ${list.length} 个`
    });
    return { ok: true, month, count: list.length, list };
  }

  // ===== 管理员：兑奖码名单 =====
  if (action === 'list') {
    if (!(await getAdmins()).includes(OPENID)) return { error: '无权限操作' };
    const month = event.month || shiftMonth(currentMonth(), -1);
    const res = await col.where({ month }).orderBy('rank', 'asc').get();
    return { month, list: res.data };
  }

  // ===== 管理员：操作日志（默认最近 50 条，可按月份过滤）=====
  if (action === 'logs') {
    if (!(await getAdmins()).includes(OPENID)) return { error: '无权限操作' };
    let q = db.collection('prize_logs');
    if (event.month) q = q.where({ month: event.month });
    const res = await q.orderBy('ts', 'desc').limit(50).get().catch(() => ({ data: [] }));
    return { list: res.data };
  }

  // ===== 管理员：核销兑奖码 =====
  if (action === 'verify') {
    if (!(await getAdmins()).includes(OPENID)) return { error: '无权限操作' };
    const code = String(event.code || '').trim().toUpperCase();
    if (!code) return { error: '请输入兑奖码' };
    const res = await col.where({ code }).get();
    if (!res.data.length) return { error: '兑奖码无效，请核对' };
    // 出现重复码说明数据异常（本应唯一），此时不能随便取第一条，
    // 否则可能核销到另一个用户头上
    if (res.data.length > 1) return { error: '兑奖码存在重复，请联系技术处理' };
    const rec = res.data[0];
    const already = !!rec.claimed;
    if (!already) {
      await col.doc(rec._id).update({ data: { claimed: true, claimedTs: Date.now() } });
      // 补齐操作日志（文件头契约：所有管理员写操作均记录）
      await writeLog({
        ts: Date.now(), month: rec.month, actor: OPENID, actorMask: mask(OPENID),
        op: 'verify', target: rec.openid, targetMask: mask(rec.openid),
        desc: `核销兑奖码 ${rec.code}（${rec.month} 第${rec.rank}名）`
      });
    }
    return { ok: true, alreadyClaimed: already, record: { month: rec.month, rank: rec.rank, code: rec.code, claimed: true } };
  }

  // ===== 管理员：单条状态流转 =====
  if (action === 'update') {
    if (!(await getAdmins()).includes(OPENID)) return { error: '无权限操作' };
    const id = event.id;
    const op = event.op;
    if (!id || !op) return { error: '参数缺失' };
    const found = await col.doc(id).get().catch(() => null);
    const rec = found && found.data;
    if (!rec) return { error: '记录不存在' };
    const ts = Date.now();
    if (op === 'ship') {
      if (!rec.claimed) return { error: '未核销，不能标记发放' };
      await col.doc(id).update({ data: { shipped: true, shippedTs: ts } });
    } else if (op === 'unship') {
      await col.doc(id).update({ data: { shipped: false } });
    } else if (op === 'unclaim') {
      // 撤销核销：回到未核销，发放标记一并清除
      await col.doc(id).update({ data: { claimed: false, claimedTs: null, shipped: false, shippedTs: null } });
    } else {
      return { error: '未知操作' };
    }
    // 补齐操作日志（文件头契约：所有管理员写操作均记录，否则发放/撤销无从审计）
    await writeLog({
      ts, month: rec.month, actor: OPENID, actorMask: mask(OPENID),
      op, target: rec.openid, targetMask: mask(rec.openid),
      desc: `${op === 'ship' ? '标记发放' : op === 'unship' ? '撤销发放' : '撤销核销'}：${rec.code}（${rec.month} 第${rec.rank}名）`
    });
    return { ok: true };
  }

  // ===== 管理员：作废删除一条 =====
  if (action === 'remove') {
    if (!(await getAdmins()).includes(OPENID)) return { error: '无权限操作' };
    if (!event.id) return { error: '参数缺失' };
    // 先取记录用于日志（删除后无法再读）
    const found = await col.doc(event.id).get().catch(() => null);
    const rec = found && found.data;
    await col.doc(event.id).remove();
    if (rec) {
      await writeLog({
        ts: Date.now(), month: rec.month, actor: OPENID, actorMask: mask(OPENID),
        op: 'remove', target: rec.openid, targetMask: mask(rec.openid),
        desc: `作废兑奖码 ${rec.code}（${rec.month} 第${rec.rank}名）`
      });
    }
    return { ok: true };
  }

  // ===== 管理员：手动指定用户中奖（按 openid 发码，与榜单无关）=====
  if (action === 'assign') {
    if (!(await getAdmins()).includes(OPENID)) return { error: '无权限操作' };
    const targetOpenid = String(event.openid || '').trim();
    if (!targetOpenid) return { error: '请输入用户 openid' };
    const month = event.month || shiftMonth(currentMonth(), -1);
    // 幂等：同月同一用户只能有一个码
    const exist = await col.where({ month, openid: targetOpenid }).get();
    if (exist.data.length) return { error: '该用户本月已有兑奖码，请勿重复发放' };
    const doc = {
      month, openid: targetOpenid,
      rank: 99, manual: true,          // rank 99 = 榜外特批，名单排序靠后
      code: genCode(), claimed: false,
      createdTs: Date.now()
    };
    await col.add({ data: doc });
    await writeLog({
      ts: Date.now(), month, actor: OPENID, actorMask: mask(OPENID),
      op: 'assign', target: targetOpenid, targetMask: mask(targetOpenid),
      desc: `手动指定中奖：${mask(targetOpenid)}（${month}），兑奖码 ${doc.code}`
    });
    return { ok: true, code: doc.code, month };
  }

  // ===== 普通用户：我的兑奖码/名次 =====
  // OPENID 为空（定时触发器/控制台调用）时 where 条件会退化，可能命中 openid 为 null 的脏文档
  // 而把别人的兑奖码返回出去，这里必须先拦一道
  if (!OPENID) return { error: '无法识别用户身份' };
  const mine = await col.where({ openid: OPENID }).orderBy('createdTs', 'desc').limit(1).get();
  if (mine.data.length) {
    const r = mine.data[0];
    return { hasCode: true, month: r.month, rank: r.rank, manual: !!r.manual, code: r.code, claimed: !!r.claimed, shipped: !!r.shipped };
  }
  // 无码：返回上月名次供展示
  const month = shiftMonth(currentMonth(), -1);
  let rank = 0, total = 0, totalUsers = 0;
  try {
    const all = await db.collection('stat_events').aggregate()
      .match({ month })
      .group({ _id: '$_openid', total: $.sum(1) })
      .sort({ total: -1 })
      .limit(1000)
      .end();
    totalUsers = all.list.length;
    const idx = all.list.findIndex(u => u._id === OPENID);
    if (idx >= 0) { rank = idx + 1; total = all.list[idx].total; }
  } catch (e) { /* 无数据 */ }
  return { hasCode: false, month, rank, total, totalUsers, topN: TOP_N };
};
