#!/usr/bin/env node
/**
 * data/seed-data.js 测试
 *
 * 这批样板数据是「演示与验收的地基」：PRD 明确要求三个筛选（直达/天天发车/
 * 时效）都能真实演示，所以这里把「字段齐全」写成断言来守。
 * 一旦将来有人补数据时漏了 transitDays，测试会立刻报出。
 */

const { describe, test, eq, ok, deepEq, summary } = require('../framework');
const seed = require('../../data/seed-data');
const common = require('../../utils/common');
const schema = require('../../shared/schema');

const T = seed.buildTables();
const COMPANY_BY_ID = {};
T.companies.forEach((c) => { COMPANY_BY_ID[c._id] = c; });
const ROUTE_BY_ID = {};
T.routes.forEach((r) => { ROUTE_BY_ID[r._id] = r; });

describe('规模：符合 PRD「20~50 家公司」', () => {
  test('公司数量在 20~50 之间', () => {
    ok(T.companies.length >= 20, '至少 20 家，实际 ' + T.companies.length);
    ok(T.companies.length <= 50, '至多 50 家，实际 ' + T.companies.length);
  });

  test('三张表的条数都大于 0', () => {
    ok(T.routes.length > 0);
    ok(T.routeCompanies.length > 0);
  });

  test('关联数不少于公司数（平均每家至少 1 条线路）', () => {
    ok(T.routeCompanies.length >= T.companies.length);
  });
});

describe('主键与必填字段', () => {
  test('每家公司都有 _id 且唯一', () => {
    const seen = {};
    T.companies.forEach((c) => {
      ok(c._id, '公司缺 _id');
      ok(!seen[c._id], '_id 重复：' + c._id);
      seen[c._id] = 1;
    });
  });

  test('每条线路都有 _id 且唯一', () => {
    const seen = {};
    T.routes.forEach((r) => {
      ok(r._id);
      ok(!seen[r._id], '_id 重复：' + r._id);
      seen[r._id] = 1;
    });
  });

  test('每条关联都有 _id 且唯一', () => {
    const seen = {};
    T.routeCompanies.forEach((l) => {
      ok(l._id);
      ok(!seen[l._id], '_id 重复：' + l._id);
      seen[l._id] = 1;
    });
  });

  test('公司必备字段齐全', () => {
    // schema.COMPANY_FIELDS 是「字段名 → 字段名」的映射对象，取其键。
    // backupPhone 是可选字段（真实场景确实存在只有单一联系方式的公司），
    // 这里也排除，但下方「演示覆盖面」会单独断言主电话 100% 有值。
    const OPTIONAL = { updatedAt: 1, backupPhone: 1 };
    const fields = Object.keys(schema.COMPANY_FIELDS).filter((f) => !OPTIONAL[f]);
    ok(fields.length > 0, 'schema.COMPANY_FIELDS 不应为空');
    T.companies.forEach((c) => {
      fields.forEach((f) => {
        ok(c[f] !== undefined && c[f] !== null && c[f] !== '', c.name + ' 缺字段 ' + f);
      });
    });
  });

  test('备用电话允许为空，但填了就必须是合法号码', () => {
    const bad = T.companies.filter((c) => c.backupPhone && !common.isPhoneLike(c.backupPhone));
    eq(bad.length, 0, '备用电话格式异常：' + bad.map((c) => c.name).join(','));
  });

  test('线路必备字段齐全', () => {
    T.routes.forEach((r) => {
      ['fromCity', 'toCity', 'routeKey', 'companyCount'].forEach((f) => {
        ok(r[f] !== undefined && r[f] !== null && r[f] !== '', r._id + ' 缺字段 ' + f);
      });
    });
  });

  test('关联必备字段齐全', () => {
    T.routeCompanies.forEach((l) => {
      ['routeId', 'companyId', 'routeKey'].forEach((f) => {
        ok(l[f] !== undefined && l[f] !== null && l[f] !== '', l._id + ' 缺字段 ' + f);
      });
    });
  });
});

