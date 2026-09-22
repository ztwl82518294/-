#!/usr/bin/env node
/**
 * cloudfunctions/submitCorrection/index.js 测试
 *
 * ★ 这是**唯一对外的写接口**，也是被刷风险最高的地方，所以测法与前两个套件不同：
 *   用 mock 替掉 wx-server-sdk，然后**直接调用 exports.main**，
 *   以「攻击者视角」逐条验证六道护栏真的拦得住。
 *
 * 为什么能这么测：云函数是纯逻辑 + 数据库调用，把 db 换成内存实现即可复现全部行为。
 * 好处是这些断言在本地就能跑，不用部署、不用真机。
 */

const path = require('path');
const Module = require('module');

/* ============================================================
 * 1. 在 require 云函数之前，把 wx-server-sdk 换成 mock
 * ============================================================ */

/** 内存集合：{ [name]: [docs] } */
const STORE = {};
/** 记录每次 count 是否应抛错（用于测「计数失败保守放行」） */
let COUNT_SHOULD_FAIL = false;
/** 记录 add 是否应抛错 */
let ADD_SHOULD_FAIL = false;
let ADDED = [];

function resetStore() {
  Object.keys(STORE).forEach((k) => delete STORE[k]);
  COUNT_SHOULD_FAIL = false;
  ADD_SHOULD_FAIL = false;
  ADDED = [];
}

function matchDoc(doc, where) {
  return Object.keys(where).every((k) => doc[k] === where[k]);
}

const mockDb = {
  collection(name) {
    if (!STORE[name]) STORE[name] = [];
    const docs = STORE[name];
    let pendingWhere = null;
    const api = {
      where(w) { pendingWhere = w; return api; },
      async count() {
        if (COUNT_SHOULD_FAIL) throw new Error('mock count failure');
        const list = pendingWhere ? docs.filter((d) => matchDoc(d, pendingWhere)) : docs;
        return { total: list.length };
      },
      async add({ data }) {
        if (ADD_SHOULD_FAIL) throw new Error('mock add failure');
        const _id = 'mock_' + (docs.length + 1);
        docs.push(Object.assign({ _id }, data));
        ADDED.push(Object.assign({ _id }, data));
        return { _id };
      }
    };
    return api;
  },
  async createCollection() { /* mock：永远当作已存在 */ }
};

const mockSdk = {
  DYNAMIC_CURRENT_ENV: 'mock-env',
  init() {},
  database() { return mockDb; },
  /** 当前身份，测试里可改 */
  getWXContext() { return { OPENID: mockSdk.__openid }; },
  __openid: 'openid_alice'
};

/* 拦截 require('wx-server-sdk') */
const origResolve = Module._resolveFilename;
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'wx-server-sdk') return mockSdk;
  return origLoad.apply(this, arguments);
};

/* 清掉可能的缓存后加载云函数 */
const FN_PATH = path.join(__dirname, '../../cloudfunctions/submitCorrection/index.js');
delete require.cache[require.resolve(FN_PATH)];
const fn = require(FN_PATH);
const main = fn.main;

/* ============================================================
 * 2. 测试
 * ============================================================ */

const { describe, test, eq, ok, deepEq, summary, settle } = require('../framework');

/** 构造一个合法请求 */
function validEvent(over) {
  return Object.assign({
    action: 'submit',
    type: 'phone_wrong',
    targetType: 'company',
    targetId: 'comp_001',
    targetSummary: '济南鲁通物流有限公司',
    content: '电话已经停机了，打不通',
    images: [],
    contact: ''
  }, over || {});
}

/** 每次测试前清空集合与身份 */
function fresh(openid) {
  resetStore();
  mockSdk.__openid = openid === undefined ? 'openid_alice' : openid;
}

describe('关 1：无 openid 直接拒绝（不信任前端）', () => {
  test('OPENID 为空 → NO_OPENID，且不落库', async () => {
    fresh('');
    const r = await main(validEvent());
    eq(r.ok, false);
    eq(r.code, 'NO_OPENID');
    eq((STORE.corrections || []).length, 0);
  });

  test('OPENID 为 undefined → NO_OPENID', async () => {
    fresh(undefined);
    mockSdk.__openid = undefined;
    const r = await main(validEvent());
    eq(r.code, 'NO_OPENID');
  });
});

describe('关 2：action 白名单', () => {
  test('action 缺省视为 submit（兼容只传业务字段的调用）', async () => {
    fresh();
    const e = validEvent();
    delete e.action;
    const r = await main(e);
    eq(r.ok, true);
  });

  test('未知 action → BAD_ACTION', async () => {
    fresh();
    /*
     * ★ action 为空串等价于「没传」，按缺省 submit 处理（上一条用例就是这么约定的），
     *   所以这里**不能**把 '' 列进非法值 —— 把 '' 当非法会让「只传业务字段」的
     *   老调用方式直接失效。
     */
    for (const a of ['delete', 'list', 'approve', 'constructor', 'toString', '__proto__', 'SUBMIT']) {
      const r = await main(validEvent({ action: a }));
      eq(r.ok, false, 'action=' + a + ' 不应通过');
      eq(r.code, 'BAD_ACTION');
    }
  });
});

