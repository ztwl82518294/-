/**
 * admin/lib/db.js —— 数据文件读写层
 *
 * ★ 本文件只做一件事：**把 JSON 读写到磁盘**。
 *   这里不允许出现任何业务判断（不改字段、不算统计、不做校验）。
 *   业务逻辑全部在 store.js，因为那样才能对 store 做纯函数测试。
 *
 * 为什么用「一个集合一个文件」而不是单文件 SQLite：
 *   数据量在千条级别（PRD 阶段三 C1 是 1000 条线路），JSON 完全够用，
 *   且能用 git diff 看出改了什么 —— 对单人运营的项目，可读性 > 性能。
 *
 * ★ 写盘必须是**原子**的：先写临时文件再 rename。
 *   直接 writeFileSync 覆盖有风险 —— 写一半断电就得到一个残缺的 JSON，
 *   下次启动直接崩。rename 在同一分区上是原子操作，不会出现半截文件。
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

/** 确保数据目录存在 */
function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

/** 集合名 → 文件绝对路径 */
function fileOf(name) {
  return path.join(DATA_DIR, String(name) + '.json');
}

/**
 * 读一个集合
 * ★ 文件不存在时返回空数组而不抛错 —— 首次启动、新增集合都靠这个行为。
 * @returns {Array}
 */
function read(name) {
  ensureDir();
  const p = fileOf(name);
  if (!fs.existsSync(p)) return [];
  try {
    const raw = fs.readFileSync(p, 'utf8');
    if (!raw.trim()) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    // ★ 读坏了不要静默返回 [] —— 那会让用户以为「数据没了」而重新录入。
    //   这里备份坏文件并抛错，让调用方明确知道发生了什么。
    const bak = p + '.broken-' + Date.now();
    try { fs.renameSync(p, bak); } catch (_) { /* 尽力而为 */ }
    throw new Error('数据文件解析失败（已备份到 ' + path.basename(bak) + '）：' + e.message);
  }
}

/**
 * 原子写一个集合
 * ★ 输出统一：2 空格缩进 + 末尾换行 + 无 BOM。
 *   尾部换行让 git diff 干净；2 空格缩进便于人直接看文件。
 */
function write(name, rows) {
  ensureDir();
  const p = fileOf(name);
  const tmp = p + '.tmp-' + process.pid;
  const text = JSON.stringify(Array.isArray(rows) ? rows : [], null, 2) + '\n';
  // 明确用 utf8 且不加 BOM（Windows 上默认行为不一致，必须写死）
  fs.writeFileSync(tmp, text, { encoding: 'utf8' });
  fs.renameSync(tmp, p);
  return true;
}

/** 列出所有已存在的数据文件 */
function listFiles() {
  ensureDir();
  return fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.endsWith('.json') && !/\.broken-/.test(f))
    .map((f) => ({ name: f.replace(/\.json$/, ''), size: fs.statSync(path.join(DATA_DIR, f)).size }));
}

/** 数据目录路径（供 UI 展示） */
function dir() {
  return DATA_DIR;
}

module.exports = { read, write, listFiles, fileOf, ensureDir, dir, DATA_DIR };
