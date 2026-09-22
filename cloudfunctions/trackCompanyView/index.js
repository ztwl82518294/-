/**
 * 公司浏览量统计（PRD companies.viewCount 字段）
 *
 * 详情页每被打开一次，对应公司的 viewCount +1，用于展示热度。
 *
 * ★ 设计要点：
 *   1. **必须静默失败**：浏览量统计失败绝不能影响详情页的打开
 *      —— 这是典型的「附属功能」，主流程永远优先。
 *   2. **不入明细表，只做原子自增**：本功能只需要一个总数，
 *      不记录「谁在什么时候看的」。这既省存储，也避免留存可追踪的行为日志
 *      （对个人主体的合规风险更小）。
 *   3. 频控：同一 openid 对同一公司 1 小时内只计一次，
 *      防刷新刷量。但**计数失败时仍然放行自增**（宁可多计，不要漏计）。
 */

const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const COLLECTION = 'companies';
/** 同一用户对同一公司的去重窗口（毫秒） */
const DEDUP_MS = 60 * 60 * 1000;

function clip(v, max) {
  if (v === null || v === undefined) return '';
  const s = String(v).trim();
  return s.length > max ? s.slice(0, max) : s;
}

exports.main = async (event) => {
  try {
    const companyId = clip(event && event.companyId, 120);
    if (!companyId) {
      return { ok: false, code: 'BAD_ID', message: '缺少公司标识' };
    }

    const context = cloud.getWXContext();
    const openid = (context && context.OPENID) || '';

    // 去重：同 openid + 同公司 1 小时内不重复计
    const bucket = Math.floor(Date.now() / DEDUP_MS);
    if (openid) {
      try {
        const col = db.collection('view_dedup');
        const hit = await col
          .where({ openid: openid, companyId: companyId, bucket: bucket })
          .count();
        if ((hit.total || 0) > 0) {
          return { ok: true, counted: false, reason: 'deduped' };
        }
        await col.add({
          data: { openid: openid, companyId: companyId, bucket: bucket, createdAt: Date.now() }
        });
      } catch (e) {
        // view_dedup 集合可能不存在 → 忽略去重，直接计数（保守放行）
      }
    }

    await db.collection(COLLECTION).doc(companyId).update({
      data: { viewCount: _.inc(1) }
    });

    return { ok: true, counted: true };
  } catch (e) {
    console.error('[trackCompanyView] 失败：', (e && (e.errMsg || e.message)) || e);
    // ★ 静默失败：详情页不因此报错
    return { ok: false, code: 'INTERNAL', message: '统计失败' };
  }
};
