#!/usr/bin/env node
/**
 * utils/common.js 单元测试
 *
 * 覆盖最关键的三个点：
 *   1. routeKey 构造与反解 —— 全站线路定位的地基
 *   2. relativeTime 相对时间 —— PRD 验收 A8「每行能看到 X天前更新」的实现
 *   3. parseStations 站点归一 —— 兼容三种历史数据形态
 */

const { describe, test, eq, ok, deepEq, summary } = require('../framework');
const common = require('../../utils/common');

/* ============================================================
 * 城市归一
 * ============================================================ */
describe('normCity 城市归一', () => {
  test('去掉「市」后缀', () => eq(common.normCity('济南市'), '济南'));
  test('去掉「区」后缀', () => eq(common.normCity('兰山区'), '兰山'));
  test('去掉「县」后缀', () => eq(common.normCity('平阴县'), '平阴'));
  test('去掉「省」后缀', () => eq(common.normCity('山东省'), '山东'));
  test('无后缀不变', () => eq(common.normCity('济南'), '济南'));
  test('空值返回空串', () => eq(common.normCity(null), ''));
  test('只去一层后缀（「济南市区」→「济南市」）', () => eq(common.normCity('济南市区'), '济南市'));
});

/* ============================================================
 * routeKey：全站线路定位的地基
 * ============================================================ */
describe('buildRouteKey 线路主键', () => {
  test('「济南市」与「济南」视为同一城市', () => {
    eq(common.buildRouteKey('济南市', '广州市'), common.buildRouteKey('济南', '广州'));
  });
  test('标准格式为 出发-到达', () => {
    eq(common.buildRouteKey('济南', '广州'), '济南-广州');
  });
  test('往返是两个不同的 key（不能互换）', () => {
    ok(common.buildRouteKey('济南', '广州') !== common.buildRouteKey('广州', '济南'));
  });
  test('缺任一侧返回空串', () => {
    eq(common.buildRouteKey('济南', ''), '');
    eq(common.buildRouteKey('', '广州'), '');
    eq(common.buildRouteKey(null, null), '');
  });
});

describe('parseRouteKey 反解', () => {
  test('正常反解', () => deepEq(common.parseRouteKey('济南-广州'), { fromCity: '济南', toCity: '广州' }));
  test('非法格式返回空', () => deepEq(common.parseRouteKey('济南'), { fromCity: '', toCity: '' }));
  test('三段也返回空（防误切）', () => deepEq(common.parseRouteKey('a-b-c'), { fromCity: '', toCity: '' }));
  test('空值返回空', () => deepEq(common.parseRouteKey(null), { fromCity: '', toCity: '' }));
});

describe('routeTitle 线路展示名', () => {
  test('标准格式', () => eq(common.routeTitle('济南市', '广州市'), '济南 → 广州'));
  test('缺值返回空', () => eq(common.routeTitle('', '广州'), ''));
});

/* ============================================================
 * relativeTime：PRD 验收 A8
 * ============================================================ */
describe('relativeTime 相对时间', () => {
  const NOW = Date.parse('2026-09-19T12:00:00+08:00');
  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  test('缺失返回空串（调用方条件渲染）', () => eq(common.relativeTime(null, NOW), ''));
  test('0 返回空串', () => eq(common.relativeTime(0, NOW), ''));
  test('非法值返回空串', () => eq(common.relativeTime('abc', NOW), ''));
  test('30 秒前 → 刚刚更新', () => eq(common.relativeTime(NOW - 30 * 1000, NOW), '刚刚更新'));
  test('5 分钟前', () => eq(common.relativeTime(NOW - 5 * MIN, NOW), '5分钟前更新'));
  test('3 小时前', () => eq(common.relativeTime(NOW - 3 * HOUR, NOW), '3小时前更新'));
  test('3 天前 → PRD 验收 A8 的示例文案', () => eq(common.relativeTime(NOW - 3 * DAY, NOW), '3天前更新'));
  test('29 天前仍按天计', () => eq(common.relativeTime(NOW - 29 * DAY, NOW), '29天前更新'));
  test('30 天前转月', () => eq(common.relativeTime(NOW - 30 * DAY, NOW), '1个月前更新'));
  test('11 个月前仍按月', () => eq(common.relativeTime(NOW - 330 * DAY, NOW), '11个月前更新'));
  test('400 天前转年', () => eq(common.relativeTime(NOW - 400 * DAY, NOW), '1年前更新'));
  test('★ 未来时间不显示负数（时钟偏差兜底）', () => {
    eq(common.relativeTime(NOW + 10 * DAY, NOW), '刚刚更新');
  });
});

describe('isStale 陈旧判定', () => {
  const NOW = Date.parse('2026-09-19T12:00:00+08:00');
  const DAY = 24 * 60 * 60 * 1000;
  test('89 天前不算陈旧', () => eq(common.isStale(NOW - 89 * DAY, 90, NOW), false));
  test('91 天前算陈旧', () => eq(common.isStale(NOW - 91 * DAY, 90, NOW), true));
  test('无时间视为陈旧', () => eq(common.isStale(null, 90, NOW), true));
});

describe('formatDate 日期格式化', () => {
  test('补零', () => eq(common.formatDate(Date.parse('2026-01-05T00:00:00+08:00')), '2026-01-05'));
  test('空值返回空', () => eq(common.formatDate(null), ''));
});

