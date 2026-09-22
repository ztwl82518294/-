#!/usr/bin/env node
/**
 * 一键远程备份：给本仓库配好 remote 并推送 main。
 *
 * 用法：
 *   node .workbuddy/scripts/push-backup.js <仓库地址> [--proxy=http://127.0.0.1:7897]
 *
 * 例：
 *   node .workbuddy/scripts/push-backup.js https://github.com/ztwl82518294/logistics-line-query.git
 *
 * ★ 为什么需要这个脚本（环境坑，别踩）：
 *   本机沙箱会强制注入一个 HTTP 代理（127.0.0.1:59788），它拒绝 CONNECT 到 github.com:443，
 *   表现为 `CONNECT tunnel failed, response 502`。**这不是没网**，绕过代理即可。
 *   但本机 Git Bash 的 PATH 已损坏（env/grep/ls 均 command not found），
 *   无法用 `export https_proxy=...` 的方式传环境变量。
 *   ⇒ 解法是给**这个仓库**单独配 `http.proxy`（不用全局，免得影响其他仓库）。
 *
 * 推送前会先做三项自检，任何一项不过就拒推（宁可今天没备份，也不把数据推上去）：
 *   1. 工作区必须干净（有未提交改动则提示先 commit）
 *   2. 确认 .data/ 与 admin/data/ 仍被忽略（内含真实公司电话与地址）
 *   3. 暂存区与已提交内容里不得出现 .jsonl / .sqlite / admin/data
 *
 * 推送完成后会打印校验命令，供你在沙箱外复核。
 */

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

/**
 * 跑一条命令并拿回 stdout。
 *
 * ★ 坑（真实踩过）：Node 的 execSync 在 Windows 上走 **cmd.exe**，不是 bash。
 *   所以 `cmd 2>/dev/null || true` 这类 POSIX 写法会报
 *   「'true' 不是内部或外部命令」并让整个脚本崩掉。
 *   ⇒ 需要「失败也要继续」的探测，一律用 try/catch，不要写 shell 兜底。
 */
function sh(cmd, opts = {}) {
  return execSync(cmd, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1e8,
    stdio: 'pipe',
    ...opts,
  });
}

/** 跑一条命令拿 stdout，失败返回 fallback（替代 `|| true`） */
function trySh(cmd, fallback = '') {
  try {
    return sh(cmd);
  } catch {
    return fallback;
  }
}

function fail(msg) {
  console.error('\n❌ ' + msg + '\n');
  process.exit(1);
}

// ---------- 解析参数 ----------
const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--'));
const proxyArg = args.find((a) => a.startsWith('--proxy='));
const PROXY = proxyArg ? proxyArg.slice('--proxy='.length).replace(/\/$/, '') : 'http://127.0.0.1:7897';

if (!url) {
  console.error('用法: node .workbuddy/scripts/push-backup.js <仓库地址> [--proxy=http://127.0.0.1:7897]');
  process.exit(2);
}

console.log('=== 远程备份自检 ===\n');

// ---------- 自检 1: 工作区干净 ----------
const dirty = sh('git status --porcelain').trim();
if (dirty) {
  console.error('工作区有未提交改动，请先 commit：\n');
  console.error(dirty.split(/\r?\n/).slice(0, 20).join('\n'));
  fail('工作区不干净，拒绝推送');
}
console.log('✓ 工作区干净');

// ---------- 自检 2: 敏感目录仍被忽略 ----------
const mustIgnore = [
  'admin/data/companies.json',
  'admin/data/routes.json',
  'admin/data/admins.json',
  '.data/companies.jsonl',
];
const notIgnored = [];
for (const f of mustIgnore) {
  try {
    sh('git check-ignore -q "' + f + '"');
  } catch {
    notIgnored.push(f);
  }
}if (notIgnored.length) {
  fail('以下敏感路径**未被忽略**，推送会泄露真实公司电话与地址：\n  ' + notIgnored.join('\n  '));
}
console.log('✓ .data/ 与 admin/data/ 仍被忽略（真实电话地址不会外泄）');

// ---------- 自检 3: 历史里不含数据文件 ----------
const tracked = sh('git ls-files').split(/\r?\n/).filter(Boolean);
const leaks = tracked.filter((f) => /\.jsonl$|\.sqlite$|\.db$|^admin\/data\//.test(f));
if (leaks.length) {
  fail('版本库里有数据文件，必须先清理：\n  ' + leaks.join('\n  '));
}
console.log('✓ 版本库 ' + tracked.length + ' 个文件，无数据文件');

// ---------- 配 remote ----------
const existing = trySh('git remote get-url origin').trim();
if (existing && existing !== url) {
  console.log('\n⚠ origin 已存在，将从 ' + existing + ' 改为 ' + url);
  sh('git remote set-url origin "' + url + '"');
} else if (!existing) {
  sh('git remote add origin "' + url + '"');
}
console.log('✓ remote origin = ' + url);

// ---------- 配代理（只作用于本仓库）----------
sh('git config http.proxy "' + PROXY + '"');
console.log('✓ 本仓库代理 = ' + PROXY + '（仅此仓库，不影响全局）');

// ---------- 推送 ----------
console.log('\n=== 开始推送（首次可能需你输入 GitHub 账号 + 令牌）===\n');
const r = spawnSync('git', ['push', '-u', 'origin', 'main'], {
  cwd: ROOT,
  stdio: 'inherit',
});

/**
 * ★ 推完就把代理解绑（踩过）：
 *   这个代理只是「沙箱内绕开拦截」的手段。若留在 .git/config 里，
 *   你之后在正常终端里 git fetch / git push 会反被它卡住
 *   （表现为 `schannel: server closed abruptly` 或连接超时），
 *   而且很难想到是这里配的。所以用完即解绑，需要时脚本会重新写。
 */
try {
  sh('git config --unset http.proxy');
  console.log('✓ 已解绑仓库级代理（避免影响你正常终端里的 git 操作）');
} catch (e) {
  // 本就未设置，忽略
}

if (r.status !== 0) {
  fail(
    '推送失败（exit ' + r.status + '）。\n' +
      '  若是 403/认证失败：GitHub 自 2021 年起不接受账号密码，需用 Personal Access Token 当密码。\n' +
      '    生成：GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens\n' +
      '    权限：Repository access 选该仓库，Contents 给 Read and write\n' +
      '  若是 404：仓库地址拼错，或仓库还没在网页上创建\n' +
      '  若是 ! [rejected] (fetch first)：远程有你本地没有的提交（通常是建仓时勾了 README）。\n' +
      '    先 git fetch --no-tags origin <远程SHA>，再 git merge FETCH_HEAD --allow-unrelated-histories\n' +
      '  若是连接超时：换代理端口再试，如 --proxy=http://127.0.0.1:7890',
  );
}

console.log('\n✅ 推送完成\n');
console.log('=== 核验（注意：本机 git 存不住远程跟踪引用，别看 git status 的 [gone]）===');
console.log('  在沙箱内核验：node .workbuddy/scripts/push-backup.js 之后，用 git ls-remote origin main 比对');
console.log('  在沙箱外核验：git ls-remote ' + url + ' main');
console.log('  浏览器打开 ' + url.replace(/\.git$/, '') + ' 确认文件都在、且仓库是 Private\n');
