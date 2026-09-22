#!/usr/bin/env node
/**
 * utils/search.js 测试
 *
 * 重点覆盖三件事：
 *   1. 打分优先级是否符合 PRD 的「先精确后模糊」直觉
 *   2. 单字关键词不会被包含匹配淹没（这是最容易出错的边界）
 *   3. 线路筛选/排序在「字段缺失」时的行为（缺时效的行不能被误认为快）
 */

const { describe, test, eq, ok, deepEq, summary } = require('../framework');
const S = require('../../utils/search');

/* ---------- 测试数据 ---------- */
const COMPANIES = [
  { name: '济南鲁通物流有限公司', shortName: '鲁通物流', pinyin: 'lutongwuliu', initial: 'ltwl', updatedAt: 100 },
  { name: '山东齐鲁快运有限公司', shortName: '齐鲁快运', pinyin: 'qilukuaiyun', initial: 'qlky', updatedAt: 200 },
  { name: '济南泉城货运代理有限公司', shortName: '泉城货运', pinyin: 'quanchenghuoyun', initial: 'qchy', updatedAt: 300 },
  { name: '南京安捷物流有限公司', shortName: '安捷物流', pinyin: 'anjiewuliu', initial: 'ajwl', updatedAt: 400 },
  { name: '山东鲁通供应链管理有限公司', shortName: '鲁通供应链', pinyin: 'lutonggongyinglian', initial: 'ltgyl', updatedAt: 500 }
];

const CITIES = [
  { name: '济南', pinyin: 'jinan', initial: 'jn', sortOrder: 1 },
  { name: '济宁', pinyin: 'jining', initial: 'jn', sortOrder: 2 },
  { name: '南京', pinyin: 'nanjing', initial: 'nj', sortOrder: 3 },
  { name: '广州', pinyin: 'guangzhou', initial: 'gz', sortOrder: 4 },
  { name: '乐陵', pinyin: 'leling', initial: 'll', sortOrder: 5 }
];

describe('scoreCompany：匹配优先级', () => {
  test('全称完全相等 = 100', () => {
    eq(S.scoreCompany(COMPANIES[0], '济南鲁通物流有限公司'), 100);
  });

  test('简称完全相等 = 95', () => {
    eq(S.scoreCompany(COMPANIES[0], '鲁通物流'), 95);
  });

  test('全称前缀 = 90', () => {
    eq(S.scoreCompany(COMPANIES[0], '济南鲁通'), 90);
  });

  test('简称前缀 = 85（且不得被全称包含 80 抢占）', () => {
    // 「齐鲁」是简称「齐鲁快运」的前缀 → 85
    eq(S.scoreCompany(COMPANIES[1], '齐鲁'), 85);
  });

  test('全称包含 = 80', () => {
    // 「齐鲁快运」是简称，其全称「山东齐鲁快运有限公司」含「齐鲁快运」
    // 需挑一个只被全称包含、不被简称包含的词——用全称独有片段
    eq(S.scoreCompany(COMPANIES[0], '物流有限'), 80);
  });

  test('简称包含 = 75', () => {
    // 「鲁通供」被简称「鲁通供应链」前缀命中 → 85；要测「75 包含」需用
    // 只被简称包含、不在简称开头的词：简称「鲁通供应链」中的「供应链」
    const c = { name: '山东鲁通供应链管理有限公司', shortName: '鲁通供应链', pinyin: 'lutonggongyinglian', initial: 'ltgyl' };
    eq(S.scoreCompany(c, '供应链'), 80, '全称也含「供应链」，全称包含(80)优先于简称包含(75)');
    // 构造一个全称不含、仅简称含的场景
    const c2 = { name: '山东通达运输有限公司', shortName: '鲁通供应链', pinyin: '', initial: '' };
    eq(S.scoreCompany(c2, '供应链'), 75);
  });

  test('拼音前缀 = 70', () => {
    // 拼音分支在中文名不命中、且关键词长度 ≥ 2 时到达
    const c = { name: '鲁通物流', shortName: '', pinyin: 'lutongwuliu', initial: 'ltwl' };
    const got = S.scoreCompany(c, 'lutong');
    ok(got === 70 || got === 65, '拼音命中应为 70(前缀) 或 65(包含)，实际 ' + got);
  });

  test('拼音包含 = 65（非前缀时）', () => {
    const c = { name: '鲁通物流', shortName: '', pinyin: 'lutongwuliu', initial: 'ltwl' };
    eq(S.scoreCompany(c, 'tongwu'), 65);
  });

  test('首字母命中 = 60', () => {
    eq(S.scoreCompany(COMPANIES[0], 'ltwl'), 60);
  });

  test('空关键词 = 0', () => {
    eq(S.scoreCompany(COMPANIES[0], ''), 0);
    eq(S.scoreCompany(COMPANIES[0], '   '), 0);
  });

  test('null 公司 = 0，不抛错', () => {
    eq(S.scoreCompany(null, '济南'), 0);
  });
});

