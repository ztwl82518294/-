#!/usr/bin/env node
/**
 * 生成「云开发控制台可直接导入」的 .json 文件
 *
 * ★★ 为什么非得有这个脚本 —— 2026-09-23 踩的坑：
 *   `.data/*.jsonl` 内容完全正确，但云控制台的导入接口只认两种扩展名，
 *   传 .jsonl 会被直接拒掉：
 *     Database Import Fail: invalid import filename(only support .json or .csv)
 *   所以部署清单里说的「导入 .data/*.jsonl」是走不通的 —— 必须先转成 .json。
 *
 * ★ 为什么内容是 JSON 数组而不是「原样换个后缀」：
 *   JSON Lines（每行一个对象）虽然和 .jsonl 内容一致，控制台对它的兼容不明确；
 *   而 JSON 数组是官方文档示例里明确支持的形态，最稳。
 *
 * ★★ 为什么必须保留 _id：
 *   route_companies 通过 routeId / companyId 引用 routes / companies 的主键
 *   （如 comp_001、route_济南_广州）。若让控制台自动生成新 _id，
 *   所有关联会瞬间变成悬空外键 —— 因此导入时必须选 Insert（保留原 _id）。
 *
 * 用法：node scripts/export-cloud-import.js
 * 产物：.data/import/*.json（UTF-8 无 BOM）
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, '.data');
const OUT = path.join(SRC, 'import');

/** 集合名 ← 导出的文件名（顺序即推荐导入顺序：先主键表，后引用表） */
const FILES = [
  { table: 'companies', file: 'companies.jsonl' },
  { table: 'routes', file: 'routes.jsonl' },
  { table: 'route_companies', file: 'route_companies.jsonl' },
  { table: 'cities', file: 'cities.jsonl' },
  { table: 'announcements', file: 'announcements.jsonl' },
  { table: 'featured_routes', file: 'featured_routes.jsonl' }
];

function main() {
  if (!fs.existsSync(SRC)) {
    console.log('✗ 找不到 .data/ 目录 —— 先跑 `node scripts/export-seed.js` 生成数据');
    process.exit(1);
  }
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  console.log('生成云控制台导入文件（.json，UTF-8 无 BOM）');
  console.log('');
  console.log('  集合名              条数    _id');
  console.log('  ----------------------------------');

  let bad = 0;

  FILES.forEach(function (item) {
    const src = path.join(SRC, item.file);
    if (!fs.existsSync(src)) {
      console.log('  ✗ ' + item.table + '：缺少源文件 ' + item.file);
      bad++;
      return;
    }

    // 源文件可能带 BOM（Windows 下手工另存极易带上）—— 导入时被当字段名第一个字符会解析失败
    const raw = fs.readFileSync(src, 'utf8').replace(/^﻿/, '');
    const lines = raw.split(/\r?\n/).filter(function (l) { return l.trim(); });

    const rows = [];
    lines.forEach(function (line, i) {
      let obj;
      try {
        obj = JSON.parse(line);
      } catch (e) {
        console.log('  ✗ ' + item.file + ' 第 ' + (i + 1) + ' 行不是合法 JSON：' + line.slice(0, 40));
        bad++;
        return;
      }
      rows.push(obj);
    });

    const missingId = rows.filter(function (r) { return !r._id; }).length;
    if (missingId) {
      console.log('  ✗ ' + item.table + '：有 ' + missingId + ' 条缺 _id（导入后会导致关联失效）');
      bad++;
    }

    const outFile = path.join(OUT, item.table + '.json');
    // ★ 必须 utf8 明文写：repeat: 无 BOM（Node 默认就不带，别改成 utf8sig）
    fs.writeFileSync(outFile, JSON.stringify(rows, null, 2), 'utf8');

    console.log('  ✓ ' + pad(item.table, 20) + pad(String(rows.length), 7) + (missingId ? '缺 ' + missingId : '齐全'));
  });

  console.log('  ----------------------------------');
  console.log('');

  if (bad) {
    console.log('❌ 有 ' + bad + ' 处问题，先解决再导入');
    process.exit(1);
  }

  console.log('✅ 6 个文件已生成，导入路径：');
  console.log('   ' + OUT);
  console.log('');
  console.log('导入顺序按上表从上到下（先主键表，后引用表）：');
  console.log('   控制台 → 数据库 → 选中集合 → 导入 → 选同名 .json → 冲突处理选 Insert');
  console.log('   ★ 别选 Upsert / 别让它自动生成 _id，否则关联表会全部悬空');
}

function pad(s, n) {
  let out = String(s);
  while (out.length < n) out += ' ';
  return out;
}

main();
