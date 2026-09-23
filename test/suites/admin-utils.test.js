#!/usr/bin/env node
/**
 * 小程序端后台（utils/admin.js）的纯函数测试
 *
 * 为什么单独测它：
 *   后台的每一次「保存」都要经过 记录 → 表单(rowToForm) → 提交(formToPayload) 这一来一回。
 *   这段转换里任何一处写错，用户看到的表单值就是错的，而且**保存后才会发现** ——
 *   典型的静默数据损坏（不报错，只是数据慢慢变脏）。
 *   它不碰 wx.*，可以在 Node 里直接跑，没有理由不测。
 *
 * 重点守住三处易错点：
 *   1. 站点文本 ↔ 数组 的往返（地址里带竖线、只填地址、空行）
 *   2. 日期 ↔ 时间戳 的往返（0 表示不限，不能被当成「1970-01-01」）
 *   3. picker 的值取自 values 而不是 index（index 会随选项列表变化而错位）
 */

const { describe, test, eq, ok, deepEq, summary, settle } = require('../framework');
const admin = require('../../utils/admin');

/* ============================================================
 * 站点文本 ↔ 数组
 * ============================================================ */

describe('站点文本与数组互转', () => {
  test('数组 → 文本：地址 + 电话用竖线连', () => {
    eq(
      admin.stationsToText([
        { address: '济南市天桥区物流园 1 号', phone: '0531-88880000' }
      ]),
      '济南市天桥区物流园 1 号 | 0531-88880000'
    );
  });

  test('数组 → 文本：只有地址时不带竖线', () => {
    eq(admin.stationsToText([{ address: '济南西站货场', phone: '' }]), '济南西站货场');
  });

  test('数组 → 文本：空项被跳过', () => {
    eq(admin.stationsToText([{ address: '', phone: '' }, null]), '');
  });

  test('文本 → 数组：每行一个站点', () => {
    deepEq(
      admin.textToStations('A | 111\nB | 222'),
      [{ address: 'A', phone: '111' }, { address: 'B', phone: '222' }]
    );
  });

  test('文本 → 数组：空行被跳过', () => {
    deepEq(admin.textToStations('A | 111\n\n\nB | 222\n'), [
      { address: 'A', phone: '111' },
      { address: 'B', phone: '222' }
    ]);
  });

  test('文本 → 数组：只有地址时电话为空串', () => {
    deepEq(admin.textToStations('济南西站货场'), [{ address: '济南西站货场', phone: '' }]);
  });

  test('往返一致：数组 → 文本 → 数组', () => {
    const src = [
      { address: '济南市天桥区物流园 1 号', phone: '0531-88880000' },
      { address: '广州白云区货运市场', phone: '020-88889999' }
    ];
    deepEq(admin.textToStations(admin.stationsToText(src)), src);
  });

  test('非数组输入不炸', () => {
    eq(admin.stationsToText(null), '');
    deepEq(admin.textToStations(''), []);
  });
});

/* ============================================================
 * 日期 ↔ 时间戳
 * ============================================================ */

describe('日期与时间戳互转', () => {
  test('时间戳 → 日期', () => {
    eq(admin.tsToDate(new Date(2026, 8, 22, 10, 30, 0).getTime()), '2026-09-22');
  });

  test('0 与非法值 → 空串（0 的含义是「不限」，不能显示成 1970-01-01）', () => {
    eq(admin.tsToDate(0), '');
    eq(admin.tsToDate(''), '');
    eq(admin.tsToDate(NaN), '');
    eq(admin.tsToDate(null), '');
  });

  test('日期 → 当天零点时间戳', () => {
    eq(admin.dateToTs('2026-09-22'), new Date(2026, 8, 22, 0, 0, 0, 0).getTime());
  });

  test('非法日期 → 0', () => {
    eq(admin.dateToTs(''), 0);
    eq(admin.dateToTs('2026/09/22'), 0);
    eq(admin.dateToTs('不是日期'), 0);
  });

  test('往返一致：日期 → 时间戳 → 日期', () => {
    eq(admin.tsToDate(admin.dateToTs('2026-01-05')), '2026-01-05');
  });
});

