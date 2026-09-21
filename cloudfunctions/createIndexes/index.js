/**
 * cloudfunctions/createIndexes/index.js
 *
 * 说明：wx-server-sdk **不提供**代码建索引的 API，索引必须在云开发控制台手动创建
 *      （或使用控制台「数据库 → 索引管理 → 导入」导入本目录的 *.indexes.json）。
 *
 * 那为什么还要有这个 index.js？
 *   1. 本目录位于 cloudfunctions/ 下，开发者工具「上传并部署」会对目录做校验，
 *      缺少 index.js / package.json 会被当成损坏的云函数而上传失败；
 *   2. 提供一个可调用的"索引清单"接口，便于日后核对线上索引是否与本仓库一致。
 *
 * action:
 *   list  —— 返回全部集合应有的索引清单（默认）
 *   get   —— 返回单个集合的索引清单，需传 collection
 */
const fs = require('fs');
const path = require('path');

// 与 .indexes.json 一一对应的集合名
const COLLECTIONS = ['lines', 'stat_events', 'favorites'];

function readIndexes(collection) {
  if (!/^[\w-]+$/.test(collection)) return null;
  const file = path.join(__dirname, collection + '.indexes.json');
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return null;
  }
}

exports.main = async (event) => {
  const action = event.action || 'list';

  if (action === 'get') {
    const list = readIndexes(event.collection);
    if (!list) return { error: '未知集合或无索引定义：' + event.collection };
    return { collection: event.collection, indexes: list };
  }

  const result = {};
  COLLECTIONS.forEach((c) => {
    const list = readIndexes(c);
    if (list) result[c] = list;
  });
  return { collections: COLLECTIONS, indexes: result };
};