describe('★ 零缺失：三个筛选条件必须真实可演示', () => {
  test('每条关联都有 transitDays 且 > 0', () => {
    const bad = T.routeCompanies.filter((l) => {
      const d = Number(l.transitDays);
      return !isFinite(d) || d <= 0;
    });
    eq(bad.length, 0, '时效缺失的关联：' + bad.map((l) => l._id).join(','));
  });

  test('每条关联都有 isDirect 布尔值', () => {
    const bad = T.routeCompanies.filter((l) => typeof l.isDirect !== 'boolean');
    eq(bad.length, 0, '直达字段缺失：' + bad.map((l) => l._id).join(','));
  });

  test('每条关联的 frequency 都在枚举内', () => {
    const allowed = schema.FREQUENCY_OPTIONS.map((o) => o.value);
    const bad = T.routeCompanies.filter((l) => allowed.indexOf(l.frequency) < 0);
    eq(bad.length, 0, '频率不合法：' + bad.map((l) => l._id + '=' + l.frequency).join(','));
  });

  test('每家公司都有主电话', () => {
    const bad = T.companies.filter((c) => !c.phone);
    eq(bad.length, 0, '无电话公司：' + bad.map((c) => c.name).join(','));
  });

  test('每家公司都有发站（departureStations 非空）', () => {
    const bad = T.companies.filter((c) => !Array.isArray(c.departureStations) || !c.departureStations.length);
    eq(bad.length, 0, '无发站公司：' + bad.map((c) => c.name).join(','));
  });

  test('发站的地址与电话都不为空', () => {
    const bad = [];
    T.companies.forEach((c) => {
      c.departureStations.forEach((s) => {
        if (!s.address || !s.phone) bad.push(c.name);
      });
    });
    eq(bad.length, 0, '发站信息不全：' + bad.join(','));
  });

  test('电话格式都像电话（过 isPhoneLike）', () => {
    const bad = [];
    T.companies.forEach((c) => {
      if (!common.isPhoneLike(c.phone)) bad.push(c.name + ':' + c.phone);
      if (c.backupPhone && !common.isPhoneLike(c.backupPhone)) bad.push(c.name + '(备):' + c.backupPhone);
    });
    eq(bad.length, 0, '电话格式异常：' + bad.join(','));
  });

  test('三个筛选都至少能筛出结果（演示不能空）', () => {
    const search = require('../../utils/search');
    const rows = T.routeCompanies.map((l) => ({
      link: l,
      company: COMPANY_BY_ID[l.companyId] || {},
      route: ROUTE_BY_ID[l.routeId] || {}
    }));
    ok(search.filterRows(rows, { direct: true }).length > 0, '「只看直达」筛出 0 条');
    ok(search.filterRows(rows, { daily: true }).length > 0, '「天天发车」筛出 0 条');
    ok(search.filterRows(rows, { maxDays: 2 }).length > 0, '「≤2 天」筛出 0 条');
  });
});

describe('外键完整性', () => {
  test('每条关联的 companyId 都能找到公司', () => {
    const bad = T.routeCompanies.filter((l) => !COMPANY_BY_ID[l.companyId]);
    eq(bad.length, 0, '悬空 companyId：' + bad.map((l) => l.companyId).join(','));
  });

  test('每条关联的 routeId 都能找到线路', () => {
    const bad = T.routeCompanies.filter((l) => !ROUTE_BY_ID[l.routeId]);
    eq(bad.length, 0, '悬空 routeId：' + bad.map((l) => l.routeId).join(','));
  });

  test('关联的 routeKey 与线路表一致', () => {
    const bad = T.routeCompanies.filter((l) => {
      const r = ROUTE_BY_ID[l.routeId];
      return !r || r.routeKey !== l.routeKey;
    });
    eq(bad.length, 0, 'routeKey 不一致：' + bad.map((l) => l._id).join(','));
  });

  test('线路的 routeKey 等于 buildRouteKey(fromCity, toCity)', () => {
    const bad = T.routes.filter((r) => common.buildRouteKey(r.fromCity, r.toCity) !== r.routeKey);
    eq(bad.length, 0, 'routeKey 派生错误：' + bad.map((r) => r._id).join(','));
  });

  test('routeKey 不含「市/区/县/省」后缀（否则同一线路会分裂成两条）', () => {
    const bad = T.routes.filter((r) => /[市省区县]$/.test(r.routeKey));
    eq(bad.length, 0, '未归一：' + bad.map((r) => r.routeKey).join(','));
  });

  test('同一 routeKey 只对应一条线路（不允许重复建线）', () => {
    const seen = {};
    T.routes.forEach((r) => {
      ok(!seen[r.routeKey], 'routeKey 重复：' + r.routeKey);
      seen[r.routeKey] = 1;
    });
  });

  test('同一公司对同一线路只有一条关联（防重复挂载）', () => {
    const seen = {};
    T.routeCompanies.forEach((l) => {
      const k = l.companyId + '@' + l.routeId;
      ok(!seen[k], '关联重复：' + k);
      seen[k] = 1;
    });
  });
});

