#!/usr/bin/env node
/**
 * 测试框架（零依赖）
 *
 * 为什么自研而不引入 jest/mocha：
 *   本项目坚持零依赖——云函数与脚本都只靠 Node 内置模块。引入测试框架会带来
 *   node_modules，既拖慢开发者工具的上传，也让「首次部署」多一个环节。
 *   这里的断言足够覆盖本项目的逻辑测试需求（纯函数为主）。
 *
 * 用法：
 *   node test/framework.js         # 查看自身自检
 *   在套件里：const { test, eq, ok, deepEq, summary } = require('../framework');
 */

let passed = 0;
let failed = 0;
const failures = [];
let currentSuite = '';

/** 声明一个测试组 */
function describe(name, fn) {
  currentSuite = name;
  fn();
  currentSuite = '';
}

/** 单个断言用例 */
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    failures.push({
      suite: currentSuite,
      name: name,
      message: (e && e.message) || String(e)
    });
  }
}

/* ============================================================
 * 断言
 * ============================================================ */

function ok(v, msg) {
  if (!v) throw new Error(msg || ('期望为真，实际为 ' + JSON.stringify(v)));
}

function eq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(
      (msg ? msg + '：' : '') +
      '期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual)
    );
  }
}

/** 深比较（用 JSON 序列化，够用于本项目的数据结构） */
function deepEq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error((msg ? msg + '：' : '') + '期望 ' + b + '，实际 ' + a);
  }
}

function near(actual, expected, tol, msg) {
  if (Math.abs(Number(actual) - Number(expected)) > (tol || 0.0001)) {
    throw new Error((msg ? msg + '：' : '') + '期望接近 ' + expected + '，实际 ' + actual);
  }
}

function throws(fn, msg) {
  let threw = false;
  try { fn(); } catch (e) { threw = true; }
  if (!threw) throw new Error(msg || '期望抛出异常，但没有');
}

/* ============================================================
 * 汇总
 * ============================================================ */

/** 输出汇总并返回是否全通过 */
function summary(label) {
  const total = passed + failed;
  console.log('');
  console.log('=== ' + (label || '测试结果') + ' ===');
  console.log('断言 ' + total + ' 个：通过 ' + passed + '，失败 ' + failed);
  if (failed) {
    console.log('');
    failures.forEach((f) => {
      console.log('  ✗ [' + f.suite + '] ' + f.name);
      console.log('     ' + f.message);
    });
  }
  console.log(failed ? '❌ 未通过' : '✅ 全部通过');
  return failed === 0;
}

/** 重置计数（多文件合并运行时用） */
function reset() {
  passed = 0;
  failed = 0;
  failures.length = 0;
}

module.exports = {
  describe,
  test,
  ok,
  eq,
  deepEq,
  near,
  throws,
  summary,
  reset,
  get passed() { return passed; },
  get failed() { return failed; },
  get failures() { return failures; }
};

/* 直接运行本文件时做一次自检 */
if (require.main === module) {
  describe('框架自检', () => {
    test('eq 通过', () => eq(1, 1));
    test('ok 通过', () => ok(true));
    test('deepEq 通过', () => deepEq({ a: 1 }, { a: 1 }));
  });
  const good = summary('框架自检');
  process.exit(good ? 0 : 1);
}
