// utils/vip.js
// VIP 有效性统一口径（前端侧）。
// 数据模型：lines.isVip(0/1) + lines.vipExpireAt(毫秒时间戳, 0/缺失=旧数据)。
// 有效会员 = isVip===1 且（vipExpireAt 缺失[兼容旧数据] 或 大于当前时间）。
// 服务端 searchLine 已做同样修正；本模块用于收藏快照、详情页等直接读库的场景。

function effectiveVip(line, now) {
  if (!line || line.isVip !== 1) return 0;
  if (!line.vipExpireAt) return 1; // 兼容迁移前旧数据
  return line.vipExpireAt > (now || Date.now()) ? 1 : 0;
}

// 就地修正列表中每条线路的 isVip 为有效口径，返回原数组
function applyEffectiveVip(list) {
  (list || []).forEach(l => { l.isVip = effectiveVip(l); });
  return list;
}

// 到期时间格式化 yyyy-MM-DD（无效返回空串）
function fmtDate(ts) {
  const n = Number(ts);
  if (!n || n <= 0) return '';
  const d = new Date(n);
  const p = x => (x < 10 ? '0' + x : '' + x);
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// 管理端展示：会员状态描述（未开通 / 会员至 yyyy-MM-DD / 已过期 yyyy-MM-DD）
function vipStatusText(line) {
  if (!line || line.isVip !== 1) return '未开通';
  const s = fmtDate(line.vipExpireAt);
  if (!s) return '会员（长期）';
  return line.vipExpireAt > Date.now() ? '会员至 ' + s : '已过期 ' + s;
}

module.exports = { effectiveVip, applyEffectiveVip, fmtDate, vipStatusText };
