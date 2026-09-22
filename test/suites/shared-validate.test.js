#!/usr/bin/env node
/**
 * shared/validate.js 单元测试
 *
 * ★ 为什么单独建一个套件：这个模块是**桌面后台与云函数 adminApi 共用的唯一校验实现**。
 *   它一旦改坏，两边同时失效，而且小程序端的报错会跟后台不一样 —— 所以必须钉住。
 *
 * 重点覆盖：
 *   1. 不传 ctx 时只做字段校验（云函数里查表成本高，可先做一遍快校验）
 *   2. 传 ctx 时唯一性 / 外键存在性生效
 *   3. ★ 线路唯一性必须用 ignoreId 排除自身，不能用 r._id
 *      （线路 _id 由 routeKey 派生，新建重复线路时新旧 _id 相同，
 *        用 r._id 排除会把老记录也排掉 ⇒ 重复线路永远拦不住。真实踩过。）
 */

const { describe, test, ok, eq, summary } = require('../framework');
const v = require('../../shared/validate');

/** 取错误里的 field 列表，便于断言顺序 */
function fields(errs) {
  return errs.map((e) => e.field);
}

function hasMsg(errs, keyword) {
  return errs.some((e) => e.message.indexOf(keyword) >= 0);
}

/* ============================================================ */

describe('公司：字段级校验', () => {
  const base = {
    _id: 'comp_001', name: '顺风物流', city: '济南', phone: '0531-88886666',
    backupPhone: '', scale: 'small'
  };

  test('合法公司通过', () => {
    eq(v.validateCompany(base).length, 0);
  });

  test('缺名称 / 城市 / 电话都会报错，且字段名正确', () => {
    const e = v.validateCompany({ city: '济南', phone: '0531-88886666', scale: 'small' });
    ok(fields(e).indexOf('name') >= 0, '应报 name');
    const e2 = v.validateCompany({ name: 'A', phone: '0531-88886666', scale: 'small' });
    ok(fields(e2).indexOf('city') >= 0, '应报 city');
    const e3 = v.validateCompany({ name: 'A', city: '济南', scale: 'small' });
    ok(fields(e3).indexOf('phone') >= 0, '应报 phone');
  });

  test('主电话格式不对要拦', () => {
    const e = v.validateCompany(Object.assign({}, base, { phone: 'abcdef' }));
    ok(hasMsg(e, '主电话格式不正确'), JSON.stringify(e));
  });

  test('备用电话可留空，填了就必须合法', () => {
    eq(v.validateCompany(Object.assign({}, base, { backupPhone: '' })).length, 0);
    const e = v.validateCompany(Object.assign({}, base, { backupPhone: '123' }));
    ok(hasMsg(e, '备用电话格式不正确'), JSON.stringify(e));
  });

  test('规模不在枚举内要拦', () => {
    const e = v.validateCompany(Object.assign({}, base, { scale: 'huge' }));
    ok(fields(e).indexOf('scale') >= 0, JSON.stringify(e));
  });

  test('不传 ctx 时不查重（纯字段校验）', () => {
    const e = v.validateCompany(base);
    ok(!hasMsg(e, '同名'), JSON.stringify(e));
  });
});

describe('公司：唯一性（传 ctx）', () => {
  const a = { _id: 'comp_001', name: '顺风物流', city: '济南', phone: '0531-88886666', scale: 'small' };

  test('同名不同 id 被拦', () => {
    const e = v.validateCompany(
      { _id: 'comp_002', name: '顺风物流', city: '济南', phone: '0531-11112222', scale: 'small' },
      { companies: [a] }
    );
    ok(hasMsg(e, '已存在同名公司'), JSON.stringify(e));
  });

  test('编辑自己不算重名', () => {
    const e = v.validateCompany(a, { companies: [a] });
    eq(e.length, 0, JSON.stringify(e));
  });
});

/* ============================================================ */

describe('线路：字段级校验', () => {
  test('同城被拦', () => {
    const e = v.validateRoute({ fromCity: '济南市', toCity: '济南市', routeKey: '' });
    ok(hasMsg(e, '同一城市'), JSON.stringify(e));
  });

  test('缺出发 / 到达城市被拦', () => {
    ok(fields(v.validateRoute({ toCity: '广州' })).indexOf('fromCity') >= 0);
    ok(fields(v.validateRoute({ fromCity: '济南' })).indexOf('toCity') >= 0);
  });

  test('未传 routeKey 时现场派生（不采信脏 key）', () => {
    const e = v.validateRoute({ fromCity: '济南', toCity: '济南' });
    ok(hasMsg(e, '同一城市'), JSON.stringify(e));
  });
});

