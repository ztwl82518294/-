#!/usr/bin/env node
/**
 * 把 /shared 与 /utils 里的共用模块同步进云函数目录（副本）
 *
 * ★ 为什么需要副本：微信开发者工具上传云函数时**只上传该云函数自己的目录**，
 *   不能 require 上级目录（require('../../shared/schema') 在云端会 MODULE_NOT_FOUND）。
 *   所以每个用到共用模块的云函数目录里必须放一份副本。
 *
 * ★ 为什么不手工复制：副本最容易发生的故障是**改了主仓库忘了同步** ——
 *   本地测试全绿（跑的是主仓库那份），云端却是旧逻辑，且不报错。
 *   所以：复制动作做成脚本，并且 `node scripts/sync-cloud-shared.js --check`
 *   会在副本与主仓库不一致时**非零退出**，可挂进自检流程。
 *
 * 用法：
 *   node scripts/sync-cloud-shared.js          同步（缺则建，异则覆盖）
 *   node scripts/sync-cloud-shared.js --check  只检查，有漂移就退出码 1
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/**
 * 需要同步的云函数。
 * ★ 新增云函数若用到 shared/ 或 utils/，必须把目录名加进来，
 *   否则本地能跑、上传后炸 —— 这个清单就是唯一的登记处。
 */
const TARGETS = ['adminApi'];

/** 源文件 → 云函数内的相对路径 */
const FILES = [
  'shared/schema.js',
  'shared/validate.js',
  'shared/import.js',
  'utils/common.js',
  'utils/search.js'
];

function readIfExists(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch (e) {
    return null;
  }
}

function main() {
  const checkOnly = process.argv.indexOf('--check') >= 0;
  const problems = [];
  let copied = 0;

  TARGETS.forEach((fn) => {
    const fnDir = path.join(ROOT, 'cloudfunctions', fn);
    if (!fs.existsSync(fnDir)) {
      problems.push('云函数目录不存在：cloudfunctions/' + fn);
      return;
    }

    FILES.forEach((rel) => {
      const src = path.join(ROOT, rel);
      const dst = path.join(fnDir, rel);

      const srcText = readIfExists(src);
      if (srcText === null) {
        problems.push('源文件缺失：' + rel);
        return;
      }
      const dstText = readIfExists(dst);

      if (srcText === dstText) return;

      if (checkOnly) {
        problems.push('副本与主仓库不一致：cloudfunctions/' + fn + '/' + rel);
        return;
      }

      fs.mkdirSync(path.dirname(dst), { recursive: true });
      // ★ 不加 BOM：微信侧与 Node 侧都按 UTF-8 读，带 BOM 会在小程序端炸
      fs.writeFileSync(dst, srcText, 'utf8');
      copied++;
    });
  });

  if (checkOnly) {
    if (problems.length) {
      console.log('❌ 云函数副本与主仓库不一致（' + problems.length + ' 处）：');
      problems.forEach((p) => console.log('   - ' + p));
      console.log('');
      console.log('修复：node scripts/sync-cloud-shared.js');
      process.exit(1);
    }
    console.log('✅ 云函数副本与主仓库一致（' + TARGETS.length + ' 个云函数 × ' + FILES.length + ' 个文件）');
    return;
  }

  if (problems.length) {
    problems.forEach((p) => console.log('⚠ ' + p));
  }
  console.log(
    copied
      ? '✅ 已同步 ' + copied + ' 个副本文件到 ' + TARGETS.join(' / ')
      : '✅ 云函数副本已是最新（无变化）'
  );
}

main();
