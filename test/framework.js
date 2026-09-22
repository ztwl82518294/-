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

/**
 * 异步用例队列
 *
 * ★★ 曾经踩过的坑（2026-09-22）：test() 原本只同步调用 fn()，
 *   fn 返回 Promise 时**立刻算通过** —— 于是「故意写错的异步断言」也报绿，
 *   而真正的失败根本没被统计。submitCorrection.test.js 那 34 条
 *   就这么变成了摆设（写了、跑了、全绿了、什么都没验到）。
 *
 * ★★ 第二个坑（同一天）：修好统计后，异步用例是**并发**跑的 ——
 *   云函数套件都在改同一份内存 mock（STORE / 当前 openid / 频控计数），
 *   于是「A 用例设的 openid」被「B 用例」读到，频控计数也被别的用例刷爆，
 *   表现为一堆莫名其妙的 RATE_LIMITED 与 undefined。
 *   修法：异步用例**排队串行**跑（settle 里一个一个 await），顺序即书写顺序。
 */
const queue = [];
/** 非 async 函数却返回了 Promise 时的兜底并发队列（理论上不该走到） */
const pending = [];

function isAsyncFn(fn) {
  return typeof fn === 'function' && !!fn.constructor && fn.constructor.name === 'AsyncFunction';
}

/** 声明一个测试组 */
function describe(name, fn) {
  currentSuite = name;
  fn();
  currentSuite = '';
}

function recordFailure(suite, name, e) {
  failed++;
  failures.push({
    suite: suite,
    name: name,
    message: (e && e.message) || String(e)
  });
}

/** 单个断言用例（支持 async 函数） */
function test(name, fn) {
  const suite = currentSuite;

  // async 用例：排队等 settle() 串行跑，不在这里启动（否则共享 mock 状态会互相污染）
  if (isAsyncFn(fn)) {
    queue.push({ suite: suite, name: name, fn: fn });
    return;
  }

  let out;
  try {
    out = fn();
  } catch (e) {
    recordFailure(suite, name, e);
    return;
  }
  if (out && typeof out.then === 'function') {
    pending.push(
      out.then(
        () => { passed++; },
        (e) => { recordFailure(suite, name, e); }
      )
    );
    return;
  }
  passed++;
}

/**
 * 跑完所有异步用例（串行），返回是否全部通过
 * ★ 套件末尾必须 await settle() 再 summary()，否则异步断言的结果还没回来就退出了。
 * ★ 串行而不是 Promise.all：云函数套件共用同一份内存 mock（集合 / 当前 openid /
 *   频控计数），并发跑会互相读到对方设的状态。
 */
async function settle() {
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    try {
      await item.fn();
      passed++;
    } catch (e) {
      recordFailure(item.suite, item.name, e);
    }
  }
  queue.length = 0;

  let guard = 0;
  while (pending.length && guard < 1000) {
    const batch = pending.splice(0, pending.length);
    await Promise.all(batch);
    guard++;
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
  queue.length = 0;
  pending.length = 0;
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
  settle,
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