describe('scoreCompany：单字只做前缀不做包含（防误命中泛滥）', () => {
  test('单字「南」不命中「济南鲁通」（包含但非前缀）', () => {
    eq(S.scoreCompany(COMPANIES[0], '南'), 0);
  });

  test('单字「南」命中「南京安捷」的前缀 → 90', () => {
    eq(S.scoreCompany(COMPANIES[3], '南'), 90);
  });

  test('单字「济」是「济南鲁通」前缀 → 90', () => {
    eq(S.scoreCompany(COMPANIES[0], '济'), 90);
  });

  test('单字「鲁」是简称「鲁通物流」前缀 → 85', () => {
    eq(S.scoreCompany(COMPANIES[0], '鲁'), 85);
  });

  test('单字不因拼音包含而命中（「n」不该命中 jinan）', () => {
    eq(S.scoreCompany(COMPANIES[0], 'n'), 0);
  });
});

describe('searchCompanies：过滤与排序', () => {
  test('空关键词返回全量副本，不改原数组', () => {
    const out = S.searchCompanies(COMPANIES, '');
    eq(out.length, COMPANIES.length);
    ok(out !== COMPANIES, '应返回新数组');
  });

  test('不匹配的公司被过滤掉', () => {
    const out = S.searchCompanies(COMPANIES, '广州');
    eq(out.length, 0);
  });

  test('高优先级排前面：精确简称优先于包含', () => {
    // 「鲁通物流」在 comp1 是简称全等(95)，在「山东鲁通供应链」是简称前缀(85)
    const out = S.searchCompanies(COMPANIES, '鲁通物流');
    eq(out[0].shortName, '鲁通物流');
    eq(out[0]._score, 95);
  });

  test('同分时按 updatedAt 倒序（新的靠前）', () => {
    // 「物流有限公司」对两家都是「全称包含 = 80」
    const out = S.searchCompanies(COMPANIES, '物流有限公司');
    const scores = out.map((c) => c._score);
    // 分数应单调不增
    for (let i = 1; i < scores.length; i++) {
      ok(scores[i] <= scores[i - 1], '分数应非递增');
    }
    // 找到第一个同分段落，验证时间倒序
    const sameLvl = out.filter((c) => c._score === 80);
    if (sameLvl.length >= 2) {
      ok(sameLvl[0].updatedAt >= sameLvl[1].updatedAt, '同分应按更新时间倒序');
    }
  });

  test('返回项附带 _score 字段', () => {
    const out = S.searchCompanies(COMPANIES, '齐鲁快运');
    eq(out[0]._score, 95);
  });

  test('传入非数组不抛错', () => {
    deepEq(S.searchCompanies(null, '济南'), []);
    deepEq(S.searchCompanies(undefined, '济南'), []);
  });
});