describe('线路：唯一性必须用 ignoreId 排除自身', () => {
  const existing = { _id: 'route_济南_广州', fromCity: '济南', toCity: '广州', routeKey: '济南-广州' };

  /* ★ 这条是真实踩过的坑：_id 由 routeKey 派生，
   *   若用 `x._id !== r._id` 排除自身，新建重复线路时新旧 _id 相同
   *   ⇒ 老记录被一起排掉 ⇒ 重复线路永远拦不住。 */
  test('新建一条已存在的线路：即使 _id 与老记录相同也要被拦', () => {
    const e = v.validateRoute(
      { _id: 'route_济南_广州', fromCity: '济南市', toCity: '广州市', routeKey: '济南-广州' },
      { routes: [existing] }
    );
    ok(hasMsg(e, '该线路已存在'), JSON.stringify(e));
  });

  test('编辑自己不算重复（ignoreId 生效）', () => {
    const e = v.validateRoute(existing, { routes: [existing], ignoreId: existing._id });
    eq(e.length, 0, JSON.stringify(e));
  });

  test('编辑成别人已用的 routeKey 要被拦', () => {
    const other = { _id: 'route_济南_北京', fromCity: '济南', toCity: '北京', routeKey: '济南-北京' };
    const merged = { _id: 'route_济南_广州', fromCity: '济南', toCity: '北京', routeKey: '济南-北京' };
    const e = v.validateRoute(merged, { routes: [existing, other], ignoreId: 'route_济南_广州' });
    ok(hasMsg(e, '该线路已存在'), JSON.stringify(e));
  });
});

/* ============================================================ */

describe('关联：字段级校验', () => {
  const base = { routeId: 'r1', companyId: 'c1', transitDays: 2, frequency: 'daily' };

  test('合法关联通过', () => {
    eq(v.validateLink(base).length, 0);
  });

  test('时效留空允许（表示未知）', () => {
    eq(v.validateLink(Object.assign({}, base, { transitDays: null })).length, 0);
  });

  test('时效负数 / 超过 60 天被拦', () => {
    ok(hasMsg(v.validateLink(Object.assign({}, base, { transitDays: -1 })), '非负数字'));
    ok(hasMsg(v.validateLink(Object.assign({}, base, { transitDays: 61 })), '时效最多 60 天'));
  });

  test('频率必填且必须在枚举内', () => {
    ok(hasMsg(v.validateLink(Object.assign({}, base, { frequency: '' })), '请选择发车频率'));
  });
});

describe('关联：外键与重复（传 ctx）', () => {
  const ctx = {
    routes: [{ _id: 'r1' }],
    companies: [{ _id: 'c1' }],
    links: []
  };

  test('线路 / 公司不存在被拦', () => {
    ok(hasMsg(v.validateLink({ routeId: 'rX', companyId: 'c1', frequency: 'daily' }, ctx), '线路不存在'));
    ok(hasMsg(v.validateLink({ routeId: 'r1', companyId: 'cX', frequency: 'daily' }, ctx), '公司不存在'));
  });

  test('同一公司挂同一线路两次被拦', () => {
    const links = [{ _id: 'rc_001', routeId: 'r1', companyId: 'c1' }];
    const e = v.validateLink(
      { _id: 'rc_002', routeId: 'r1', companyId: 'c1', frequency: 'daily' },
      { routes: ctx.routes, companies: ctx.companies, links: links }
    );
    ok(hasMsg(e, '该公司已挂在这条线路上'), JSON.stringify(e));
  });

  test('编辑自己不算重复', () => {
    const links = [{ _id: 'rc_001', routeId: 'r1', companyId: 'c1' }];
    const e = v.validateLink(
      { _id: 'rc_001', routeId: 'r1', companyId: 'c1', frequency: 'daily' },
      { routes: ctx.routes, companies: ctx.companies, links: links }
    );
    ok(!hasMsg(e, '该公司已挂在这条线路上'), JSON.stringify(e));
  });
});

/* ============================================================ */

