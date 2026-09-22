#!/usr/bin/env node
/**
 * 统一测试入口：一次跑完全部套件
 *
 * 用法：node test/run-all.js
 *
 * 为什么用「子进程逐个跑」而不是在一个进程里 require 所有套件：
 *   套件内部会 process.exit()，且 submitCorrection 那条会替换 `wx-server-sdk`
 *   的模块解析（Module._load）—— 同进程混跑会互相污染。隔离子进程最稳。
 */

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const SUITES_DIR = path.join(__dirname, 'suites');

/** 按文件名排序，保证输出顺序稳定 */
function listSuites() {
  return fs
    .readdirSync(SUITES_DIR)
    .filter((f) => f.endsWith('.test.js'))
    .sort();
}

const suites = listSuites();
if (!suites.length) {
  console.log('未找到任何测试套件（test/suites/*.test.js）');
  process.exit(1);
}

console.log('物流专线查询 · 测试总览');
console.log('='.repeat(50));

const results = [];
suites.forEach((f) => {
  const full = path.join(SUITES_DIR, f);
  const r = spawnSync(process.execPath, [full], { encoding: 'utf8' });
  const out = (r.stdout || '').trim();
  const err = (r.stderr || '').trim();

  // 从套件输出里抽出「断言 N 个：通过 X，失败 Y」一行
  const m = out.match(/断言\s*(\d+)\s*个：通过\s*(\d+)，失败\s*(\d+)/);
  const rec = {
    file: f,
    ok: r.status === 0,
    total: m ? Number(m[1]) : 0,
    pass: m ? Number(m[2]) : 0,
    fail: m ? Number(m[3]) : 0,
    output: out,
    stderr: err
  };
  results.push(rec);

  const mark = rec.ok ? '✅' : '❌';
  const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n);
  console.log(
    mark + ' ' + pad(f, 30) +
    '通过 ' + pad(String(rec.pass), 4) +
    '失败 ' + rec.fail
  );
});

/* 只要有套件失败，就把它的完整输出打出来（便于定位） */
const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.log('');
  console.log('='.repeat(50));
  failed.forEach((r) => {
    console.log('');
    console.log('--- ' + r.file + ' 的完整输出 ---');
    console.log(r.output || '(无标准输出)');
    if (r.stderr) console.log('[stderr] ' + r.stderr);
  });
}

const sum = results.reduce(
  (a, r) => ({ total: a.total + r.total, pass: a.pass + r.pass, fail: a.fail + r.fail }),
  { total: 0, pass: 0, fail: 0 }
);

console.log('');
console.log('='.repeat(50));
console.log('套件 ' + results.length + ' 个（失败 ' + failed.length + '）');
console.log('断言 ' + sum.total + ' 个：通过 ' + sum.pass + '，失败 ' + sum.fail);
console.log(failed.length ? '❌ 存在失败用例' : '✅ 全部通过');

process.exit(failed.length ? 1 : 0);
