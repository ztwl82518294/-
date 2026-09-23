#!/usr/bin/env node
/**
 * cloudfunctions/adminApi/index.js 测试
 *
 * ★ 为什么要专门测：这是小程序端后台的**唯一数据通道**，而且它握着写权限。
 *   身份校验一旦漏了，等于把数据库开放给所有用户 —— 所以「非管理员能不能改数据」
 *   必须逐条验证，不能只在页面上藏个入口就算完（前端的隐藏绕过成本是零）。
 *
 * 测法（与 submitCorrection 套件一致）：mock 掉 wx-server-sdk，
 * 直接调 exports.main，以「攻击者视角」验证护栏。
 */

const path = require('path');
const Module = require('module');

/* ============================================================
 * 1. mock wx-server-sdk
 * ============================================================ */

const STORE = {};
/** 让某集合的下一次操作抛错（测 INTERNAL 兜底） */
let FAIL_ON = null;
/** 让某集合的下一次操作抛「集合不存在」（测 NOT_SEEDED 翻译） */
let MISSING_ON = null;

function resetStore() {
  Object.keys(STORE).forEach((k) => delete STORE[k]);
  FAIL_ON = null;
  MISSING_ON = null;
}

function docs(name) {
  if (!STORE[name]) STORE[name] = [];
  return STORE[name];
}

function matchDoc(doc, where) {
  return Object.keys(where).every((k) => doc[k] === where[k]);
}

function maybeFail(name) {
  // 集合不存在：模拟云开发的真错误形状（errCode -502005 + errMsg 带 collection not exists）
  if (MISSING_ON && MISSING_ON.indexOf(name) >= 0) {
    const e = new Error('mock collection not exists: ' + name);
    e.errCode = -502005;
    throw e;
  }
  if (FAIL_ON && FAIL_ON.indexOf(name) >= 0) throw new Error('mock db failure: ' + name);
}

function docApi(name, id) {
  return {
    async get() {
      maybeFail(name);
      const d = docs(name).filter((x) => x._id === id)[0];
      return { data: d || null };
    },
    async update({ data }) {
      maybeFail(name);
      const d = docs(name).filter((x) => x._id === id)[0];
      if (!d) throw new Error('doc not found: ' + id);
      Object.keys(data).forEach((k) => { d[k] = data[k]; });
      return { stats: { updated: 1 } };
    },
    async remove() {
      maybeFail(name);
      const list = docs(name);
      const i = list.findIndex((x) => x._id === id);
      if (i >= 0) list.splice(i, 1);
      return { stats: { removed: i >= 0 ? 1 : 0 } };
    }
  };
}

function makeCollection(name) {
  let skipN = 0;
  let limitN = 1000;
  let whereQ = null;

  const api = {
    skip(n) { skipN = n; return api; },
    limit(n) { limitN = n; return api; },
    orderBy() { return api; },
    where(w) { whereQ = w; return api; },
    doc(id) { return docApi(name, id); },
    async get() {
      maybeFail(name);
      let list = whereQ ? docs(name).filter((d) => matchDoc(d, whereQ)) : docs(name).slice();
      return { data: list.slice(skipN, skipN + limitN) };
    },
    async add({ data }) {
      maybeFail(name);
      const row = Object.assign({}, data);
      if (!row._id) row._id = 'gen_' + (docs(name).length + 1);
      docs(name).push(row);
      return { _id: row._id };
    },
    async remove() {
      maybeFail(name);
      const list = docs(name);
      const keep = whereQ ? list.filter((d) => !matchDoc(d, whereQ)) : [];
      const removed = list.length - keep.length;
      list.length = 0;
      keep.forEach((d) => list.push(d));
      return { stats: { removed: removed } };
    }
  };
  return api;
}

const mockSdk = {
  DYNAMIC_CURRENT_ENV: 'mock-env',
  init() {},
  database() {
    return {
      collection(name) { return makeCollection(name); }
    };
  },
  getWXContext() { return { OPENID: mockSdk.__openid }; },
  __openid: 'openid_admin'
};

const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'wx-server-sdk') return mockSdk;
  return origLoad.apply(this, arguments);
};

const FN_PATH = path.join(__dirname, '../../cloudfunctions/adminApi/index.js');
delete require.cache[require.resolve(FN_PATH)];
const fn = require(FN_PATH);
const main = fn.main;
const ADMIN = fn.ADMIN_OPENIDS;

