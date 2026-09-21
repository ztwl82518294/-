// 回归测试：adminLine 写入端数组归一（tags/toAreas 字符串 → 数组）
// 复现问题：批量导入模板里 tags/toAreas 是逗号字符串，
//           编辑页 (l.tags || []).join(',') 报 "join is not a function"
const Module = require('module');
const path = require('path');
const fs = require('fs');

const ADMIN = 'oxWBc15BpD7x2BR7O5u1O7TjBnGo';
// 全部 add() 调用统一进 capturedAll，由测试按需取最后一条（save）或全部（batchSave）
const capturedAll = [];

const mockDb = {
  command: { exists: () => ({ $exists: true }) },
  RegExp: o => ({ $regex: o.regexp, $options: o.options }),
  collection(name) {
    return {
      doc() {
        return {
          get: async () => { throw new Error('not found'); },   // app_config/admins 不存在 → 走兜底
          update: async () => ({ stats: { updated: 1 } })
        };
      },
      add: async ({ data }) => { if (name === 'lines') capturedAll.push(data); return { _id: 'new1' }; },
      where() { return { get: async () => ({ data: [] }), count: async () => ({ total: 0 }), update: async () => ({}) }; }
    };
  }
};
// 便捷访问：最后一条 add 的数据（save 用）
const captured = () => capturedAll[capturedAll.length - 1];

const root = path.resolve(__dirname, '../..');
const target = path.join(root, 'cloudfunctions/adminLine/index.js');
const m = new Module(target, null);
m.filename = target;
m.paths = Module._nodeModulePaths(path.dirname(target));
const origRequire = m.require.bind(m);
m.require = function (name) {
  if (name === 'wx-server-sdk') {
    return {
      init() {},
      DYNAMIC_CURRENT_ENV: 'env',
      getWXContext: () => ({ OPENID: ADMIN }),
      database: () => mockDb
    };
  }
  return origRequire(name);
};
m._compile(fs.readFileSync(target, 'utf8'), target);

let pass = 0, fail = 0;
const t = (name, cond) => { cond ? pass++ : (fail++, console.log('  ✗ ' + name)); };

