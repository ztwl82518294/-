#!/usr/bin/env node
/**
 * 一键进入管理后台
 *
 * 用法：
 *   node scripts/start-admin.js
 * 或双击项目根目录的 start-admin.bat
 *
 * ★ 为什么要单独有个启动入口：
 *   后台的真实启动命令是 `node admin/server.js`，但那要求人先知道
 *   「项目根目录在哪、端口是多少、起来之后要打开哪个网址」。
 *   这个脚本把这些都包掉：起服务 → 等服务真的能连上 → 自动打开浏览器。
 *
 * ★ 两条容易踩的边界，这里都处理了：
 *   1. **端口已被占用**：说明后台已经在跑。此时不再启动第二个实例
 *      （否则子进程会 EADDRINUSE 崩掉，而用户只看到一堆红色报错），
 *      直接把浏览器指过去就行。
 *   2. **服务起来了 ≠ 能访问**：listen 回调和真正能连上之间还有一点间隔，
 *      直接开浏览器偶尔会吃到「无法访问此页面」。所以这里用 TCP 轮询探活，
 *      探到能连上再开。
 *
 * ★ 零依赖：只用 Node 内置模块，和 admin/ 保持一致。
 */

const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'admin', 'server.js');
const PORT = Number(process.env.ADMIN_PORT || 8787);
const HOST = '127.0.0.1';
const URL = 'http://' + HOST + ':' + PORT + '/';

/** 探一次端口是否能连上（只要 TCP 握手成功就算通） */
function probe() {
  return new Promise((resolve) => {
    const sock = net.connect({ host: HOST, port: PORT });
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(v);
    };
    sock.on('connect', () => done(true));
    sock.on('error', () => done(false));
    sock.setTimeout(600, () => done(false));
  });
}

/** 轮询等到能连上，或超时返回 false */
async function waitReady(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

/**
 * 用系统默认浏览器打开
 * ★ Windows 上 `start` 是 cmd 的**内部命令**，不是可执行文件，
 *   所以必须 `cmd /c start "" <url>`（那个空字符串是窗口标题，少了会把 url 当标题）。
 */
function openBrowser(url) {
  // --no-open / ADMIN_NO_OPEN=1：只起服务不开浏览器（无人值守、远程桌面等场景用）
  if (process.env.ADMIN_NO_OPEN === '1' || process.argv.indexOf('--no-open') >= 0) {
    console.log('  （已指定 --no-open，未自动打开浏览器，请手动访问 ' + url + '）');
    return;
  }
  const plat = process.platform;
  try {
    if (plat === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    } else if (plat === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch (e) {
    // 打不开浏览器不影响后台本身，提示一下让用户自己开就行
    console.log('  （没能自动打开浏览器，请手动访问 ' + url + '）');
  }
}

function banner(already) {
  console.log('');
  console.log('物流专线查询 · 管理后台');
  console.log('  网址 ' + URL + (already ? '（已在运行，未重复启动）' : ''));
  console.log('  默认账号 admin / admin12345 —— 登录后请到右上角「改密码」换掉');
  console.log('  数据目录 admin/data/  ·  仅监听本机，不对外网开放');
  console.log('  停止服务：在这个窗口按 Ctrl + C');
  console.log('');
}

async function main() {
  /* 已经在跑：不重复启动，直接打开 */
  if (await probe()) {
    banner(true);
    openBrowser(URL);
    return;
  }

  console.log('正在启动管理后台…');

  /*
   * ★ 用 process.execPath 而不是 'node'：
   *   本机 PATH 是坏的（连 dirname / ls 都找不到），'node' 未必能解析。
   *   而当前进程一定是 node，它的绝对路径最可靠。
   */
  const child = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    stdio: 'inherit',
    env: Object.assign({}, process.env, { ADMIN_PORT: String(PORT) })
  });

  const ready = await waitReady(15000);
  if (!ready) {
    console.error('');
    console.error('启动超时：15 秒内没能连上 ' + URL);
    console.error('  常见原因：数据目录被写坏（服务起不来会直接抛错，看上面的报错）');
    console.error('  修复：node scripts/export-seed.js --admin-only');
    console.error('');
    try { child.kill(); } catch (e) { /* 已经退出了 */ }
    process.exit(1);
  }

  banner(false);
  openBrowser(URL);

  /* 服务进程跟着本脚本一起退出，避免关掉窗口后留下个孤儿进程占着端口 */
  child.on('exit', (code) => process.exit(code == null ? 0 : code));
  process.on('SIGINT', () => {
    try { child.kill(); } catch (e) { /* 已经退出了 */ }
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    try { child.kill(); } catch (e) { /* 已经退出了 */ }
    process.exit(0);
  });
}

main().catch((e) => {
  console.error('启动后台失败：', e && e.message ? e.message : e);
  process.exit(1);
});
