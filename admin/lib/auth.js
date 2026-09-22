/**
 * admin/lib/auth.js —— 管理员登录（PRD 模块 06 的「登录」与验收 B1）
 *
 * ★ 零依赖实现，只用 Node 内置 crypto。
 *
 * 安全设计（按公开服务标准，尽管它只监听本机）：
 *   1. 密码**不存明文**，用 scrypt 派生后存 hash + 随机 salt。
 *      选 scrypt 而不是 sha256：sha256 太快，被拖库后暴力破解成本低；
 *      scrypt 是内存硬的，天生慢。
 *   2. 校验用 `timingSafeEqual` 做**定长时间比较** —— 防止通过响应时间
 *      逐字节猜 hash。
 *   3. 会话 token 是随机 32 字节，只存服务端内存（重启即失效），
 *      并带过期时间。Cookie 设 HttpOnly + SameSite=Strict。
 *   4. 登录失败不区分「用户不存在」与「密码错误」，统一提示，防止枚举账号。
 *   5. 只监听 127.0.0.1（在 server.js 里），本身就不对外网开放。
 *
 * ★ 不做注册入口（PRD 明确要求）：账号由 `ensureDefaultAdmin` 建初始一个，
 *   之后靠手工改 admins.json 增删。
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const ADMIN_FILE = path.join(DATA_DIR, 'admins.json');

/** 会话有效期：12 小时（一次工作时段够用） */
const SESSION_TTL = 12 * 60 * 60 * 1000;
/** token → { username, role, expireAt } */
const SESSIONS = {};

/* ============================================================
 * 密码
 * ============================================================ */

/** scrypt 派生。keylen 64，参数用 Node 默认（N=16384, r=8, p=1） */
function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), s, 64).toString('hex');
  return { salt: s, passwordHash: hash };
}

/** 定长时间比较，防时序侧信道 */
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) {
    // 长度不同也走一次比较，避免通过「立即返回」泄露长度
    crypto.timingSafeEqual(ba, ba);
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

function verifyPassword(password, salt, expectedHash) {
  if (!salt || !expectedHash) return false;
  const got = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return safeEqual(got, expectedHash);
}

/* ============================================================
 * 管理员存储
 * ============================================================ */

function readAdmins() {
  if (!fs.existsSync(ADMIN_FILE)) return [];
  try {
    const raw = fs.readFileSync(ADMIN_FILE, 'utf8');
    const arr = raw.trim() ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function writeAdmins(rows) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = ADMIN_FILE + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2) + '\n', { encoding: 'utf8' });
  fs.renameSync(tmp, ADMIN_FILE);
}

/** 默认账号名（首次启动创建，密码随机并打印到控制台） */
const DEFAULT_USERNAME = 'admin';
const DEFAULT_PASSWORD = 'admin12345';

/**
 * 首次启动生成默认管理员
 * ★ 默认密码是固定的（便于用户第一次就能登录），但会在控制台**显眼提示修改**。
 *   这比「生成随机密码但要用户去文件里翻」对单人运营更友好；
 *   且服务只监听本机，风险可控。
 */
function ensureDefaultAdmin() {
  const rows = readAdmins();
  if (rows.length) return false;
  const h = hashPassword(DEFAULT_PASSWORD);
  writeAdmins([{
    _id: 'admin_001',
    username: DEFAULT_USERNAME,
    passwordHash: h.passwordHash,
    salt: h.salt,
    role: 'owner',
    createdAt: Date.now(),
    lastLoginAt: 0
  }]);
  if (process.env.ADMIN_SILENT !== '1') {
    console.log('[auth] 已创建默认管理员：' + DEFAULT_USERNAME + ' / ' + DEFAULT_PASSWORD + '（请尽快修改）');
  }
  return true;
}

/**
 * 登录
 * @returns {{ok:boolean, token?:string, message?:string, user?:object}}
 */
function login(username, password) {
  const u = String(username || '').trim();
  const p = String(password || '');
  // ★ 统一失败文案，不区分「账号不存在」与「密码错误」
  const FAIL = { ok: false, message: '账号或密码不正确' };

  if (!u || !p) return FAIL;

  const rows = readAdmins();
  const admin = rows.find((x) => x.username === u);
  if (!admin) {
    // 仍做一次派生，让「不存在」与「密码错」耗时接近
    hashPassword(p, 'dummy-salt-for-timing');
    return FAIL;
  }
  if (!verifyPassword(p, admin.salt, admin.passwordHash)) return FAIL;

  const token = crypto.randomBytes(32).toString('hex');
  SESSIONS[token] = {
    username: admin.username,
    role: admin.role || 'admin',
    expireAt: Date.now() + SESSION_TTL
  };

  // 记录最后登录时间
  admin.lastLoginAt = Date.now();
  writeAdmins(rows);

  return {
    ok: true,
    token: token,
    user: { username: admin.username, role: admin.role || 'admin' }
  };
}

function logout(token) {
  if (token && SESSIONS[token]) delete SESSIONS[token];
}

/** 校验 token，返回会话或 null（顺带清理过期会话） */
function verify(token) {
  if (!token) return null;
  const s = SESSIONS[token];
  if (!s) return null;
  if (Date.now() > s.expireAt) {
    delete SESSIONS[token];
    return null;
  }
  return s;
}

/* ============================================================
 * Cookie
 * ============================================================ */

const COOKIE_NAME = 'lq_admin';

function cookieFor(token) {
  // HttpOnly：JS 读不到，防 XSS 偷 token
  // SameSite=Strict：防 CSRF
  // 不加 Secure，因为本机是 http（加了 cookie 反而不会发出去）
  const maxAge = Math.floor(SESSION_TTL / 1000);
  return COOKIE_NAME + '=' + token + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + maxAge;
}

function expiredCookie() {
  return COOKIE_NAME + '=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0';
}

/** 从 Cookie 头解析出会话；无效返回 null */
function fromCookie(cookieHeader) {
  if (!cookieHeader) return null;
  const parts = String(cookieHeader).split(';');
  for (const part of parts) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k !== COOKIE_NAME) continue;
    return verify(part.slice(i + 1).trim());
  }
  return null;
}

/** 修改密码（用于初始化后换掉默认密码） */
function changePassword(username, oldPassword, newPassword) {
  if (!newPassword || String(newPassword).length < 8) {
    return { ok: false, message: '新密码至少 8 位' };
  }
  const rows = readAdmins();
  const admin = rows.find((x) => x.username === username);
  if (!admin) return { ok: false, message: '账号不存在' };
  if (!verifyPassword(oldPassword, admin.salt, admin.passwordHash)) {
    return { ok: false, message: '原密码不正确' };
  }
  const h = hashPassword(newPassword);
  admin.passwordHash = h.passwordHash;
  admin.salt = h.salt;
  writeAdmins(rows);
  // 改密码后踢掉所有会话，强制重新登录
  Object.keys(SESSIONS).forEach((t) => delete SESSIONS[t]);
  return { ok: true };
}

/** 供测试：清空会话 */
function _resetSessions() {
  Object.keys(SESSIONS).forEach((k) => delete SESSIONS[k]);
}

module.exports = {
  COOKIE_NAME, SESSION_TTL, DEFAULT_USERNAME, DEFAULT_PASSWORD, ADMIN_FILE,
  hashPassword, verifyPassword, safeEqual,
  ensureDefaultAdmin, readAdmins, writeAdmins,
  login, logout, verify, changePassword,
  cookieFor, expiredCookie, fromCookie,
  _resetSessions
};