describe('关 3：类型白名单反查（★ 不信任前端的 typeLabel）', () => {
  test('五种合法类型都能通过', async () => {
    const types = ['phone_wrong', 'company_closed', 'route_gone', 'incomplete', 'other'];
    for (const t of types) {
      fresh();
      const r = await main(validEvent({ type: t }));
      eq(r.ok, true, 'type=' + t + ' 应通过');
      eq(STORE.corrections[0].type, t);
    }
  });

  test('typeLabel 由服务端查表，前端传入的 label 被忽略', async () => {
    fresh();
    const r = await main(validEvent({
      type: 'phone_wrong',
      typeLabel: '官方已核实'   // 伪造
    }));
    eq(r.ok, true);
    eq(STORE.corrections[0].typeLabel, '电话有误', '必须用服务端查表结果');
  });

  test('未知 type → BAD_TYPE', async () => {
    fresh();
    for (const t of ['hack', '', 'PHONE_WRONG', 'phone-wrong', 'constructor']) {
      const r = await main(validEvent({ type: t }));
      eq(r.ok, false, 'type=' + t + ' 不应通过');
      eq(r.code, 'BAD_TYPE');
    }
  });

  test('type 超长被截断后仍可能命中（不超过 40 字符的正常值不受影响）', async () => {
    fresh();
    const r = await main(validEvent({ type: 'phone_wrong'.padEnd(60, ' ') }));
    // trim 后等于 phone_wrong，应通过
    eq(r.ok, true);
  });
});

describe('关 4：目标类型白名单', () => {
  test('三种合法 targetType 通过', async () => {
    for (const tt of ['company', 'route_company', 'other']) {
      fresh();
      const r = await main(validEvent({ targetType: tt }));
      eq(r.ok, true, tt + ' 应通过');
    }
  });

  test('未知 targetType → BAD_TARGET_TYPE', async () => {
    fresh();
    for (const tt of ['route', 'admin', '', 'Company']) {
      const r = await main(validEvent({ targetType: tt }));
      eq(r.ok, false);
      eq(r.code, 'BAD_TARGET_TYPE');
    }
  });
});

describe('关 5：字段长度服务端再截断（前端 maxlength 可绕过）', () => {
  test('content 超 300 字被截到 300', async () => {
    fresh();
    const long = '很'.repeat(500);
    const r = await main(validEvent({ content: long }));
    eq(r.ok, true);
    eq(STORE.corrections[0].content.length, 300);
  });

  test('content 为空或纯空白 → EMPTY_CONTENT', async () => {
    fresh();
    for (const c of ['', '   ', '\n\t ', null, undefined]) {
      const r = await main(validEvent({ content: c }));
      eq(r.ok, false, 'content=' + JSON.stringify(c) + ' 不应通过');
      eq(r.code, 'EMPTY_CONTENT');
    }
  });

  test('targetSummary 超 200 被截断', async () => {
    fresh();
    const r = await main(validEvent({ targetSummary: '公'.repeat(400) }));
    eq(r.ok, true);
    eq(STORE.corrections[0].targetSummary.length, 200);
  });

  test('targetId 超 120 被截断（防超长主键撑爆索引）', async () => {
    fresh();
    const r = await main(validEvent({ targetId: 'x'.repeat(400) }));
    eq(r.ok, true);
    eq(STORE.corrections[0].targetId.length, 120);
  });

  test('contact 超 60 被截断', async () => {
    fresh();
    const r = await main(validEvent({ contact: '1'.repeat(200) }));
    eq(r.ok, true);
    eq(STORE.corrections[0].contact.length, 60);
  });

  test('非字符串字段被安全转成字符串，不抛错', async () => {
    fresh();
    const r = await main(validEvent({ targetId: 12345, targetSummary: { a: 1 }, contact: ['x'] }));
    // 对象会被 String() 成 "[object Object]"，这是可接受的（不为空即通过）
    eq(r.ok, true);
    eq(typeof STORE.corrections[0].targetId, 'string');
  });
});

describe('图片列表归一', () => {
  test('非数组 → 空数组', async () => {
    fresh();
    await main(validEvent({ images: 'not-an-array' }));
    deepEq(STORE.corrections[0].images, []);
  });

  test('超过 3 张只留前 3 张', async () => {
    fresh();
    await main(validEvent({ images: ['a', 'b', 'c', 'd', 'e'] }));
    deepEq(STORE.corrections[0].images, ['a', 'b', 'c']);
  });

  test('去重', async () => {
    fresh();
    await main(validEvent({ images: ['a', 'a', 'b', 'b', 'c'] }));
    deepEq(STORE.corrections[0].images, ['a', 'b', 'c']);
  });

  test('过滤非字符串与空串', async () => {
    fresh();
    await main(validEvent({ images: ['a', 1, null, '', '  ', {}, 'b'] }));
    deepEq(STORE.corrections[0].images, ['a', 'b']);
  });

  test('单个 id 超 300 被截断', async () => {
    fresh();
    await main(validEvent({ images: ['z'.repeat(500)] }));
    eq(STORE.corrections[0].images[0].length, 300);
  });
});

