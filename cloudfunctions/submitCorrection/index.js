/**
 * 提交纠错（PRD 模块 05）
 *
 * ★ 本云函数是**唯一对外的写接口**，按公开接口标准设计防护：
 *   1. 无 openid 直接拒绝（不信任前端）
 *   2. action 白名单
 *   3. 类型白名单**反查**：只接受枚举 key，label 由服务端自己查表，
 *      绝不信任前端传来的 label（防伪造「官方已核实」这类字样）
 *   4. 所有字段长度在服务端**再截断一次**（前端 maxlength 可被绕过）
 *   5. 频控：同一 openid 对同一 target 单日上限，超限拒绝
 *   6. 异常不抛穿：统一返回 { ok:false, code, message }，
 *      避免把堆栈信息暴露给调用方
 *
 * 集合：corrections（PRD 附录）
 * 字段：targetType / targetId / targetSummary / type / content /
 *       images / contact / openid / status / createdAt
 */

const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const COLLECTION = 'corrections';

/** 纠错类型白名单（与 shared/schema.js 的 CORRECTION_TYPES 保持一致） */
const TYPE_MAP = {
  phone_wrong: '电话有误',
  company_closed: '公司已停业',
  route_gone: '线路已取消',
  incomplete: '信息不完整',
  other: '其他'
};

/** 目标类型白名单 */
const TARGET_TYPES = ['company', 'route_company', 'other'];

/* 长度上限（前端也有 maxlength，这里是真防线） */
const LIMIT = {
  targetId: 120,
  targetSummary: 200,
  content: 300,
  contact: 60,
  imageId: 300
};

const IMAGE_MAX = 3;
/** 同一 openid 对同一 target 单日提交上限（与 utils/correction.js 的 DAILY_PER_TARGET 一致） */
const DAILY_PER_TARGET = 3;
/** 同一 openid 单日总提交上限（防换 target 刷） */
const DAILY_TOTAL = 20;

/** 东八区当日 yyyy-MM-dd */
function today() {
  const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
}

/** 截断字符串（非字符串返回空串） */
function clip(v, max) {
  if (v === null || v === undefined) return '';
  const s = String(v).trim();
  return s.length > max ? s.slice(0, max) : s;
}

/** 图片列表归一：只留字符串、去重、截断、限制张数 */
function normImages(v) {
  if (!Array.isArray(v)) return [];
  const seen = new Set();
  const out = [];
  for (const x of v) {
    if (typeof x !== 'string') continue;
    const s = x.trim().slice(0, LIMIT.imageId);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= IMAGE_MAX) break;
  }
  return out;
}

/** 集合自愈：首次部署时集合可能不存在，这里尝试建一次（失败不阻塞） */
let ensured = false;
async function ensureCollection() {
  if (ensured) return;
  try {
    await db.createCollection(COLLECTION);
  } catch (e) {
    // 已存在（-501001 / ResourceExists）或权限不足都忽略
  }
  ensured = true;
}

function ok(data) {
  return Object.assign({ ok: true }, data || {});
}

function bad(code, message) {
  return { ok: false, code: code, message: message };
}

exports.main = async (event) => {
  const context = cloud.getWXContext();
  const openid = context && context.OPENID;

  // 关 1：无 openid 直接拒
  if (!openid) {
    return bad('NO_OPENID', '无法识别用户身份，请在小程序内提交');
  }

  const action = (event && event.action) || 'submit';
  if (action !== 'submit') {
    return bad('BAD_ACTION', '不支持的操作');
  }

  try {
    // 关 2：类型白名单反查（不信任前端的 typeLabel）
    const typeKey = clip(event.type, 40);
    /*
     * ★★ 必须 hasOwnProperty，不能只判 `TYPE_MAP[typeKey]` 的真假：
     *   'constructor' / '__proto__' / 'toString' 这些键**不在表里**，
     *   但 `TYPE_MAP['constructor']` 会顺着原型链取到 Object 构造函数（真值）
     *   ⇒ 白名单形同虚设，伪造类型能写进库（typeLabel 会变成一段函数）。
     *   这条由 submitCorrection.test.js 的「未知 type → BAD_TYPE」守着，
     *   但只有框架修好异步统计后才真的跑得到。
     */
    if (!Object.prototype.hasOwnProperty.call(TYPE_MAP, typeKey)) {
      return bad('BAD_TYPE', '请选择问题类型');
    }
    const typeLabel = TYPE_MAP[typeKey];

    // 关 3：目标类型
    const targetType = clip(event.targetType, 40);
    if (TARGET_TYPES.indexOf(targetType) < 0) {
      return bad('BAD_TARGET_TYPE', '反馈对象类型不正确');
    }

    // 关 4：说明必填 + 服务端截断
    const content = clip(event.content, LIMIT.content);
    if (!content) {
      return bad('EMPTY_CONTENT', '请填写具体说明');
    }

    const targetId = clip(event.targetId, LIMIT.targetId);
    const targetSummary = clip(event.targetSummary, LIMIT.targetSummary);
    const contact = clip(event.contact, LIMIT.contact);
    const images = normImages(event.images);

    // 关 5：频控（计数失败时保守放行 —— 宁可漏拦一次，不要误伤正常用户）
    const day = today();
    try {
      const sameTarget = await db
        .collection(COLLECTION)
        .where({ openid: openid, targetId: targetId, day: day })
        .count();
      if ((sameTarget.total || 0) >= DAILY_PER_TARGET) {
        return bad('RATE_LIMITED', '你对这条记录的反馈我们已经收到，正在核实中，请勿重复提交');
      }

      const total = await db
        .collection(COLLECTION)
        .where({ openid: openid, day: day })
        .count();
      if ((total.total || 0) >= DAILY_TOTAL) {
        return bad('RATE_LIMITED', '今日反馈次数已达上限，请明天再试');
      }
    } catch (e) {
      // 计数失败不阻断提交（保守放行）
    }

    await ensureCollection();

    const now = Date.now();
    const res = await db.collection(COLLECTION).add({
      data: {
        targetType: targetType,
        targetId: targetId,
        targetSummary: targetSummary,
        type: typeKey,
        typeLabel: typeLabel,       // 服务端查表得到的 label，非前端传入
        content: content,
        images: images,
        contact: contact,
        openid: openid,
        status: 'pending',          // pending / accepted / rejected / hold
        day: day,                   // 频控索引字段
        createdAt: now
      }
    });

    return ok({ id: (res && res._id) || '' });
  } catch (e) {
    // 关 6：异常不抛穿，只回笼统提示（不暴露堆栈）
    console.error('[submitCorrection] 失败：', (e && (e.errMsg || e.message)) || e);
    return bad('INTERNAL', '提交失败，请稍后重试');
  }
};