/** 注入管理员（模拟「已在云函数里配好白名单」）。未配置的场景在下面单独测。 */
const ADMIN_OPENID = 'openid_admin';
ADMIN.push(ADMIN_OPENID);

/* ============================================================
 * 2. 测试
 * ============================================================ */

const { describe, test, ok, eq, summary, settle } = require('../framework');

/** 调一次云函数 */
function call(payload, openid) {
  mockSdk.__openid = openid === undefined ? ADMIN_OPENID : openid;
  return main(payload || {});
}

/** 临时清空白名单（测「未配置一律拒绝」），用完必须还原 */
function withoutAdmins(fnBody) {
  const saved = ADMIN.slice();
  ADMIN.length = 0;
  return fnBody().then(
    (v) => { ADMIN.length = 0; saved.forEach((x) => ADMIN.push(x)); return v; },
    (e) => { ADMIN.length = 0; saved.forEach((x) => ADMIN.push(x)); throw e; }
  );
}

describe('鉴权：身份必须在服务端校验', () => {
  test('没有 openid 直接拒绝', async () => {
    const r = await call({ action: 'overview' }, '');
    eq(r.ok, false);
    eq(r.code, 'NO_OPENID');
  });

  test('未知的 action 被拒', async () => {
    const r = await call({ action: 'dropDatabase' });
    eq(r.ok, false);
    eq(r.code, 'BAD_ACTION');
  });

  test('★ 原型链上的键不能绕过分发（constructor / __proto__ / toString）', async () => {
    const keys = ['constructor', '__proto__', 'toString', 'valueOf'];
    for (let i = 0; i < keys.length; i++) {
      const r = await call({ action: keys[i] });
      eq(r.ok, false, 'action=' + keys[i] + ' 不应通过');
      eq(r.code, 'BAD_ACTION');
    }
  });

  test('★ 未知 type 被拒（含原型链键）', async () => {
    const keys = ['constructor', '__proto__', 'users', 'admins'];
    for (let i = 0; i < keys.length; i++) {
      const r = await call({ action: 'list', type: keys[i] });
      eq(r.ok, false, 'type=' + keys[i] + ' 不应通过');
      eq(r.code, 'BAD_TYPE');
    }
  });

  test('★ 白名单为空时一律拒绝（而不是放行）', async () => {
    const r = await withoutAdmins(() => call({ action: 'overview' }));
    eq(r.ok, false);
    eq(r.code, 'NOT_CONFIGURED');
  });

  test('白名单为空时 whoami 也要如实说不是管理员（不能因为没配置就放行）', async () => {
    const r = await withoutAdmins(() => call({ action: 'whoami' }));
    eq(r.ok, true);
    eq(r.isAdmin, false);
    eq(r.code, 'NOT_CONFIGURED');
  });

  test('★ 非管理员不能读数据（前端藏入口没用，服务端必须拦）', async () => {
    const r = await call({ action: 'list', type: 'companies' }, 'openid_stranger');
    eq(r.ok, false);
    eq(r.code, 'NOT_ADMIN');
  });

  test('★ 非管理员不能写数据', async () => {
    const r = await call(
      { action: 'save', type: 'companies', data: { name: 'hack', city: '济南', phone: '0531-88886666' } },
      'openid_stranger'
    );
    eq(r.ok, false);
    eq(r.code, 'NOT_ADMIN');
  });

  test('★ 非管理员不能删数据', async () => {
    const r = await call({ action: 'remove', type: 'companies', id: 'comp_001' }, 'openid_stranger');
    eq(r.ok, false);
    eq(r.code, 'NOT_ADMIN');
  });

  test('whoami 对任何人开放，并回传 openid（页面要靠它显示白名单该填什么）', async () => {
    const r = await call({ action: 'whoami' }, 'openid_newbie');
    eq(r.ok, true);
    eq(r.openid, 'openid_newbie');
    eq(r.isAdmin, false);
    eq(r.code, 'NOT_ADMIN');
  });

  test('管理员的 whoami 标记 isAdmin', async () => {
    const r = await call({ action: 'whoami' });
    eq(r.ok, true);
    eq(r.isAdmin, true);
  });
});