describe('关 6：频控', () => {
  test('同一 openid 对同一 target 单日第 4 次被拒', async () => {
    fresh();
    for (let i = 0; i < 3; i++) {
      const r = await main(validEvent());
      eq(r.ok, true, '第 ' + (i + 1) + ' 次应通过');
    }
    const r4 = await main(validEvent());
    eq(r4.ok, false);
    eq(r4.code, 'RATE_LIMITED');
    eq((STORE.corrections || []).length, 3, '第 4 次不应落库');
  });

  test('换 target 可继续提交（单 target 限制不影响其他记录）', async () => {
    fresh();
    for (let i = 0; i < 3; i++) await main(validEvent());
    const r = await main(validEvent({ targetId: 'comp_002' }));
    eq(r.ok, true);
  });

  test('单日总数上限 20：第 21 次被拒（跨 target 刷不动）', async () => {
    fresh();
    for (let i = 0; i < 20; i++) {
      const r = await main(validEvent({ targetId: 'comp_' + i }));
      eq(r.ok, true, '第 ' + (i + 1) + ' 次应通过');
    }
    const r = await main(validEvent({ targetId: 'comp_999' }));
    eq(r.ok, false);
    eq(r.code, 'RATE_LIMITED');
  });

  test('不同 openid 互不影响', async () => {
    fresh('openid_alice');
    for (let i = 0; i < 3; i++) await main(validEvent());
    mockSdk.__openid = 'openid_bob';
    const r = await main(validEvent());
    eq(r.ok, true, 'bob 不应被 alice 的次数影响');
  });

  test('★ 计数失败时保守放行（宁可漏拦，不误伤正常用户）', async () => {
    fresh();
    COUNT_SHOULD_FAIL = true;
    const r = await main(validEvent());
    eq(r.ok, true, '计数异常不应阻断提交');
    eq(STORE.corrections.length, 1);
  });
});

describe('落库字段与状态', () => {
  test('初始状态必须是 pending（PRD：提交后不做即时生效）', async () => {
    fresh();
    await main(validEvent());
    eq(STORE.corrections[0].status, 'pending');
  });

  test('落库携带 openid 与 day（频控索引字段）', async () => {
    fresh('openid_carol');
    await main(validEvent());
    const d = STORE.corrections[0];
    eq(d.openid, 'openid_carol');
    ok(/^\d{4}-\d{2}-\d{2}$/.test(d.day), 'day 格式应为 yyyy-MM-dd，实际 ' + d.day);
  });

  test('day 是东八区当日（不是 UTC 日期）', async () => {
    fresh();
    await main(validEvent());
    const d = new Date(Date.now() + 8 * 3600 * 1000);
    const p = (n) => (n < 10 ? '0' + n : '' + n);
    const expect = d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
    eq(STORE.corrections[0].day, expect);
  });

  test('createdAt 是数字时间戳', async () => {
    fresh();
    await main(validEvent());
    eq(typeof STORE.corrections[0].createdAt, 'number');
    ok(STORE.corrections[0].createdAt > 0);
  });

  test('返回值只含 id，不泄露 openid 等服务端字段', async () => {
    fresh();
    const r = await main(validEvent());
    deepEq(Object.keys(r).sort(), ['id', 'ok']);
  });
});

describe('关 6（异常）：不抛穿、不暴露内部信息', () => {
  test('写库失败时返回笼统提示，不带堆栈', async () => {
    fresh();
    ADD_SHOULD_FAIL = true;
    const r = await main(validEvent());
    eq(r.ok, false);
    eq(r.code, 'INTERNAL');
    eq(r.message, '提交失败，请稍后重试');
    ok(!/mock add failure/.test(r.message), '不得把底层错误暴露给前端');
  });

  test('event 为 null 不抛错（返回业务错误码）', async () => {
    fresh();
    const r = await main(null);
    eq(r.ok, false);
    ok(typeof r.code === 'string');
  });

  test('event 为字符串不抛错', async () => {
    fresh();
    const r = await main('garbage');
    eq(r.ok, false);
  });
});

/* ============================================================
 * 3. 汇总
 * ============================================================ */

/*
 * ★ 必须 await settle() 再 summary()：本套件的用例全是 async，
 *   直接 summary 的话异步断言还没跑完就退出，失败会被漏掉（框架已修，这里跟着改）。
 */
settle().then(() => {
  process.exit(summary('submitCorrection') ? 0 : 1);
});
