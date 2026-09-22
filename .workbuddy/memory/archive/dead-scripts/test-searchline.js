// searchLine mock 运行测试（Node 环境模拟 wx-server-sdk）
const Module = require('module');
const path = require('path');
const fs = require('fs');

const store = [
  { _id: 'a1', id: 1, status: 1, title: 'A', fromCityName: '济南市', fromCity: '济南', toCityName: '广州市', toCity: '广州', isVip: 1, vipExpireAt: Date.now() + 86400000 },
  { _id: 'a2', id: 2, status: 1, title: 'B', fromCityName: '济南', toCityName: '上海', isVip: 0 },
  { _id: 'a3', id: 3, status: 1, title: 'C', fromCityName: '广州市', fromCity: '广州', toCityName: '济南市', toCity: '济南', isVip: 0 },
  { _id: 'a4', id: 4, status: 1, title: 'D', fromCityName: '北京', fromCity: '北京', toCityName: '上海', toCity: '上海', toAreas: ['上海全境'], isVip: 0 },
  // 缺 id 字段的"老/外部"数据：仅 _id，验证中转搜索在 id 缺失时的健壮性
  { _id: 'b1', status: 1, title: 'B1', fromCityName: '济南', toCityName: '武汉', toCity: '武汉' },
  { _id: 'b2', status: 1, title: 'B2', fromCityName: '武汉', fromCity: '武汉', toCityName: '北京', toCity: '北京' },
  // 乡镇级目的地（本次报障场景）：线路写到"羊流镇"，用户习惯只搜"羊流"
  { _id: 'c1', id: 5, status: 1, title: '济南-羊流专线', fromCityName: '济南市', fromCity: '济南', toCityName: '羊流镇', toCity: '羊流镇', isVip: 0 },
  // 同上但走旧导入路径（fromCity 索引字段缺失，只能靠 fromCityName 兜底捞回）
  { _id: 'c2', id: 6, status: 1, title: '济南-羊流专线(旧)', fromCityName: '济南市', toCityName: '羊流镇', isVip: 0 }
];
const queriesRun = [];

function fakeDbFilter(w, rows) {
  // 极简 where 模拟：精确字段相等 + $in + $or 分支 + $regex
  function matchOne(doc, cond) {
    if (!cond) return true;
    if (cond.$or) return cond.$or.some(sub => matchOne(doc, sub));
    return Object.keys(cond).every(k => {
      const v = cond[k];
      if (v && typeof v === 'object') {
        if ('$in' in v) return v.$in.includes(doc[k]);
        if ('$regex' in v) return new RegExp(v.$regex, v.$options || '').test(String(doc[k]));
        return false;
      }
      return doc[k] === v;
    });
  }
  return rows.filter(d => matchOne(d, w));
}

const M = new Module('searchline-test', null);
M.filename = 'test';
M.paths = Module._nodeModulePaths(path.resolve(__dirname, '../../cloudfunctions/searchLine'));
const origRequire = M.require;
M.require = function (name) {
  if (name === 'wx-server-sdk') {
    return {
      init() {},
      DYNAMIC_CURRENT_ENV: Symbol('env'),
      database() {
        return {
          command: { in: a => ({ $in: a }), or: a => ({ $or: a }) },
          RegExp: o => ({ $regex: o.regexp, $options: o.options }),
          collection() {
            return {
              where(w) {
                queriesRun.push(w);
                return {
                  limit() {
                    return { get: async () => ({ data: fakeDbFilter(w, store) }) };
                  }
                };
              }
            };
          }
        };
      }
    };
  }
  return origRequire.apply(M, arguments);
};

const slPath = path.resolve(__dirname, '../../cloudfunctions/searchLine/index.js');
const code = fs.readFileSync(slPath, 'utf8');
M.filename = slPath;  // 让 './placeMatch.js' 等相对 require 按真实路径解析
M._compile(code, slPath);