(async () => {
  // 1. save：字符串形式的 tags/toAreas 应被归一为数组
  await m.exports.main({
    action: 'save',
    data: {
      title: '测试专线', fromCityName: '济南市', toCityName: '广州市',
      tags: '直达,天天发车', toAreas: '广州全境，佛山、东莞'
    }
  });
  const c1 = captured();
  t('save: tags 归一为数组', Array.isArray(c1.tags));
  t('save: tags 内容正确', JSON.stringify(c1.tags) === JSON.stringify(['直达', '天天发车']));
  t('save: toAreas 归一为数组（中文逗号/顿号）', JSON.stringify(c1.toAreas) === JSON.stringify(['广州全境', '佛山', '东莞']));
  t('save: 标准城市字段仍由服务端派生', c1.fromCity === '济南' && c1.toCity === '广州');

  // 2. 数组入参保持原样
  await m.exports.main({
    action: 'save',
    data: { title: 'A', fromCityName: '济南', toCityName: '上海', tags: ['直达', ' 天天发车 '], toAreas: [] }
  });
  const c2 = captured();
  t('save: 数组入参去空白', JSON.stringify(c2.tags) === JSON.stringify(['直达', '天天发车']));
  t('save: 空数组保持为数组', Array.isArray(c2.toAreas) && c2.toAreas.length === 0);

  // 3. 空值不写坏数据
  await m.exports.main({ action: 'save', data: { title: 'B', fromCityName: '济南', toCityName: '上海', tags: '' } });
  t('save: 空字符串归一为 []', Array.isArray(captured().tags) && captured().tags.length === 0);

  // 4. 前端 arrToStr 兼容两种格式（复刻实现做等价校验）
  const arrToStr = v => (!v ? '' : (Array.isArray(v) ? v.join(',') : String(v)));
  t('arrToStr: 数组 → "a,b"', arrToStr(['a', 'b']) === 'a,b');
  t('arrToStr: 字符串原样返回', arrToStr('直达,天天发车') === '直达,天天发车');
  t('arrToStr: undefined → ""', arrToStr(undefined) === '');

  // 5. 网点 outlets：对象数组写法 → 归一为 [{addr,phone}]，并反推地址/电话串
  await m.exports.main({
    action: 'save',
    data: {
      title: 'O1', fromCityName: '济南', toCityName: '广州',
      fromOutlets: [
        { addr: '盖家沟A区12号', phone: '13800000000' },
        { addr: '历城华山仓库', phone: '0531-82518294,13900000001' }
      ]
    }
  });
  const o1 = captured();
  t('outlets: 对象数组归一为 [{addr,phone}]',
    Array.isArray(o1.fromOutlets) && o1.fromOutlets.length === 2 &&
    o1.fromOutlets[0].addr === '盖家沟A区12号' && o1.fromOutlets[0].phone === '13800000000');
  t('outlets: 反推 fromAddress（换行连接）', o1.fromAddress === '盖家沟A区12号\n历城华山仓库');
  t('outlets: 反推 fromPhone（逗号连接）', o1.fromPhone === '13800000000,0531-82518294,13900000001');
  t('outlets: 兼容字段 phone 由发站电话派生', o1.phone === '13800000000,0531-82518294,13900000001');

  // 6. 网点 outlets：整段换行文本 "地址 | 电话"
  await m.exports.main({
    action: 'save',
    data: {
      title: 'O2', fromCityName: '济南', toCityName: '广州',
      fromOutlets: '盖家沟A区12号 | 13800000000\n历城华山仓库 | 0531-82518294',
      toOutlets: [{ addr: '白云区B区', phone: '020-12345678' }]
    }
  });
  const o2 = captured();
  t('outlets: 换行文本按 | 拆分', o2.fromOutlets.length === 2 &&
    o2.fromOutlets[1].addr === '历城华山仓库' && o2.fromOutlets[1].phone === '0531-82518294');
  t('outlets: 到站网点独立解析', o2.toOutlets.length === 1 && o2.toOutlets[0].phone === '020-12345678');

  // 7. 网点 outlets：字符串数组写法
  await m.exports.main({
    action: 'save',
    data: { title: 'O3', fromCityName: '济南', toCityName: '广州', fromOutlets: ['A地址 | 111', 'B地址 | 222'] }
  });
  t('outlets: 字符串数组写法', JSON.stringify(captured().fromOutlets) ===
    JSON.stringify([{ addr: 'A地址', phone: '111' }, { addr: 'B地址', phone: '222' }]));

  // 8. 单列行：数字≥7位判为电话，否则判为地址
  await m.exports.main({
    action: 'save',
    data: { title: 'O4', fromCityName: '济南', toCityName: '广州', fromOutlets: '13800000000\n盖家沟A区' }
  });
  t('outlets: 纯数字行判为电话', captured().fromOutlets[0].addr === '' && captured().fromOutlets[0].phone === '13800000000');
  t('outlets: 非数字行判为地址', captured().fromOutlets[1].addr === '盖家沟A区' && captured().fromOutlets[1].phone === '');

  // 9. 没给网点 → 由地址/电话下标对位重建（7地址 21电话 场景）
  await m.exports.main({
    action: 'save',
    data: {
      title: 'O5', fromCityName: '济南', toCityName: '天津',
      fromAddress: '地址1\n地址2\n地址3',
      fromPhone: '13800000001,13800000002,13800000003,13800000004,13800000005'
    }
  });
  const o5 = captured();
  t('无 outlets: 按下标对位重建，组数取较大者', Array.isArray(o5.fromOutlets) && o5.fromOutlets.length === 5);
  t('无 outlets: 前 3 组带地址', o5.fromOutlets.slice(0, 3).every(o => o.addr));
  t('无 outlets: 后 2 组仅电话', o5.fromOutlets[3].addr === '' && o5.fromOutlets[3].phone === '13800000004');

  // 10. 地址/电话都空 → 网点为空数组（不写脏数据）
  await m.exports.main({ action: 'save', data: { title: 'O6', fromCityName: '济南', toCityName: '广州', fromAddress: '', fromPhone: '' } });
  t('空地址空电话 → outlets 为 []', Array.isArray(captured().fromOutlets) && captured().fromOutlets.length === 0);

  // 11. batchSave 同样解析网点
  const beforeB = capturedAll.length;
  await m.exports.main({
    action: 'batchSave',
    data: [{ title: 'BO1', fromCityName: '济南', toCityName: '广州', fromOutlets: 'A地址 | 111\nB地址 | 222' }]
  });
  t('batchSave: 网点同样解析', capturedAll[beforeB].fromOutlets.length === 2 &&
    capturedAll[beforeB].fromOutlets[1].addr === 'B地址');

  console.log(`\n${fail === 0 ? 'ALL PASSED' : 'FAILED'} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