/* ============================================================
 * 类型元信息
 * ============================================================ */

describe('类型元信息', () => {
  test('六类齐全，与云函数 COLLECTION_OF 对齐', () => {
    deepEq(admin.TYPE_KEYS.sort(), [
      'announcements', 'companies', 'corrections', 'featured', 'links', 'routes'
    ]);
  });

  test('纠错不可编辑（内容是用户凭证，只能审核不能改）', () => {
    eq(admin.TYPES.corrections.editable, false);
    eq(admin.TYPES.corrections.deletable, true);
  });

  test('必填字段都有 label（否则表单会显示一个空标签）', () => {
    admin.TYPE_KEYS.forEach((k) => {
      admin.TYPES[k].fields.forEach((f) => {
        ok(!!f.label, k + '.' + f.key + ' 缺 label');
      });
    });
  });

  test('picker 字段要么自带 options，要么声明 source（二选一，否则下拉是空的）', () => {
    admin.TYPE_KEYS.forEach((k) => {
      admin.TYPES[k].fields.forEach((f) => {
        if (f.kind !== 'picker') return;
        ok(!!f.options || !!f.source, k + '.' + f.key + ' 的 picker 既没有 options 也没有 source');
      });
    });
  });

  test('关联表把时效/直达/频率挂在关联上（不挂公司表）', () => {
    const keys = admin.TYPES.links.fields.map((f) => f.key);
    ok(keys.indexOf('transitDays') >= 0);
    ok(keys.indexOf('isDirect') >= 0);
    ok(keys.indexOf('frequency') >= 0);
    eq(admin.TYPES.companies.fields.map((f) => f.key).indexOf('transitDays'), -1);
  });
});

/* ============================================================
 * 表单构建 / 回填 / 回传
 * ============================================================ */

describe('表单值转换', () => {
  test('blankForm 给每个字段一个默认值', () => {
    const f = admin.blankForm('companies');
    eq(f.name, '');
    eq(f.scale, 'small');      // picker 的 def
    eq(f.verified, false);     // switch 的 def
  });

  test('rowToForm：开关按布尔回填', () => {
    const f = admin.rowToForm('announcements', { title: 'a', content: 'b', enabled: false });
    eq(f.enabled, false);
    const g = admin.rowToForm('announcements', { title: 'a', content: 'b', enabled: true });
    eq(g.enabled, true);
  });

  test('rowToForm：日期按 YYYY-MM-DD 回填', () => {
    const f = admin.rowToForm('announcements', { startAt: admin.dateToTs('2026-09-22') });
    eq(f.startAt, '2026-09-22');
  });

  test('rowToForm：站点数组回填成文本', () => {
    const f = admin.rowToForm('companies', {
      name: 'x', phone: '1',
      departureStations: [{ address: 'A', phone: '111' }]
    });
    eq(f.departureStations, 'A | 111');
  });

  test('formToPayload：日期转回时间戳', () => {
    const p = admin.formToPayload('announcements', {
      title: 'a', content: 'b', level: 'info', link: '', enabled: true,
      sortOrder: 10, startAt: '2026-09-22', endAt: ''
    });
    eq(p.startAt, admin.dateToTs('2026-09-22'));
    eq(p.endAt, 0);
  });

  test('formToPayload：空的数字字段转 null（不是 0，0 会被当成真的时效）', () => {
    const p = admin.formToPayload('links', {
      routeId: 'r1', companyId: 'c1', transitDays: '', isDirect: false,
      frequency: '', priceNote: '', remark: ''
    });
    eq(p.transitDays, null);
  });

  test('formToPayload：站点文本转数组', () => {
    const p = admin.formToPayload('companies', {
      name: 'x', phone: '1', scale: 'small', verified: false,
      departureStations: 'A | 111\nB | 222', arrivalStations: ''
    });
    deepEq(p.departureStations, [{ address: 'A', phone: '111' }, { address: 'B', phone: '222' }]);
    deepEq(p.arrivalStations, []);
  });

  test('往返一致：记录 → 表单 → 提交数据（电话与城市不被吃掉）', () => {
    const row = {
      _id: 'comp_1', name: '济南鲁通物流', shortName: '鲁通', phone: '0531-88880000',
      city: '济南', scale: 'medium', verified: true,
      departureStations: [{ address: 'A', phone: '111' }], arrivalStations: []
    };
    const payload = admin.formToPayload('companies', admin.rowToForm('companies', row));
    eq(payload.name, '济南鲁通物流');
    eq(payload.phone, '0531-88880000');
    eq(payload.city, '济南');
    eq(payload.scale, 'medium');
    eq(payload.verified, true);
    deepEq(payload.departureStations, [{ address: 'A', phone: '111' }]);
  });
});

