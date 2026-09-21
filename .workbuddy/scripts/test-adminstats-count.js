/**
 * 回归测试：adminStats 活跃用户数统计
 *
 * 背景：云开发聚合单次最多返回 1000 条，早期用 group + limit(1000) 取用户数，
 *       超过 1000 人后只能给出"下限值"（usersCapped）。
 *       现改为优先用聚合 $count 阶段（无 1000 上限）取精确值，
 *       环境不支持时回退 group+limit 并保留 capped 标记。
 * 本测试覆盖：
 *   1. $count 可用 → 精确值，capped=false
 *   2. $count 抛错 → 回退，且不足 1000 时 capped=false
 *   3. $count 不可用 + 用户数达 1000 → capped=true（下限值）
 *   4. $count 返回格式异常 → 同样安全回退
 *   5. 非管理员 → 拒绝
 */
const Module = require('module');
const fs = require('fs');
const path = require('path');

const ADMIN = 'oxWBc15BpD7x2BR7O5u1O7TjBnGo';

// 可变配置，测试里逐项改
const cfg = {
  countWorks: true,     // 聚合 $count 阶段是否可用
  countValue: 1234,     // 真实去重用户数
  countName: null       // $count 输出字段名
};

function makeAggregate() {
  const stages = [];
  const agg = {
    match(m) { stages.push(['match', m]); return agg; },
    group(g) { stages.push(['group', g]); return agg; },
    sort() { return agg; },
    limit(n) { stages.push(['limit', n]); return agg; },
    count(name) { stages.push(['count', name]); return agg; },
    async end() {
      const hasCount = stages.some(s => s[0] === 'count');
      const limitStage = stages.find(s => s[0] === 'limit');
      const isTop50 = limitStage && limitStage[1] === 50;

      if (hasCount) {
        if (!cfg.countWorks) throw new Error('aggregate.count is not a function');
        const name = stages.find(s => s[0] === 'count')[1];
        // countName 用来模拟"返回格式异常"的场景
        const out = cfg.countName ? { [cfg.countName]: cfg.countValue } : { [name]: cfg.countValue };
        return { list: [out] };
      }
      if (isTop50) {
        // 活跃榜：造 2 条
        return {
          list: [
            { _id: 'u1', total: 30, lastTs: 1700000000000 },
            { _id: 'u2', total: 12, lastTs: 1700000001000 }
          ]
        };
      }
      if (limitStage) {
        // 回退路径：group + limit(1000)，最多返回 1000 条
        const n = Math.min(cfg.countValue, limitStage[1]);
        return { list: new Array(n).fill(0).map((_, i) => ({ _id: 'u' + i })) };
      }
      // 纯 group：search/view 分用户计数
      return { list: [{ _id: 'u1', c: 3 }] };
    }
  };
  return agg;
}

const mockDb = {
  command: {
    aggregate: {
      sum: () => ({ $sum: 1 }),
      max: (f) => ({ $max: f })
    }
  },
  createCollection: async () => ({}),
  collection(name) {
    return {
      doc() {
        return {
          get: async () => ({ data: { openids: [ADMIN] } })
        };
      },
      where() {
        return { count: async () => ({ total: 42 }) };
      },
      aggregate: () => makeAggregate()
    };
  }
};

const root = path.resolve(__dirname, '../..');
const target = path.join(root, 'cloudfunctions/adminStats/index.js');

function load(openid) {
  const m = new Module(target, null);
  m.filename = target;
  m.paths = Module._nodeModulePaths(path.dirname(target));
  const origRequire = m.require.bind(m);
  m.require = function (n) {
    if (n === 'wx-server-sdk') {
      return {
        init() {},
        DYNAMIC_CURRENT_ENV: 'env',
        getWXContext: () => ({ OPENID: openid }),
        database: () => mockDb
      };
    }
    return origRequire(n);
  };
  m._compile(fs.readFileSync(target, 'utf8'), target);
  return m.exports;
}

let pass = 0, fail = 0;
const t = (name, cond, extra) => {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra ? '  -> ' + JSON.stringify(extra) : '')); }
};

(async () => {
  // 1. $count 可用：应给出精确值 1234（超过 1000 也不截断）
  cfg.countWorks = true; cfg.countValue = 1234; cfg.countName = null;
  let r = await load(ADMIN).main({ month: '2026-09' });
  t('$count 可用时给出精确用户数 1234', r.totals.users === 1234, r.totals);
  t('$count 可用时不标记 capped', r.totals.usersCapped === false, r.totals);

  // 2. $count 不可用 + 用户数 500（<1000）→ 回退但值准确、不标记 capped
  cfg.countWorks = false; cfg.countValue = 500;
  r = await load(ADMIN).main({ month: '2026-09' });
  t('$count 不可用时回退到 group+limit', r.totals.users === 500, r.totals);
  t('回退且未达上限时不标记 capped', r.totals.usersCapped === false, r.totals);

  // 3. $count 不可用 + 用户数 1500（>1000）→ 回退到 1000 并标记 capped（下限值）
  cfg.countWorks = false; cfg.countValue = 1500;
  r = await load(ADMIN).main({ month: '2026-09' });
  t('回退且超 1000 时截断为 1000', r.totals.users === 1000, r.totals);
  t('回退且超 1000 时标记 capped=true', r.totals.usersCapped === true, r.totals);

  // 4. $count 返回格式异常 → 安全回退，不崩溃
  cfg.countWorks = true; cfg.countValue = 7; cfg.countName = 'unexpectedField';
  r = await load(ADMIN).main({ month: '2026-09' });
  t('$count 返回格式异常时安全回退', r.totals && typeof r.totals.users === 'number', r);
  t('格式异常回退后仍返回榜单', Array.isArray(r.users) && r.users.length === 2, r.users);

  // 5. 非管理员应被拒绝
  cfg.countName = null;
  r = await load('someone-else').main({ month: '2026-09' });
  t('非管理员返回无权限', r.error === '无权限操作', r);

  console.log('\n' + (fail === 0 ? `ALL PASSED — ${pass} passed, 0 failed` : `${pass} passed, ${fail} failed`));
  process.exit(fail ? 1 : 0);
})();
