/**
 * 纠错相关工具
 *
 * 两件事：
 *   1. 前端限频（体验层，真防线在云函数）
 *   2. 云存储路径生成
 *
 * ★ 为什么前端限频不算安全机制：
 *   本地存储可以被清除、可以被改代码绕过。它只用来给用户「即时反馈」，
 *   省掉一次注定失败的往返。真正的防线是服务端按 openid 计的频次。
 */

const KEY = 'correction_submit_log_v1';
const DAY_MS = 24 * 60 * 60 * 1000;

/** 同一目标单日最多提交次数（与服务端保持一致，改一处必改两处） */
const DAILY_PER_TARGET = 3;

/** 读取本地提交日志 { targetId: [ts, ts, ...] } */
function readLog() {
  try {
    const v = wx.getStorageSync(KEY);
    return v && typeof v === 'object' ? v : {};
  } catch (e) {
    return {};
  }
}

function writeLog(log) {
  try {
    wx.setStorageSync(KEY, log);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 检查是否已超额
 * @param {string} targetId
 * @returns {{ok:boolean, count:number}}
 */
function checkLocalLimit(targetId) {
  const key = String(targetId || '__none__');
  const log = readLog();
  const now = Date.now();
  const recent = (log[key] || []).filter((t) => now - Number(t) < DAY_MS);
  if (recent.length >= DAILY_PER_TARGET) {
    return { ok: false, count: recent.length };
  }
  return { ok: true, count: recent.length };
}

/** 记一次提交 */
function markLocalSubmitted(targetId) {
  const key = String(targetId || '__none__');
  const log = readLog();
  const now = Date.now();
  const recent = (log[key] || []).filter((t) => now - Number(t) < DAY_MS);
  recent.push(now);
  log[key] = recent;
  // 顺手清理超过 7 天的记录，防存储无限增长
  Object.keys(log).forEach((k) => {
    log[k] = (log[k] || []).filter((t) => now - Number(t) < 7 * DAY_MS);
    if (!log[k].length) delete log[k];
  });
  writeLog(log);
}

/** 云存储目录：corrections/yyyy-MM-dd/ 便于后台按天归类与定期清理 */
function todayPath() {
  const d = new Date();
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

module.exports = {
  DAILY_PER_TARGET,
  checkLocalLimit,
  markLocalSubmitted,
  todayPath
};