describe('总览与质量看板', () => {
  test('overview 返回各表计数', async () => {
    resetStore();
    docs('companies').push({ _id: 'c1', name: '甲', phone: '0531-88886666', city: '济南', scale: 'small', updatedAt: Date.now() });
    docs('routes').push({ _id: 'route_济南_广州', routeKey: '济南-广州', companyCount: 0 });
    docs('corrections').push({ _id: 'k1', status: 'pending', createdAt: 1 });
    const r = await call({ action: 'overview' });
    eq(r.ok, true);
    eq(r.counts.companies, 1);
    eq(r.counts.routes, 1);
    eq(r.counts.pendingCorrections, 1);
  });

  test('★ 质量看板能发现「companyCount 与实际不符」', async () => {
    resetStore();
    docs('companies').push({ _id: 'c1', name: '甲', phone: '1', city: '济南', scale: 'small', updatedAt: Date.now() });
    docs('routes').push({ _id: 'route_济南_广州', routeKey: '济南-广州', companyCount: 9 });
    const r = await call({ action: 'quality' });
    eq(r.ok, true);
    eq(r.quality.blocking.countMismatch, 1);
    eq(r.quality.details.countMismatch[0].declared, 9);
    eq(r.quality.details.countMismatch[0].actual, 0);
  });

  test('★ 质量看板能发现悬空外键（关联指向不存在的公司）', async () => {
    resetStore();
    docs('route_companies').push({ _id: 'l1', routeId: 'route_x', companyId: 'comp_x', routeKey: 'a-b' });
    const r = await call({ action: 'quality' });
    eq(r.quality.blocking.orphan, 1);
  });
});

describe('公司：保存与校验', () => {
  test('缺必填项被拒，并给出字段名', async () => {
    resetStore();
    const r = await call({ action: 'save', type: 'companies', data: {} });
    eq(r.ok, false);
    eq(r.code, 'INVALID');
    ok(r.errors.some((e) => e.field === 'name'), JSON.stringify(r.errors));
  });

  test('电话格式不对被拒', async () => {
    resetStore();
    const r = await call({ action: 'save', type: 'companies', data: { name: '甲物流', city: '济南', phone: 'abc' } });
    eq(r.ok, false);
    ok(r.errors.some((e) => e.field === 'phone'));
  });

  test('合法数据写入成功', async () => {
    resetStore();
    const r = await call({
      action: 'save', type: 'companies',
      data: { name: '甲物流', city: '济南', phone: '0531-88886666', scale: 'medium' }
    });
    eq(r.ok, true);
    eq(docs('companies').length, 1);
    eq(docs('companies')[0].name, '甲物流');
  });

  test('★ 同名公司被拒（唯一性在服务端，不靠前端）', async () => {
    resetStore();
    await call({ action: 'save', type: 'companies', data: { name: '甲物流', city: '济南', phone: '0531-88886666' } });
    const r = await call({ action: 'save', type: 'companies', data: { name: '甲物流', city: '青岛', phone: '0532-88886666' } });
    eq(r.ok, false);
    ok(r.errors.some((e) => e.message.indexOf('同名') >= 0), JSON.stringify(r.errors));
  });

  test('编辑自己不算重名', async () => {
    resetStore();
    const c = await call({ action: 'save', type: 'companies', data: { name: '甲物流', city: '济南', phone: '0531-88886666' } });
    const r = await call({ action: 'save', type: 'companies', id: c.id, data: { name: '甲物流', city: '青岛', phone: '0531-88886666' } });
    eq(r.ok, true);
    eq(docs('companies')[0].city, '青岛');
  });

  test('编辑不存在的 id 报 NOT_FOUND', async () => {
    resetStore();
    const r = await call({ action: 'save', type: 'companies', id: 'nope', data: { name: 'x', city: '济南', phone: '0531-88886666' } });
    eq(r.ok, false);
    eq(r.code, 'NOT_FOUND');
  });
});

