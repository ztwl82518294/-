// 一键跑全部回归测试：node .workbuddy/scripts/run-tests.js
// 每个测试脚本独立子进程执行，任一失败则整体退出码非 0。
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const files = fs.readdirSync(dir)
  .filter(f => /^test-.*\.js$/.test(f))
  .sort();

let failed = [];

// 先跑编码自检：BOM 会导致小程序编译直接失败，必须先拦
process.stdout.write(`\n===== check-bom.js（编码自检） =====\n`);
try {
  const out = execFileSync(process.execPath, [path.join(dir, 'check-bom.js')], { encoding: 'utf8' });
  process.stdout.write(out);
} catch (e) {
  process.stdout.write(String(e.stdout || '') + String(e.stderr || ''));
  failed.push('check-bom.js');
}

files.forEach(f => {
  process.stdout.write(`\n===== ${f} =====\n`);
  try {
    const out = execFileSync(process.execPath, [path.join(dir, f)], { encoding: 'utf8' });
    process.stdout.write(out);
    if (/FAILED|失败/.test(out) && !/0 失败|0 failed/.test(out)) failed.push(f);
  } catch (e) {
    process.stdout.write(String(e.stdout || '') + String(e.stderr || ''));
    failed.push(f);
  }
});

console.log(`\n========== 汇总：编码自检 + ${files.length} 个测试文件，${failed.length} 个失败 ==========`);
if (failed.length) {
  console.log('失败：' + failed.join(', '));
  process.exit(1);
}