/* ============================================================
 * 列表行展示
 * ============================================================ */

describe('列表行展示', () => {
  test('公司：标题是名称，副标题是城市 + 电话', () => {
    const r = admin.buildRow('companies', { _id: 'c1', name: '鲁通', city: '济南', phone: '0531-1', verified: true, scale: 'large' });
    eq(r.title, '鲁通');
    eq(r.sub, '济南 · 0531-1');
    eq(r.chips.length, 2);
  });

  test('线路：公司数为 0 时给「空线路」提示而不是显示 0', () => {
    const r = admin.buildRow('routes', { _id: 'r1', routeKey: '济南-广州', companyCount: 0 });
    eq(r.sub, '还没有公司跑这条线');
    eq(r.chips[0].text, '空线路');
  });

  test('关联：时效缺失要显式标出来（用户最想知道的就是几天到）', () => {
    const r = admin.buildRow('links', {
      _id: 'l1',
      link: { transitDays: null, isDirect: true, frequency: 'daily' },
      route: { routeKey: '济南-广州' },
      company: { name: '鲁通' }
    });
    eq(r.title, '济南-广州');
    eq(r.sub, '鲁通');
    ok(r.chips.some((c) => c.text === '时效未填'));
  });

  test('关联：有实效时显示天数', () => {
    const r = admin.buildRow('links', {
      _id: 'l1',
      link: { transitDays: 2, isDirect: false, frequency: '' },
      route: { routeKey: '济南-广州' },
      company: { name: '鲁通' }
    });
    ok(r.chips.some((c) => c.text === '2 天'));
  });

  test('公告：下线状态要看得出来', () => {
    const r = admin.buildRow('announcements', { _id: 'a1', title: '停运通知', level: 'warning', enabled: false });
    ok(r.chips.some((c) => c.text === '已下线'));
    ok(r.chips.some((c) => c.text === '重要'));
  });

  test('纠错：状态徽章 + 类型标签', () => {
    const r = admin.buildRow('corrections', {
      _id: 'k1', targetSummary: '鲁通', type: 'phone_wrong', status: 'pending',
      content: '电话打不通', createdAt: admin.dateToTs('2026-09-22')
    });
    eq(r.title, '鲁通');
    ok(r.sub.indexOf('电话有误') === 0);
    ok(r.chips.some((c) => c.text === '待审核'));
  });

  test('未知类型不炸（返回一个空壳行，页面不会白屏）', () => {
    const r = admin.buildRow('unknown', { _id: 'x' });
    eq(r.title, '');
    eq(r.chips.length, 0);
  });
});

/* ============================================================
 * 错误码归类
 * ============================================================ */

describe('错误码归类', () => {
  test('没权限 / 没配置 / 没部署 / 库没初始化 是「再试也没用」的错', () => {
    eq(admin.isFatal('NOT_ADMIN'), true);
    eq(admin.isFatal('NOT_CONFIGURED'), true);
    eq(admin.isFatal('NO_FUNC'), true);
    eq(admin.isFatal('NO_OPENID'), true);
    eq(admin.isFatal('NOT_SEEDED'), true);
  });

  test('网络 / 校验失败 是可以重试或修正的', () => {
    eq(admin.isFatal('NETWORK'), false);
    eq(admin.isFatal('INVALID'), false);
    eq(admin.isFatal(''), false);
  });
});

settle().then(() => {
  process.exit(summary('admin-utils') ? 0 : 1);
});
