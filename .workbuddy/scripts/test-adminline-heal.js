// 回归测试：adminLine ① 缺 id 历史数据自愈  ② 局部更新不清空城市索引字段
// 运行：node .workbuddy/scripts/test-adminline-heal.js
//
// 背景（线上症状）：
//   旧版批量导入的线路没有业务字段 id，导致用户端点开提示"链接已失效"、
//   收藏报"操作失败"、管理端点"编辑"提示"未找到该专线"。
//   另外 pickFields 无条件用城市名派生 fromCity/toCity，局部更新（只改标题）
//   会把索引清成 ''，线路从所有搜索中消失。
const Module = require('module');
const path = require('path');
const fs = require('fs');

const ADMIN = 'oxWBc15BpD7x2BR7O5u1O7TjBnGo';
// 按集合分桶：不同集合必须隔离，否则 app_config 的文档会被当成线路扫描
const stores = {
  lines: [
    { _id: 'x1', title: '老线路A', fromCityName: '济南市', toCityName: '羊流镇', status: 1 },            // 缺 id
    { _id: 'x2', title: '老线路B', fromCityName: '济南市', toCityName: '新汶', status: 1 },              // 缺 id
    { _id: 'x3', title: '新线路C', fromCityName: '济南市', toCityName: '广州市', id: 1700000000000, status: 1, fromCity: '济南', toCity: '广州' }
  ],
  app_config: []
};
const store = stores.lines;
let lastUpdate = null;

function matchWhere(doc, w) {
  return Object.keys(w).every(k => {
    const v = w[k];
    if (v && typeof v === 'object' && '$exists' in v) return v.$exists ? doc[k] !== undefined : doc[k] === undefined;
    return doc[k] === v;
  });
}
const chain = (rows, w) => ({
  get: async () => ({ data: rows.filter(d => matchWhere(d, w)) }),
  count: async () => ({ total: rows.filter(d => matchWhere(d, w)).length }),
  limit: () => chain(rows, w),
  skip: () => chain(rows, w),
  orderBy: () => chain(rows, w),
  update: async ({ data }) => { rows.filter(d => matchWhere(d, w)).forEach(d => Object.assign(d, data)); return {}; }
});
const mockDb = {
  command: { exists: b => ({ $exists: b }), in: a => ({ $in: a }), or: a => ({ $or: a }) },
  RegExp: o => ({ $regex: o.regexp, $options: o.options }),
  collection(name) {
    const rows = stores[name] || (stores[name] = []);
    return {
      doc(id) {
        return {
          get: async () => { const d = rows.find(x => x._id === id); if (!d) throw new Error('not found'); return { data: d }; },
          update: async ({ data }) => { const d = rows.find(x => x._id === id); if (d) Object.assign(d, data); if (name === 'lines') lastUpdate = data; return { stats: { updated: 1 } }; },
          remove: async () => ({})
        };
      },
      add: async ({ data }) => { rows.push(data); return { _id: 'new' }; },
      where: w => chain(rows, w)
    };
  }
};

const root = path.resolve(__dirname, '../..');
const target = path.join(root, 'cloudfunctions/adminLine/index.js');
const m = new Module(target, null);
m.filename = target;
m.paths = Module._nodeModulePaths(path.dirname(target));
const origRequire = m.require.bind(m);
m.require = function (name) {
  if (name === 'wx-server-sdk') {
    return { init() {}, DYNAMIC_CURRENT_ENV: 'env', getWXContext: () => ({ OPENID: ADMIN }), database: () => mockDb };
  }
  return origRequire(name);
};
m._compile(fs.readFileSync(target, 'utf8'), target);

let pass = 0, fail = 0;
const t = (name, cond) => { cond ? pass++ : (fail++, console.log('  ✗ ' + name)); };

(async () => {
  // 1. 缺 id 自愈
  const r = await m.exports.main({ action: 'healIds', data: { limit: 200 } });
  t('healIds 执行成功', r.ok === true && r.fixed === 2);
  t('x1 补上了 id', typeof store[0].id === 'number' && store[0].id > 0);
  t('x2 补上了 id', typeof store[1].id === 'number' && store[1].id > 0);
  t('两条补的 id 互不相同', store[0].id !== store[1].id);
  t('已有 id 的记录未被改动', store[2].id === 1700000000000);
  t('重复执行无副作用（无缺 id 记录）', (await m.exports.main({ action: 'healIds' })).fixed === 0);

  // 2. 局部更新不清空城市索引字段
  lastUpdate = null;
  await m.exports.main({ action: 'save', data: { _id: 'x3', title: '新线路改名' } });
  t('局部更新提交了 update', lastUpdate && lastUpdate.title === '新线路改名');
  t('局部更新不写入 fromCity（不清空索引）', lastUpdate && lastUpdate.fromCity === undefined);
  t('局部更新不写入 toCity（不清空索引）', lastUpdate && lastUpdate.toCity === undefined);
  t('库中原有 fromCity 保留', store[2].fromCity === '济南' && store[2].toCity === '广州');

  // 3. 带了城市名时仍正常派生（回归保护）
  lastUpdate = null;
  await m.exports.main({ action: 'save', data: { _id: 'x3', title: 'C', fromCityName: '济南市', toCityName: '泰安市' } });
  t('带城市名时派生 fromCity/toCity', lastUpdate.fromCity === '济南' && lastUpdate.toCity === '泰安');

  // 4. 乡镇级目的地原样保留（不应被 normCity 削掉"镇"）
  lastUpdate = null;
  await m.exports.main({ action: 'save', data: { _id: 'x1', title: 'A', fromCityName: '济南市', toCityName: '羊流镇' } });
  t('乡镇级目的地保留原名', lastUpdate.toCityName === '羊流镇');
  t('乡镇级目的地的索引字段保留镇字', lastUpdate.toCity === '羊流镇');

  console.log(`\n${fail === 0 ? 'ALL PASSED' : 'FAILED'} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