(async () => {
  let pass = 0, fail = 0;
  const t = (name, cond) => { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name); } };

  // 1. 直达搜索：济南→广州
  const r1 = await M.exports.main({ fromText: '济南', toText: '广州' });
  t('直达命中 A（新字段 fromCity）', r1.directList.some(l => l.title === 'A'));
  t('旧数据 B 不误入济南→广州结果', !r1.directList.some(l => l.title === 'B'));
  t('查询使用了 fromCity 标准字段', queriesRun.some(q => q.fromCity === '济南'));
  t('查询使用了 fromCityName $in 兼容旧数据', queriesRun.some(q => q.fromCityName && q.fromCityName.$in));
  t('VIP 置顶且有效', r1.directList.length > 0 && r1.directList[0].title === 'A' && r1.directList[0].isVip === 1);

  // 2. 区县输入归属上级市：某地→上海（D 是 北京→上海，toAreas 上海全境）
  const r2 = await M.exports.main({ fromText: '北京', toText: '浦东' });
  t('输入区县(浦东)命中上级市全境线路 D', r2.directList.some(l => l.title === 'D'));
  // 浦东经 isParentCity 归属上海，属直达口径（到城市=上海），不追加中转段
  const d = r2.directList.find(l => l.title === 'D');
  t('直达口径 displayRoute 正确', d.displayRoute === '北京 → 上海' && d.transfer === 0);

  // 3. 无直达 → 中转：广州→北京（经上海：C 广州→济南? 无。A 济南→广州 不构成。构造验证空结果不报错即可）
  const r3 = await M.exports.main({ fromText: '广州', toText: '北京' });
  t('无直达无中转返回空列表不报错', r3.ok === true && r3.directList.length === 0);

  // 4. 缺参数
  const r4 = await M.exports.main({ fromText: '济南' });
  t('缺少目的地返回错误', r4.ok === false);

  // 5. 【防御】中转搜索：数据缺 id 字段时仍能正确生成中转方案
  // 旧版用 firstLine.id === secondLine.id 会因 undefined===undefined 提前 return，
  // 导致全部组合被跳过，transferList 为空；wx:key 也会变成 "undefined-undefined" 全部冲突
  const r5 = await M.exports.main({ fromText: '济南', toText: '北京' });
  t('缺 id 字段的中转候选能正常返回', r5.ok === true && r5.transferList.length > 0);
  t('中转 key 用 _id 兜底（非 undefined-undefined）',
    r5.transferList.every(t => t.key && !/^-+$/.test(t.key) && t.key.indexOf('undefined') === -1));

  // 6. 【乡镇级目的地容错】线路写"羊流镇"，用户搜"羊流"（本次报障：原先查不到）
  const r6 = await M.exports.main({ fromText: '济南', toText: '羊流' });
  t('输入乡镇简名「羊流」命中线路「羊流镇」',
    r6.directList.length === 2 && r6.directList.every(l => l.toCityName === '羊流镇'));
  t('缺 fromCity 索引的旧数据同样命中', r6.directList.some(l => l.title === '济南-羊流专线(旧)'));
  const r6b = await M.exports.main({ fromText: '济南', toText: '洋流镇' }); // 同音错写
  t('同音错写「洋流镇」同样命中', r6b.directList.length === 2);
  const r6c = await M.exports.main({ fromText: '济南', toText: '新泰' }); // 反向：不得误命中
  t('搜「新泰」不误命中「羊流镇」线路', !r6c.directList.some(l => /羊流/.test(l.title)));

  // 7. 【缺 id 兜底】老数据（无 id 字段）返回时必须补上 id=_id，
  //    否则前端列表跳转 / 收藏 / 管理端编辑全部拿不到键，表现为"点开链接已失效"
  const r7 = await M.exports.main({ fromText: '济南', toText: '武汉' });
  t('缺 id 的老数据返回时补上 id（取 _id）',
    r7.directList.some(l => l.title === 'B1' && l.id === 'b1'));

  console.log(fail === 0 ? `\nALL ${pass} TESTS PASSED` : `\n${fail} TEST(S) FAILED`);
  process.exit(fail === 0 ? 0 : 1);
})();