/* ============================================================
 * 电话处理
 * ============================================================ */
describe('splitPhones 号码拆分', () => {
  test('逗号分隔', () => deepEq(common.splitPhones('0531-123,13800000000'), ['0531-123', '13800000000']));
  test('中文逗号与顿号', () => deepEq(common.splitPhones('a，b、c'), ['a', 'b', 'c']));
  test('★ 保持录入顺序，不做排序（用户明确要求）', () => {
    deepEq(common.splitPhones('13800000003,13800000001,13800000002'),
      ['13800000003', '13800000001', '13800000002']);
  });
  test('去重', () => deepEq(common.splitPhones('111,111,222'), ['111', '222']));
  test('数组输入', () => deepEq(common.splitPhones(['111', '222']), ['111', '222']));
  test('空值返回空数组', () => deepEq(common.splitPhones(null), []));
  test('过滤空片段', () => deepEq(common.splitPhones('111,,222'), ['111', '222']));
});

describe('isPhoneLike 号码形态判定', () => {
  test('座机算号码', () => eq(common.isPhoneLike('0531-88110001'), true));
  test('手机算号码', () => eq(common.isPhoneLike('13805310001'), true));
  test('400 号算号码', () => eq(common.isPhoneLike('400-881-1013'), true));
  test('位数不足不算', () => eq(common.isPhoneLike('12345'), false));
  test('含中文不算', () => eq(common.isPhoneLike('济南市天桥区'), false));
  test('空不算', () => eq(common.isPhoneLike(''), false));
});

/* ============================================================
 * 站点归一：兼容三种历史形态
 * ============================================================ */
describe('parseStations 站点归一', () => {
  test('形态 1：对象数组（标准）', () => {
    deepEq(common.parseStations([{ address: 'A路 1 号', phone: '111' }]),
      [{ address: 'A路 1 号', phone: '111' }]);
  });
  test('形态 1 兼容 addr/tel 别名', () => {
    deepEq(common.parseStations([{ addr: 'A路 1 号', tel: '111' }]),
      [{ address: 'A路 1 号', phone: '111' }]);
  });
  test('形态 2：字符串数组「地址 | 电话」', () => {
    deepEq(common.parseStations(['A路 1 号 | 111', 'B路 2 号 | 222']),
      [{ address: 'A路 1 号', phone: '111' }, { address: 'B路 2 号', phone: '222' }]);
  });
  test('形态 3：整段字符串（换行分隔）', () => {
    deepEq(common.parseStations('A路 1 号 | 111\nB路 2 号 | 222'),
      [{ address: 'A路 1 号', phone: '111' }, { address: 'B路 2 号', phone: '222' }]);
  });
  test('★ 只有电话没有地址时 address 留空（前端据此不渲染地址行）', () => {
    deepEq(common.parseStations(['13800000000']), [{ address: '', phone: '13800000000' }]);
  });
  test('★ 一个地址挂多个号码（不拆成多站点）', () => {
    deepEq(common.parseStations(['A路 1 号 | 111,222']),
      [{ address: 'A路 1 号', phone: '111,222' }]);
  });
  test('空值返回空数组', () => deepEq(common.parseStations(null), []));
  test('过滤全空行', () => deepEq(common.parseStations('\n\n'), []));
});

/* ============================================================
 * 枚举文案
 * ============================================================ */
describe('枚举文案', () => {
  test('规模文案', () => {
    eq(common.scaleLabel('large'), '大型');
    eq(common.scaleLabel('medium'), '中型');
    eq(common.scaleLabel('small'), '小型');
  });
  test('未知规模返回空串（条件渲染用）', () => eq(common.scaleLabel('huge'), ''));
  test('频率文案', () => {
    eq(common.frequencyLabel('daily'), '天天发车');
    eq(common.frequencyLabel('weekday'), '工作日发车');
    eq(common.frequencyLabel('weekly'), '每周发车');
    eq(common.frequencyLabel('irregular'), '不固定');
  });
  test('未知频率返回空串', () => eq(common.frequencyLabel('sometimes'), ''));
});

describe('transitLabel 时效文案', () => {
  test('0 天显示「当天」', () => eq(common.transitLabel(0), '当天'));
  test('数字加「天」', () => eq(common.transitLabel(2), '2天'));
  test('已是「天」形态原样返回', () => eq(common.transitLabel('3天'), '3天'));
  test('小时形态原样返回', () => eq(common.transitLabel('24小时'), '24小时'));
  test('空值返回空', () => eq(common.transitLabel(null), ''));
  test('空串返回空', () => eq(common.transitLabel(''), ''));
});

/* ============================================================
 * 杂项
 * ============================================================ */
describe('工具函数', () => {
  test('hasText', () => {
    eq(common.hasText('a'), true);
    eq(common.hasText('  '), false);
    eq(common.hasText(''), false);
    eq(common.hasText(null), false);
    eq(common.hasText(0), true);
  });
  test('first', () => {
    eq(common.first([1, 2], 9), 1);
    eq(common.first([], 9), 9);
    eq(common.first(null, 9), 9);
  });
  test('clone 深拷贝（改副本不影响原对象）', () => {
    const a = { x: { y: 1 } };
    const b = common.clone(a);
    b.x.y = 2;
    eq(a.x.y, 1);
  });
});

process.exit(summary('utils/common.js') ? 0 : 1);
