/**
 * 数据导入脚本（工程侧）
 *
 * 用途：
 *   1. 把 data/seed-data.js 构建出的表写入云数据库（产出 .data/*.jsonl 供控制台导入）
 *   2. **重建管理后台的工作副本 admin/data/*.json**
 *
 * ★ 运行方式：在云开发控制台的「云函数测试」里跑，或本地用 @cloudbase/node-sdk。
 *   本脚本**不依赖任何 npm 包**：它只是把数据打成 JSON 分段打印，
 *   供人工通过控制台的「导入」功能上传（云开发控制台支持 JSON Lines 导入）。
 *
 * 为什么不做成自动上传：
 *   1. 本项目坚持零依赖（项目记忆的工程约定），不引入 @cloudbase/node-sdk；
 *   2. 首次建表必须在控制台手动创建集合，脚本无法代替；
 *   3. 打印出的 JSONL 可直接粘贴进控制台的导入框，反而比配密钥更省事。
 *
 * 用法：
 *   node scripts/export-seed.js                 # 打印三张表的 JSONL + 重建 admin/data/
 *   node scripts/export-seed.js --stdout        # 只打印到终端
 *   node scripts/export-seed.js --admin-only    # 只重建 admin/data/（日常最常用）
 *
 * ★ 为什么这个脚本也负责重建 admin/data/：
 *   后台的工作副本一旦被写坏或改乱，唯一正确的恢复方式就是「从唯一数据源重新生成」。
 *   把这两件事放在同一个脚本里，可以保证「生成云库数据」与「生成后台副本」
 *   永远出自同一份 seed，不会出现两边不一致。
 */

const fs = require('fs');
const path = require('path');

const { buildTables } = require('../data/seed-data');
const { CITIES, HOT_CITIES } = require('../data/cities');
const { COLLECTIONS } = require('../shared/schema');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, '.data');
const ADMIN_DATA_DIR = path.join(ROOT, 'admin', 'data');

/** 转 JSON Lines：每行一个 JSON 对象，是云开发控制台能直接吃的导入格式 */
function toJSONL(rows) {
  return rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
}

/** 城市表：云库里只放需要的字段（cities.js 里还有 isHot 之外的派生数据） */
function buildCities() {
  return CITIES.map((c, i) => ({
    _id: 'city_' + String(i + 1).padStart(3, '0'),
    name: c.name,
    province: c.province,
    pinyin: c.pinyin || '',
    initial: c.initial || '',
    isHot: c.isHot === true,
    sortOrder: c.sortOrder || 999
  }));
}

/**
 * 重建管理后台的工作副本
 *
 * ★ 走 repository.bootstrapFrom 而不是自己写文件：
 *   这样「装载内存」与「落盘」是同一套代码，不会出现「文件对了但内存没更新」。
 *   而且它会顺带把 `loaded` 标志置位，避免调用方之后踩到「未装载禁止落盘」的护栏。
 *
 * ★ corrections（纠错队列）会被清空 —— 这是**有意为之**：
 *   它是运营过程中累积的历史凭证，重生成样板数据时不该带上。
 *   真实场景里若想保留，请先自行备份 admin/data/corrections.json。
 */
function rebuildAdminData(tables) {
  const repo = require(path.join(ROOT, 'admin', 'lib', 'repository.js'));
  repo.bootstrapFrom(tables);
  return {
    companies: (tables.companies || []).length,
    routes: (tables.routes || []).length,
    route_companies: (tables.routeCompanies || []).length,
    corrections: 0
  };
}

function main() {
  const stdoutOnly = process.argv.indexOf('--stdout') >= 0;
  const adminOnly = process.argv.indexOf('--admin-only') >= 0;
  const { companies, routes, routeCompanies } = buildTables();
  const cities = buildCities();
  const tables = { companies: companies, routes: routes, routeCompanies: routeCompanies };

  if (adminOnly) {
    const n = rebuildAdminData(tables);
    console.log('=== 已重建管理后台工作副本 ===');
    console.log('  admin/data/' + COLLECTIONS.COMPANIES + '.json        ' + n.companies + ' 条');
    console.log('  admin/data/' + COLLECTIONS.ROUTES + '.json           ' + n.routes + ' 条');
    console.log('  admin/data/' + COLLECTIONS.ROUTE_COMPANIES + '.json  ' + n.route_companies + ' 条');
    console.log('  admin/data/' + COLLECTIONS.CORRECTIONS + '.json      ' + n.corrections + ' 条（有意清空）');
    console.log('');
    console.log('admins.json 未改动（管理员账号与密码保留）。');
    return;
  }

  const files = [
    [COLLECTIONS.COMPANIES, companies],
    [COLLECTIONS.ROUTES, routes],
    [COLLECTIONS.ROUTE_COMPANIES, routeCompanies],
    [COLLECTIONS.CITIES, cities]
  ];

  console.log('=== 待导入数据 ===');
  files.forEach(([name, rows]) => console.log('  ' + name.padEnd(16) + rows.length + ' 条'));
  console.log('  热门城市 ' + HOT_CITIES.length + ' 个（isHot=true）');
  console.log('');

  if (stdoutOnly) {
    files.forEach(([name, rows]) => {
      console.log('--- ' + name + ' ---');
      console.log(toJSONL(rows));
    });
    return;
  }

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  files.forEach(([name, rows]) => {
    const p = path.join(OUT_DIR, name + '.jsonl');
    fs.writeFileSync(p, toJSONL(rows), 'utf8');
    console.log('已写出 ' + path.relative(ROOT, p) + '  ' + rows.length + ' 条');
  });

  // 顺带重建后台工作副本，保证两边出自同一份 seed
  const n = rebuildAdminData(tables);
  console.log('');
  console.log('已重建 admin/data/（公司 ' + n.companies + ' / 线路 ' + n.routes +
    ' / 关联 ' + n.route_companies + '，纠错清空）');

  console.log('');
  console.log('导入方法：云开发控制台 → 数据库 → 新建集合 → 导入 → 选择对应 .jsonl，冲突模式选「insert」');
  console.log('注意：集合必须已存在（控制台手动新建），脚本无法代建。');
}

main();