describe('线路：routeKey 归一级联', () => {
  test('★ 带「市」后缀被归一，重复建线被拒', async () => {
    resetStore();
    const a = await call({ action: 'save', type: 'routes', data: { fromCity: '济南', toCity: '广州' } });
    eq(a.ok, true);
    eq(a.id, 'route_济南_广州');
    const b = await call({ action: 'save', type: 'routes', data: { fromCity: '济南市', toCity: '广州市' } });
    eq(b.ok, false);
    ok(b.errors.some((e) => e.message.indexOf('该线路已存在') >= 0), JSON.stringify(b.errors));
  });

  test('同城被拒', async () => {
    resetStore();
    const r = await call({ action: 'save', type: 'routes', data: { fromCity: '济南', toCity: '济南' } });
    eq(r.ok, false);
    ok(r.errors.some((e) => e.message.indexOf('同一城市') >= 0));
  });

  test('★ 改城市会同步关联的 routeId/routeKey（否则小程序端死链）', async () => {
    resetStore();
    await call({ action: 'save', type: 'companies', data: { name: '甲', city: '济南', phone: '0531-88886666' } });
    const comp = docs('companies')[0];
    const route = await call({ action: 'save', type: 'routes', data: { fromCity: '济南', toCity: '广州' } });
    await call({ action: 'save', type: 'links', data: { routeId: route.id, companyId: comp._id, frequency: 'daily' } });

    eq(docs('route_companies')[0].routeKey, '济南-广州');

    const edited = await call({
      action: 'save', type: 'routes', id: route.id,
      data: { fromCity: '济南', toCity: '北京' }
    });
    eq(edited.ok, true);
    eq(edited.id, 'route_济南_北京');
    eq(docs('route_companies')[0].routeId, 'route_济南_北京');
    eq(docs('route_companies')[0].routeKey, '济南-北京');
  });
});

describe('关联与级联删除', () => {
  test('线路不存在被拒', async () => {
    resetStore();
    const r = await call({ action: 'save', type: 'links', data: { routeId: 'nope', companyId: 'nope', frequency: 'daily' } });
    eq(r.ok, false);
    ok(r.errors.some((e) => e.message === '线路不存在'), JSON.stringify(r.errors));
  });

  test('时效超过 60 天被拒', async () => {
    resetStore();
    await call({ action: 'save', type: 'companies', data: { name: '甲', city: '济南', phone: '0531-88886666' } });
    const comp = docs('companies')[0];
    const route = await call({ action: 'save', type: 'routes', data: { fromCity: '济南', toCity: '广州' } });
    const r = await call({ action: 'save', type: 'links', data: { routeId: route.id, companyId: comp._id, frequency: 'daily', transitDays: 99 } });
    eq(r.ok, false);
    ok(r.errors.some((e) => e.message.indexOf('时效最多 60 天') >= 0));
  });

  test('★ 保存关联后 companyCount 被重算（不是 +=1）', async () => {
    resetStore();
    await call({ action: 'save', type: 'companies', data: { name: '甲', city: '济南', phone: '0531-88886666' } });
    const comp = docs('companies')[0];
    const route = await call({ action: 'save', type: 'routes', data: { fromCity: '济南', toCity: '广州' } });
    await call({ action: 'save', type: 'links', data: { routeId: route.id, companyId: comp._id, frequency: 'daily' } });
    eq(docs('routes')[0].companyCount, 1);
  });

  test('★ 删公司级联删关联并重算', async () => {
    resetStore();
    await call({ action: 'save', type: 'companies', data: { name: '甲', city: '济南', phone: '0531-88886666' } });
    const comp = docs('companies')[0];
    const route = await call({ action: 'save', type: 'routes', data: { fromCity: '济南', toCity: '广州' } });
    await call({ action: 'save', type: 'links', data: { routeId: route.id, companyId: comp._id, frequency: 'daily' } });

    const r = await call({ action: 'remove', type: 'companies', id: comp._id });
    eq(r.ok, true);
    eq(r.cascadedLinks, 1);
    eq(docs('companies').length, 0);
    eq(docs('route_companies').length, 0);
    eq(docs('routes')[0].companyCount, 0);
  });

  test('★ 删线路级联删关联', async () => {
    resetStore();
    await call({ action: 'save', type: 'companies', data: { name: '甲', city: '济南', phone: '0531-88886666' } });
    const comp = docs('companies')[0];
    const route = await call({ action: 'save', type: 'routes', data: { fromCity: '济南', toCity: '广州' } });
    await call({ action: 'save', type: 'links', data: { routeId: route.id, companyId: comp._id, frequency: 'daily' } });

    const r = await call({ action: 'remove', type: 'routes', id: route.id });
    eq(r.ok, true);
    eq(r.cascadedLinks, 1);
    eq(docs('routes').length, 0);
  });
});