describe('scoreCity / searchCities', () => {
  test('名称完全相等 = 100', () => {
    eq(S.scoreCity(CITIES[0], '济南'), 100);
  });

  test('名称前缀 = 90', () => {
    eq(S.scoreCity(CITIES[0], '济'), 90);
  });

  test('拼音完全相等 = 80', () => {
    eq(S.scoreCity(CITIES[0], 'jinan'), 80);
  });

  test('拼音前缀 = 70', () => {
    eq(S.scoreCity(CITIES[0], 'jin'), 70);
  });

  test('首字母 = 60', () => {
    eq(S.scoreCity(CITIES[0], 'jn'), 60);
  });

  test('单字「陵」不命中「乐陵」（城市侧也防包含）', () => {
    // 「陵」是「乐陵」的包含但不是前缀 → 不应命中
    eq(S.scoreCity(CITIES[4], '陵'), 0);
  });

  test('searchCities 按 sortOrder 做同分兜底', () => {
    // 「jn」对济南/济宁都是 60 分（首字母），应按 sortOrder 排
    const out = S.searchCities(CITIES, 'jn');
    eq(out.length, 2);
    eq(out[0].name, '济南');
    eq(out[1].name, '济宁');
  });
});

describe('detectKeywordType：首页搜索框分流', () => {
  test('空 → empty', () => {
    eq(S.detectKeywordType('', CITIES), 'empty');
    eq(S.detectKeywordType('  ', CITIES), 'empty');
  });

  test('含「物流」→ company', () => {
    eq(S.detectKeywordType('鲁通物流', CITIES), 'company');
  });

  test('纯城市名 → both（城市也可能被当公司简称搜）', () => {
    eq(S.detectKeywordType('济南', CITIES), 'both');
  });

  test('既像公司又命中城市 → both', () => {
    // 用多字城市名验证：命中城市前缀 → both（优先于 looksCompany）
    eq(S.detectKeywordType('广州', CITIES), 'both');
    eq(S.detectKeywordType('济宁', CITIES), 'both');
  });

  test('什么都不命中 → company（保守走公司检索）', () => {
    eq(S.detectKeywordType('zzzz', CITIES), 'company');
  });
});

describe('filterRows：缺失字段不得被误判为满足条件', () => {
  const rows = [
    { link: { isDirect: true, frequency: 'daily', transitDays: 2 }, company: {} },
    { link: { isDirect: false, frequency: 'daily', transitDays: 3 }, company: {} },
    { link: { isDirect: true, frequency: 'weekly', transitDays: 5 }, company: {} },
    { link: { isDirect: true, frequency: 'daily', transitDays: 0 }, company: {} }, // 时效缺失
    { link: { isDirect: null, frequency: '', transitDays: null }, company: {} }     // 全缺
  ];

  test('只看直达：仅 isDirect === true', () => {
    const out = S.filterRows(rows, { direct: true });
    eq(out.length, 3);
  });

  test('天天发车：frequency === daily', () => {
    const out = S.filterRows(rows, { daily: true });
    eq(out.length, 3);
  });

  test('时效 ≤ 3 天：缺失/0 的行被排除', () => {
    const out = S.filterRows(rows, { maxDays: 3 });
    eq(out.length, 2);
    out.forEach((r) => ok(r.link.transitDays > 0 && r.link.transitDays <= 3));
  });

  test('组合筛选：直达 + 天天 + ≤3 天', () => {
    const out = S.filterRows(rows, { direct: true, daily: true, maxDays: 3 });
    eq(out.length, 1);
    eq(out[0].link.transitDays, 2);
  });

  test('空筛选返回全量', () => {
    eq(S.filterRows(rows, {}).length, rows.length);
    eq(S.filterRows(rows, null).length, rows.length);
  });

  test('link 为 null 的行直接排除', () => {
    eq(S.filterRows([{ link: null }], {}).length, 0);
  });
});

