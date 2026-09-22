#!/usr/bin/env node
/**
 * check-bom.js —— 扫描项目源文件是否被写入 UTF-8 BOM
 *
 * 背景：Windows PowerShell 5.1 的 Out-File / Set-Content 默认输出
 *      UTF-8 with BOM（EF BB BF）。微信小程序 WXSS/WXML/JS 编译器
 *      不跳过 BOM，会在第 1 行第 1 列报 `unexpected '\uFEFF'`。
 *
 * 用法：node .workbuddy/scripts/check-bom.js
 * 退出码：0 = 干净；1 = 发现 BOM（CI / 提交前可据此拦截）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const EXTS = new Set(['.wxss', '.wxml', '.js', '.json', '.wxs', '.ts', '.md']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'miniprogram_npm']);

const found = [];
let scanned = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      // 备份目录里保留的是"修复前的带 BOM 副本"，属于有意留存，跳过
      if (entry.name.startsWith('backup-bom-')) continue;
      walk(path.join(dir, entry.name));
    } else if (entry.isFile()) {
      if (!EXTS.has(path.extname(entry.name))) continue;
      scanned++;
      const full = path.join(dir, entry.name);
      const fd = fs.openSync(full, 'r');
      const buf = Buffer.alloc(3);
      const n = fs.readSync(fd, buf, 0, 3, 0);
      fs.closeSync(fd);
      if (n >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
        found.push(path.relative(ROOT, full));
      }
    }
  }
}

walk(ROOT);

console.log(`扫描 ${scanned} 个源文件（已排除 node_modules / .git / backup-bom-*）`);
if (found.length === 0) {
  console.log('OK 未发现 UTF-8 BOM，可安全提交。');
  process.exit(0);
}

console.log(`\n失败 发现 ${found.length} 个文件带 UTF-8 BOM（会导致小程序编译报错）：`);
for (const f of found) console.log(`  - ${f}`);
console.log('\n修复方式（逐文件，不产生新 BOM）：');
console.log('  PS> $p="<路径>"; $b=[IO.File]::ReadAllBytes($p)');
console.log('      [IO.File]::WriteAllBytes($p, $b[3..($b.Length-1)])');
console.log('  （注意：不可用 Out-File / Set-Content 回写，会再次带 BOM）');
process.exit(1);