describe('运营位：公告与推广位', () => {
  test('★ 外链公告被拒（小程序里点了没反应）', async () => {
    resetStore();
    const r = await call({
      action: 'save', type: 'announcements',
      data: { title: '通知', content: '正文', link: 'https://a.com' }
    });
    eq(r.ok, false);
    ok(r.errors.some((e) => e.message.indexOf('外链') >= 0));
  });

  test('空正文公告被拒', async () => {
    resetStore();
    const r = await call({ action: 'save', type: 'announcements', data: { title: '通知' } });
    eq(r.ok, false);
    ok(r.errors.some((e) => e.field === 'content'));
  });

  test('合法公告写入成功', async () => {
    resetStore();
    const r = await call({ action: 'save', type: 'announcements', data: { title: '通知', content: '正文', link: '/pages/privacy/index' } });
    eq(r.ok, true);
    eq(docs('announcements').length, 1);
  });

  test('★ 推广位指向不存在的线路被拒', async () => {
    resetStore();
    const r = await call({ action: 'save', type: 'featured', data: { fromCity: '济南', toCity: '广州', tag: '直达' } });
    eq(r.ok, false);
    ok(r.errors.some((e) => e.message.indexOf('线路库里还没有') >= 0), JSON.stringify(r.errors));
  });

  test('★ 同一线路重复推广被拒', async () => {
    resetStore();
    await call({ action: 'save', type: 'routes', data: { fromCity: '济南', toCity: '广州' } });
    await call({ action: 'save', type: 'featured', data: { fromCity: '济南', toCity: '广州', tag: '直达' } });
    const r = await call({ action: 'save', type: 'featured', data: { fromCity: '济南', toCity: '广州', tag: '天天发车' } });
    eq(r.ok, false);
    ok(r.errors.some((e) => e.message.indexOf('已经在推广位里了') >= 0), JSON.stringify(r.errors));
  });

  test('角标必填', async () => {
    resetStore();
    await call({ action: 'save', type: 'routes', data: { fromCity: '济南', toCity: '广州' } });
    const r = await call({ action: 'save', type: 'featured', data: { fromCity: '济南', toCity: '广州' } });
    eq(r.ok, false);
    ok(r.errors.some((e) => e.field === 'tag'));
  });
});

describe('纠错审核', () => {
  test('非法状态被拒', async () => {
    resetStore();
    docs('corrections').push({ _id: 'k1', status: 'pending' });
    const r = await call({ action: 'review', id: 'k1', status: 'whatever', note: '' });
    eq(r.ok, false);
    eq(r.code, 'INVALID');
  });

  test('不存在的记录报 NOT_FOUND', async () => {
    resetStore();
    const r = await call({ action: 'review', id: 'nope', status: 'accepted', note: '' });
    eq(r.ok, false);
    eq(r.code, 'NOT_FOUND');
  });

  test('采纳成功并写入审核信息', async () => {
    resetStore();
    docs('corrections').push({ _id: 'k1', status: 'pending' });
    const r = await call({ action: 'review', id: 'k1', status: 'accepted', note: '已改电话' });
    eq(r.ok, true);
    eq(docs('corrections')[0].status, 'accepted');
    eq(docs('corrections')[0].rejectReason, '已改电话');
    ok(docs('corrections')[0].handledAt > 0);
  });
});

describe('批量导入：先预览后确认', () => {
  const CSV = [
    '公司全称,主电话,出发城市,到达城市,时效（天）,是否直达,发车频率',
    '甲物流,0531-88886666,济南,广州,2,是,daily',
    '乙物流,0532-88886666,济南,青岛,3,否,weekly',
    ',0531-11111111,济南,北京,1,是,daily'
  ].join('\n');

  test('预览能解析并标出错误行（带行号）', async () => {
    resetStore();
    const r = await call({ action: 'importPreview', text: CSV });
    eq(r.ok, true);
    eq(r.summary.validCount, 2);
    eq(r.summary.invalidCount, 1);
    eq(r.invalid[0].lineNo, 4);
    ok(r.invalid[0].errors.join().indexOf('公司全称缺失') >= 0);
  });

  test('★ 预览不写任何数据（无副作用）', async () => {
    resetStore();
    await call({ action: 'importPreview', text: CSV });
    eq(docs('companies').length, 0);
    eq(docs('routes').length, 0);
    eq(docs('route_companies').length, 0);
  });

  test('确认导入后公司/线路/关联都建好，且 companyCount 正确', async () => {
    resetStore();
    const r = await call({ action: 'importCommit', text: CSV });
    eq(r.ok, true);
    eq(r.result.created, 2);
    eq(r.result.links, 2);
    eq(docs('companies').length, 2);
    eq(docs('routes').length, 2);
    eq(docs('routes').filter((x) => x.routeKey === '济南-广州')[0].companyCount, 1);
    /*
     * 错误行在预览阶段就已经被剔掉了，commit 只跑 valid 行 ——
     * 所以这里 failed 为 0 是**正确行为**（与桌面后台一致）：
     * 「一行坏掉全批作废」才是要避免的，跳过即可，错误原因预览里已经给过。
     */
    eq(r.result.failed.length, 0);
  });

  test('同一公司多行只建一次，挂两条线路', async () => {
    resetStore();
    const csv = [
      '公司全称,主电话,出发城市,到达城市,发车频率',
      '甲物流,0531-88886666,济南,广州,daily',
      '甲物流,0531-88886666,济南,北京,daily'
    ].join('\n');
    const r = await call({ action: 'importCommit', text: csv });
    eq(r.result.created, 1);
    eq(r.result.links, 2);
    eq(docs('companies').length, 1);
  });

  test('空文本给出人话提示', async () => {
    resetStore();
    const r = await call({ action: 'importPreview', text: '' });
    eq(r.ok, false);
    eq(r.code, 'EMPTY');
  });
});

