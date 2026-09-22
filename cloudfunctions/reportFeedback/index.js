// cloudfunctions/reportFeedback/index.js
// 用户信息纠错反馈写入（服务端版）。
//
// 背景：纠错入口原先只弹一个说明框，引导用户去打客服电话/加微信——用户要
//      跳出小程序、切换 App，实际转化极低。改动后改为**站内表单**，用户
//      在小程序里直接写完提交，平台在后台集中核实（"核实后才会修改，
//      不会立即生效"）。
//
// 为什么必须走云函数、不能前端直写：
//   1. 防刷：任何人可用脚本高频提交，把反馈池灌满。服务端做单日频控。
//   2. 防脏：类型、说明长度、图片数量必须在服务端**再校验一次**，
//      前端校验只是体验优化，不能作为数据可信的依据。
//   3. _openid 由服务端显式注入（云函数写入不会自动注入），
//      便于后台识别"同一个人反复提交同一条"。
//
// 写入集合：feedback
//   { type, typeLabel, target, targetKey, targetKind, detail,
//     images: [fileID], contact, status, month, day, ts, _openid }
//   - status: 0=待处理（后台核实后自行改 1/2，本函数只写 0）
//
// action:
//   submit —— 提交一条反馈（默认，也是唯一动作）

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// ---- 服务端白名单：类型与前端 chips 一一对应 ----
// 为什么不信任前端传来的 typeLabel：label 是展示文案，若前端被篡改会把
// 任意字符串写进后台列表页，后台渲染时可能出现钓鱼文案。这里用映射表反查。
const TYPES = [
  { key: 'phone', label: '电话有误' },
  { key: 'closed', label: '公司已停业' },
  { key: 'cancelled', label: '线路已取消' },
  { key: 'incomplete', label: '信息不完整' },
  { key: 'other', label: '其他' }
];
const TYPE_MAP = TYPES.reduce((m, t) => { m[t.key] = t.label; return m; }, {});

// ---- 字段长度上限 ----
// detail 与前端 maxlength=200 保持一致：前端可被绕过，服务端必须兜住，
// 否则单条反馈可能塞进几 MB 文本把集合撑爆。
const DETAIL_MAX = 200;
const CONTACT_MAX = 60;
const TARGET_MAX = 80;
const KEY_MAX = 120;
const IMAGE_MAX = 3;          // 与前端"最多 3 张"一致
const IMAGE_ID_MAX = 300;     // 云存储 fileID 长度上限（防超长串注入）

// 单用户单日提交上限。正常用户发现多处错误一天提交几条，10 已很宽松；
// 脚本刷量是百/千级，10 足以拦住。与被限流时前端提示"今日提交过多"对应。
const DAILY_CAP = 10;

// 自愈建集合的 Promise 缓存（同 statLog 做法）：
// 成功后缓存，同实例内后续调用不再重复 createCollection。
let _colReady = null;
function ensureCollection() {
  if (!_colReady) {
    _colReady = db.createCollection('feedback').then(
      () => true,
      (e) => {
        // 已存在时报错属正常（-501001 之类），不能因此判定失败；
        // 真正的失败（如无权限）留给下面的 add 暴露，这里只清缓存。
        // 日志取 errMsg || message || 原始值，避免错误对象形态不同时打出 undefined。
        console.warn('reportFeedback 建集合返回：', (e && (e.errMsg || e.message)) || e);
        _colReady = null;
        return false;
      }
    );
  }
  return _colReady;
}

function pad(n) { return n < 10 ? '0' + n : '' + n; }

// 东八区当前时间 → { month: 'yyyy-MM', day: 'yyyy-MM-DD' }
// 与 stat_events 口径一致，后台可按同一维度聚合。
function eastEightNow() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const y = d.getUTCFullYear();
  const m = pad(d.getUTCMonth() + 1);
  return { month: y + '-' + m, day: y + '-' + m + '-' + pad(d.getUTCDate()) };
}

function str(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max);
}

// 图片 fileID 数组归一：只接受字符串、去空、去重、截断数量。
// 为什么去重：用户可能对同一张图连续"选择两次"，产生重复 fileID，
// 后台核实时会看到两条一样的图，干扰判断。
function normImages(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  const seen = new Set();
  for (let i = 0; i < v.length; i++) {
    const id = str(v[i], IMAGE_ID_MAX);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= IMAGE_MAX) break;
  }
  return out;
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  // 未取到 openid：不能静默写成"匿名反馈"——后台无法回查、也无法频控。
  if (!OPENID) return { ok: false, reason: 'no-openid', error: '身份校验失败，请重新进入小程序' };

  const action = event.action || 'submit';
  if (action !== 'submit') return { ok: false, reason: 'unknown-action', error: '不支持的操作' };

  // ---- 1. 类型校验（必填，且必须在白名单内）----
  const typeKey = str(event.type, 20);
  const typeLabel = TYPE_MAP[typeKey];
  if (!typeLabel) return { ok: false, reason: 'bad-type', error: '请选择问题类型' };

  // ---- 2. 具体说明（必填）----
  const detail = str(event.detail, DETAIL_MAX);
  if (!detail) return { ok: false, reason: 'bad-detail', error: '请填写具体说明' };

  // ---- 3. 其余可选项 ----
  const target = str(event.target, TARGET_MAX);        // 被反馈对象名（公司名/线路名）
  const targetKey = str(event.targetKey, KEY_MAX);     // 定位键（线路 _id / 公司名）
  const targetKind = event.targetKind === 'company' ? 'company' : 'line';
  const contact = str(event.contact, CONTACT_MAX);     // 联系方式（选填）
  const images = normImages(event.images);

  const { month, day } = eastEightNow();

  await ensureCollection();

  // ---- 4. 频控：同用户当日已提交数 ----
  // 计数失败时保守放行（宁多记勿漏记），与 statLog 同策略：
  // 频控是防刷手段，不该因为一次查询抖动就拦住正常用户。
  try {
    const cnt = await db.collection('feedback')
      .where({ _openid: OPENID, day: day })
      .count();
    if (cnt.total >= DAILY_CAP) {
      console.warn('reportFeedback 频控触发：', OPENID, day, cnt.total);
      return { ok: false, reason: 'rate-limited', error: '今日提交次数过多，请明天再试' };
    }
  } catch (e) {
    console.warn('reportFeedback 频控查询失败：', e && e.errMsg);
  }

  // ---- 5. 写入 ----
  try {
    const res = await db.collection('feedback').add({
      data: {
        type: typeKey,
        typeLabel: typeLabel,
        target: target,
        targetKey: targetKey,
        targetKind: targetKind,
        detail: detail,
        images: images,
        contact: contact,
        status: 0,        // 0=待处理；后台核实后自行改状态，本函数不改
        month: month,
        day: day,
        ts: Date.now(),
        _openid: OPENID   // 服务端显式注入
      }
    });
    return { ok: true, id: res._id };
  } catch (e) {
    console.error('reportFeedback 写入失败：', e && e.errMsg);
    return { ok: false, reason: 'write-failed', error: '提交失败，请稍后重试' };
  }
};
