#!/usr/bin/env node
/**
 * 云端导入文件的护栏（scripts/export-cloud-import.js）
 *
 * ★ 为什么单独测：2026-09-23 部署时才发现，云控制台的导入接口**不认 .jsonl 扩展名**
 *   （`invalid import filename(only support .json or .csv)`），而部署文档当时写的正是
 *   「导入 .data/*.jsonl」—— 文档、脚本、实际能力三者不一致，人照着做必然失败。
 *   这类「口径错」用肉眼很难持续盯住，反倒适合钉成断言。
 *
 * 测三件事：
 *   1. 转换脚本确实产出可用文件（JSON 数组、无 BOM、条数与源一致、条条有 _id）
 *   2. 文档口径与实际一致（不再让人去导 .jsonl）
 *   3. 六张业务表都被覆盖到，没漏 collections
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '../..');
const NODE = process.execPath;
const SCRIPT = path.join(ROOT, 'scripts/export-cloud-import.js');
const OUT_DIR = path.join(ROOT, '.data/import');

/** 六个集合的期望条数（与 data/seed-data.js 同源，改动时同步这里） */
const EXPECT = [
  { table: 'companies', count: 40 },
  { table: 'routes', count: 55 },
  { table: 'route_companies', count: 72 },
  { table: 'cities', count: 344 },
  { table: 'announcements', count: 4 },
  { table: 'featured_routes', count: 6 }
];

const { describe, test, ok, eq, summary, settle } = require('../framework');

/* 先跑一次，保证产物是最新且与源数据同步的 */
function generate() {
  return execFileSync(NODE, [SCRIPT], { cwd: ROOT, encoding: 'utf8' });
}

/** 读产物（JSON Lines：每行一条），顺手校验无 BOM */
function readJson(table) {
  const buf = fs.readFileSync(path.join(OUT_DIR, table + '.json'));
  const text = buf.toString('utf8');
  const rows = text.split('\n').filter(function (l) { return l.trim(); })
    .map(function (l) { return JSON.parse(l); });
  return { buf: buf, text: text, json: rows };
}

let genOut = '';

describe('转换脚本可用', () => {
  test('★ 脚本能跑通并生成 6 个 .json（而不是 .jsonl）', () => {
    genOut = generate();
    ok(genOut.indexOf('✅ 6 个文件已生成') >= 0, '脚本未按预期收尾：\n' + genOut);
    EXPECT.forEach(function (e) {
      const p = path.join(OUT_DIR, e.table + '.json');
      ok(fs.existsSync(p), '缺少产物 ' + e.table + '.json');
    });
  });
});

describe('产物格式能被控制台接受', () => {
  test('★ 无 BOM（控制台会把 BOM 当成第一个字段的字符）', () => {
    EXPECT.forEach(function (e) {
      const b = readJson(e.table).buf;
      const hasBom = b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF;
      ok(!hasBom, e.table + '.json 带了 BOM，导入会失败');
    });
  });

  test('★ 内容是 JSON Lines：每行一个紧凑 JSON 对象', () => {
    /*
     * 实测反过来的两次失败：改成 JSON 数组会报「请检查是否为 JSON Lines 格式」，
     * 保持每行一条、扩展名却是 .jsonl 会报「only support .json or .csv」——
     * 只有「JSON Lines 内容 + .json 扩展名」这一条组合走得通。
     */
    EXPECT.forEach(function (e) {
      const text = readJson(e.table).text.trim();
      eq(text.charAt(0), '{', e.table + ' 不是 JSON Lines（首字符应为 { ）');
      const lines = text.split('\n');
      eq(lines.length, e.count, e.table + ' 行数与条数不符（对象内不能有换行）');
      lines.forEach(function (line, i) {
        let obj = null;
        try {
          obj = JSON.parse(line);
        } catch (err) {
          obj = null;
        }
        ok(obj, e.table + ' 第 ' + (i + 1) + ' 行不是合法 JSON');
      });
    });
  });

  test('条数与种子数据一致', () => {
    EXPECT.forEach(function (e) {
      const rows = readJson(e.table).json;
      eq(rows.length, e.count, e.table + ' 条数不对（期望 ' + e.count + '）');
    });
  });
});

describe('★ 关联完整性：_id 必须保留', () => {
  test('每条记录都自带 _id（控制台自动生成 _id 会让关联全部悬空）', () => {
    EXPECT.forEach(function (e) {
      const rows = readJson(e.table).json;
      const missing = rows.filter(function (r) { return !r._id; });
      eq(missing.length, 0, e.table + ' 有 ' + missing.length + ' 条缺 _id');
    });
  });

  test('★ 关联表引用的 companyId / routeId 在对应表里都存在', () => {
    const companies = {};
    readJson('companies').json.forEach(function (c) { companies[c._id] = 1; });
    const routes = {};
    readJson('routes').json.forEach(function (r) { routes[r._id] = 1; });

    const bad = readJson('route_companies').json.filter(function (l) {
      return !routes[l.routeId] || !companies[l.companyId];
    });
    eq(bad.length, 0, '有 ' + bad.length + ' 条关联指向不存在的公司或线路');
  });
});

describe('文档口径与实际一致', () => {
  test('★ 部署文档不再让人直接导 .jsonl（那是一定会被拒的）', () => {
    const p = path.join(ROOT, 'docs/验收自检报告.md');
    const text = fs.readFileSync(p, 'utf8');
    ok(text.indexOf('export-cloud-import.js') >= 0, '文档没提到转换脚本');
    ok(text.indexOf('only support') >= 0, '文档没写清「控制台不认 .jsonl」这件事');
    ok(text.indexOf('Insert') >= 0, '文档没提醒冲突处理要选 Insert');
  });
});

settle().then(() => {
  process.exit(summary('云端导入文件') ? 0 : 1);
});