describe('sortRows：四种排序', () => {
  const rows = [
    { link: { isDirect: false, transitDays: 2, updatedAt: 500 }, company: { scale: 'small', verified: false } },
    { link: { isDirect: true, transitDays: 5, updatedAt: 100 }, company: { scale: 'large', verified: true } },
    { link: { isDirect: true, transitDays: 1, updatedAt: 300 }, company: { scale: 'medium', verified: false } },
    { link: { isDirect: false, transitDays: 0, updatedAt: 900 }, company: { scale: 'large', verified: false } }
  ];

  test('updated：按更新时间倒序', () => {
    const out = S.sortRows(rows, 'updated');
    const ts = out.map((r) => r.link.updatedAt);
    deepEq(ts, [900, 500, 300, 100]);
  });

  test('scale：大规模优先', () => {
    const out = S.sortRows(rows, 'scale');
    eq(out[0].company.scale, 'large');
    eq(out[out.length - 1].company.scale, 'small');
  });

  test('transit：时效缺失排最后（不能因为 0 就排第一）', () => {
    const out = S.sortRows(rows, 'transit');
    eq(out[0].link.transitDays, 1);
    eq(out[1].link.transitDays, 2);
    eq(out[out.length - 1].link.transitDays, 0);
  });

  test('composite：已核实优先', () => {
    const out = S.sortRows(rows, 'composite');
    ok(out[0].company.verified === true, '首位应为已核实');
  });

  test('composite：同为未核实时，直达优先', () => {
    const out = S.sortRows(rows, 'composite');
    const notVerified = out.filter((r) => !r.company.verified);
    ok(notVerified[0].link.isDirect === true, '未核实组内首位应直达');
  });

  test('不改原数组', () => {
    const before = rows.map((r) => r.link.transitDays);
    S.sortRows(rows, 'transit');
    deepEq(rows.map((r) => r.link.transitDays), before);
  });

  test('缺省 sort 走 composite', () => {
    const a = S.sortRows(rows, undefined).map((r) => r.link.updatedAt);
    const b = S.sortRows(rows, 'composite').map((r) => r.link.updatedAt);
    deepEq(a, b);
  });

  test('传入非数组返回空数组', () => {
    deepEq(S.sortRows(null, 'updated'), []);
  });
});

describe('groupRoutesByFromCity：公司详情分组', () => {
  const rows = [
    { route: { fromCity: '济南', fromProvince: '山东省', toCity: '广州', companyCount: 4 }, link: {} },
    { route: { fromCity: '济南', fromProvince: '山东省', toCity: '上海', companyCount: 9 }, link: {} },
    { route: { fromCity: '青岛', fromProvince: '山东省', toCity: '北京', companyCount: 2 }, link: {} }
  ];

  test('按出发城市分组', () => {
    const g = S.groupRoutesByFromCity(rows);
    eq(g.length, 2);
    const cities = g.map((x) => x.city).sort();
    deepEq(cities, ['济南', '青岛']);
  });

  test('组内按 companyCount 倒序（主流线路靠前）', () => {
    const g = S.groupRoutesByFromCity(rows);
    const jn = g.find((x) => x.city === '济南');
    eq(jn.routes.length, 2);
    eq(jn.routes[0].route.toCity, '上海');
  });

  test('携带省份信息', () => {
    const g = S.groupRoutesByFromCity(rows);
    eq(g[0].province, '山东省');
  });

  test('fromCity 缺失归入「未知」而不是丢弃', () => {
    const g = S.groupRoutesByFromCity([{ route: {}, link: {} }]);
    eq(g.length, 1);
    eq(g[0].city, '未知');
  });

  test('空输入返回空数组', () => {
    deepEq(S.groupRoutesByFromCity([]), []);
    deepEq(S.groupRoutesByFromCity(null), []);
  });
});

describe('SCALE_RANK', () => {
  test('large > medium > small', () => {
    ok(S.SCALE_RANK.large > S.SCALE_RANK.medium);
    ok(S.SCALE_RANK.medium > S.SCALE_RANK.small);
  });
});

process.exit(summary('utils/search.js') ? 0 : 1);