describe('公告：三条硬校验', () => {
  const base = { title: '春节放假通知', content: '2 月 10 日起暂停揽收', level: 'info', link: '' };

  test('合法公告通过', () => {
    eq(v.validateAnnouncement(base).length, 0);
  });

  test('正文不能为空（否则点开是空白，像点了没反应）', () => {
    ok(hasMsg(v.validateAnnouncement({ title: 'A' }), '公告正文不能为空'));
  });

  test('标题超过 40 字被拦', () => {
    ok(hasMsg(v.validateAnnouncement(Object.assign({}, base, { title: 'x'.repeat(41) })), '40 字以内'));
  });

  test('★ 外链必须拦（小程序里点了没反应）', () => {
    ok(hasMsg(v.validateAnnouncement(Object.assign({}, base, { link: 'https://a.com' })), '外链'));
    ok(hasMsg(v.validateAnnouncement(Object.assign({}, base, { link: 'pages/index/index' })), '外链'));
  });

  test('本小程序页面路径放行', () => {
    eq(v.validateAnnouncement(Object.assign({}, base, { link: '/pages/privacy/index' })).length, 0);
  });

  test('时间窗倒挂被拦', () => {
    ok(hasMsg(v.validateAnnouncement(Object.assign({}, base, { startAt: 200, endAt: 100 })), '失效时间不能早于'));
  });

  test('级别不在枚举内被拦', () => {
    ok(hasMsg(v.validateAnnouncement(Object.assign({}, base, { level: 'danger' })), '级别不合法'));
  });
});

/* ============================================================ */

describe('推广位：四条硬校验', () => {
  const routes = [{ routeKey: '济南-广州' }];
  const ctxOk = { routes: routes, featured: [] };

  test('合法推广位通过', () => {
    eq(v.validateFeatured({ fromCity: '济南市', toCity: '广州市', tag: '直达', reason: '2 天到' }, ctxOk).length, 0);
  });

  test('★ routeKey 必须真实存在（点进去不能是空页）', () => {
    const e = v.validateFeatured({ fromCity: '济南', toCity: '北京', tag: '直达' }, ctxOk);
    ok(hasMsg(e, '线路库里还没有'), JSON.stringify(e));
  });

  test('★ 同一线路只能推广一次', () => {
    const e = v.validateFeatured(
      { fromCity: '济南', toCity: '广州', tag: '天天发车' },
      { routes: routes, featured: [{ _id: 'feat_001', routeKey: '济南-广州' }] }
    );
    ok(hasMsg(e, '已经在推广位里了'), JSON.stringify(e));
  });

  test('编辑自己不算重复（ignoreId 生效）', () => {
    const e = v.validateFeatured(
      { fromCity: '济南', toCity: '广州', tag: '天天发车' },
      { routes: routes, featured: [{ _id: 'feat_001', routeKey: '济南-广州' }], ignoreId: 'feat_001' }
    );
    ok(!hasMsg(e, '已经在推广位里了'), JSON.stringify(e));
  });

  test('角标必填且 ≤ 8 字', () => {
    ok(hasMsg(v.validateFeatured({ fromCity: '济南', toCity: '广州' }, ctxOk), '角标不能为空'));
    ok(hasMsg(v.validateFeatured({ fromCity: '济南', toCity: '广州', tag: 'x'.repeat(9) }, ctxOk), '8 字以内'));
  });

  test('推荐理由 ≤ 60 字', () => {
    ok(hasMsg(v.validateFeatured({ fromCity: '济南', toCity: '广州', tag: '直达', reason: 'x'.repeat(61) }, ctxOk), '60 字以内'));
  });

  test('同城被拦', () => {
    ok(hasMsg(v.validateFeatured({ fromCity: '济南', toCity: '济南', tag: '直达' }, ctxOk), '同一城市'));
  });
});

/* ============================================================ */

describe('常量导出', () => {
  test('LIMITS 与枚举可供前端复用（不手抄）', () => {
    eq(v.LIMITS.TITLE_MAX, 40);
    eq(v.LIMITS.TAG_MAX, 8);
    eq(v.LIMITS.REASON_MAX, 60);
    ok(v.SCALE_VALUES.indexOf('small') >= 0);
    ok(v.FREQUENCY_VALUES.indexOf('daily') >= 0);
    ok(v.LEVEL_VALUES.indexOf('warning') >= 0);
  });

  test('枚举从 schema 派生（不是手抄的常量）', () => {
    const schema = require('../../shared/schema');
    eq(v.SCALE_VALUES.length, schema.SCALE_OPTIONS.length);
    eq(v.FREQUENCY_VALUES.length, schema.FREQUENCY_OPTIONS.length);
    eq(v.LEVEL_VALUES.length, schema.ANNOUNCEMENT_LEVELS.length);
  });
});

process.exit(summary('shared/validate.js 跨端校验') ? 0 : 1);