describe('列表与分页', () => {
  test('分页返回 total / pages', async () => {
    resetStore();
    for (let i = 0; i < 5; i++) {
      docs('companies').push({ _id: 'c' + i, name: '公司' + i, city: '济南', phone: '0531-8888666' + i, scale: 'small', updatedAt: 1000 + i });
    }
    const r = await call({ action: 'list', type: 'companies', page: 1, pageSize: 2 });
    eq(r.ok, true);
    eq(r.total, 5);
    eq(r.pages, 3);
    eq(r.rows.length, 2);
  });

  test('未知 type 被拒', async () => {
    resetStore();
    const r = await call({ action: 'list', type: 'users' });
    eq(r.ok, false);
    eq(r.code, 'BAD_TYPE');
  });

  test('options 给编辑页下拉用', async () => {
    resetStore();
    docs('routes').push({ _id: 'route_济南_广州', routeKey: '济南-广州' });
    docs('companies').push({ _id: 'c1', name: '甲物流' });
    const r = await call({ action: 'options' });
    eq(r.ok, true);
    eq(r.routes[0].label, '济南-广州');
    eq(r.companies[0].label, '甲物流');
  });
});

describe('兜底', () => {
  test('★ 数据库异常不抛穿（不把堆栈给前端）', async () => {
    resetStore();
    FAIL_ON = ['companies'];
    const r = await call({ action: 'list', type: 'companies' });
    eq(r.ok, false);
    eq(r.code, 'INTERNAL');
    ok(String(r.message).indexOf('mock db failure') < 0, '不能泄漏内部错误详情');
    FAIL_ON = null;
  });

  test('★ 集合不存在翻译成 NOT_SEEDED（不是故障，是云端库还没初始化）', async () => {
    /*
     * 2026-09-23 真机首跑的真实症状：管理员身份通过了（whoami 不查集合），
     * 总览却只报「操作失败，请重试」—— 用户反复点重新加载，其实云端一个集合都没建。
     * 修复后必须翻译成人话并指向控制台，而不是让 TA 重试。
     */
    resetStore();
    MISSING_ON = ['companies'];
    const r = await call({ action: 'overview' });
    eq(r.ok, false);
    eq(r.code, 'NOT_SEEDED');
    ok(String(r.message).indexOf('控制台') >= 0, '要指路：去云开发控制台建集合');
    ok(String(r.message).indexOf('mock') < 0, '不能泄漏内部错误详情');
    MISSING_ON = null;
  });

  test('其他 action 遇到集合缺失同样报 NOT_SEEDED（list / quality 都会碰集合）', async () => {
    resetStore();
    MISSING_ON = ['companies'];
    const a = await call({ action: 'list', type: 'companies' });
    eq(a.code, 'NOT_SEEDED');
    const b = await call({ action: 'quality' });
    eq(b.code, 'NOT_SEEDED');
    MISSING_ON = null;
  });

  test('★ 判定要窄：普通错误（无 errCode、不带 collection 字样）仍是 INTERNAL', async () => {
    resetStore();
    FAIL_ON = ['companies'];
    const r = await call({ action: 'overview' });
    eq(r.code, 'INTERNAL', '误把普通故障翻成「去初始化」比笼统更糟');
    FAIL_ON = null;
  });
});

/* ============================================================
 * 3. 汇总
 * ============================================================ */

// ★ 必须 await settle() 再 summary()：本套件用例全是 async。
//   （框架曾经把 async 断言一律算通过，submitCorrection 套件因此变成摆设，已修。）
settle().then(() => {
  process.exit(summary('adminApi 云函数') ? 0 : 1);
});