describe('companyCount 与实际关联数一致（数据一致性护栏）', () => {
  test('每条线路的 companyCount = 挂载的公司数', () => {
    const real = {};
    T.routeCompanies.forEach((l) => {
      real[l.routeId] = (real[l.routeId] || 0) + 1;
    });
    const bad = T.routes.filter((r) => (real[r._id] || 0) !== r.companyCount);
    eq(
      bad.length, 0,
      '不一致：' + bad.map((r) => r.routeKey + ' 标 ' + r.companyCount + ' 实 ' + (real[r._id] || 0)).join(' | ')
    );
  });

  test('companyCount 都 ≥ 1（没有空线路）', () => {
    const bad = T.routes.filter((r) => !(r.companyCount >= 1));
    eq(bad.length, 0, '空线路：' + bad.map((r) => r.routeKey).join(','));
  });
});

describe('演示覆盖面', () => {
  test('出发城市含济南之外的城市（支撑反向查询演示）', () => {
    const cities = {};
    T.routes.forEach((r) => { cities[r.fromCity] = 1; });
    const others = Object.keys(cities).filter((c) => c !== '济南');
    ok(others.length > 0, '全是济南出发，反向查询无从演示');
  });

  test('出发城市数量 ≥ 5（够撑起公司详情分组）', () => {
    const cities = {};
    T.routes.forEach((r) => { cities[r.fromCity] = 1; });
    ok(Object.keys(cities).length >= 5, '实际 ' + Object.keys(cities).length);
  });

  test('至少有一条非直达线路（让「只看直达」有对比意义）', () => {
    ok(T.routeCompanies.some((l) => l.isDirect === false));
  });

  test('至少有一家未核实公司（让「已核实」标签有对比）', () => {
    ok(T.companies.some((c) => c.verified === false));
  });

  test('三种规模都存在', () => {
    ['large', 'medium', 'small'].forEach((s) => {
      ok(T.companies.some((c) => c.scale === s), '缺规模 ' + s);
    });
  });

  test('至少一家有多条线路（公司详情页才有多分组）', () => {
    const cnt = {};
    T.routeCompanies.forEach((l) => { cnt[l.companyId] = (cnt[l.companyId] || 0) + 1; });
    ok(Object.keys(cnt).some((k) => cnt[k] >= 3), '没有线路足够多的公司');
  });

  test('至少一条线路挂多家公司（线路详情页才有比价意义）', () => {
    ok(T.routes.some((r) => r.companyCount >= 3), '没有足够多公司竞争的线路');
  });

  test('价格备注与备注文案有覆盖面（详情页不显空）', () => {
    const withPrice = T.routeCompanies.filter((l) => common.hasText(l.priceNote)).length;
    ok(withPrice >= T.routeCompanies.length * 0.5, '价格备注填写率过低：' + withPrice);
  });
});

describe('确定性（测试可断言相对时间）', () => {
  test('BASE_TIME 固定为 2026-09-19 12:00', () => {
    eq(seed.BASE_TIME, Date.parse('2026-09-19T12:00:00+08:00'));
  });

  test('两次 buildTables 结果完全一致', () => {
    const a = JSON.stringify(seed.buildTables());
    const b = JSON.stringify(seed.buildTables());
    eq(a, b, 'buildTables 不是纯函数');
  });

  test('公司名称为虚构（不含真实企业标识性后缀组合强度过高者免检，此处只查非空）', () => {
    T.companies.forEach((c) => ok(c.name.length >= 4, c.name));
  });
});

describe('隐私：不写入手机号以外的敏感信息（样板数据合规）', () => {
  test('没有任何字段像身份证号', () => {
    const t = JSON.stringify(T);
    ok(!/\d{17}[\dXx]/.test(t), '疑似身份证号');
  });

  test('没有任何字段像邮箱', () => {
    const t = JSON.stringify(T);
    ok(!/[\w.-]+@[\w-]+\.[a-z]{2,}/i.test(t), '疑似邮箱');
  });

  test('不存在定位坐标字段（本项目不使用定位）', () => {
    const t = JSON.stringify(T);
    ok(!/"latitude"|"longitude"/.test(t), '不应含坐标');
  });
});

process.exit(summary('data/seed-data.js') ? 0 : 1);
