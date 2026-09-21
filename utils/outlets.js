// 网点（outlets）解析与归一：详情页 / 管理端编辑页共用
//
// 背景：数据入库有三条路径，网点字段的形态不统一——
//   1. adminLine save/batchSave（新版）：服务端已归一为 [{addr, phone}] 数组
//   2. 旧版云函数批量导入 / 云开发控制台直灌：fromOutlets/toOutlets 仍是
//      字符串 "地址 | 电话1,电话2"，且 fromAddress/fromPhone 等老字段为空
//   3. 手工编辑：老字段有值、网点可能缺失
// 本模块把"字符串网点 + 空老字段"的数据在读端归一，保证展示/编辑/保存
// 三条链路都能拿到完整数据（口径与 adminLine 的 deriveOutlets 保持一致）。

const ROW_SPLIT = /[\r\n;；]+/;   // 多网点行分隔（不用逗号：地址内部常含逗号）
const CELL_SPLIT = /[|｜\t]+/;    // 行内分隔：地址 | 电话
const PHONE_SPLIT = /[,，、;；/\s]+/; // 网点内多电话分隔（与详情页 splitPhones 同口径）
const PHONE_LIKE = /^[0-9+\-()（）\s]+$/; // 纯数字/带- 视为电话，否则视为地址

// 解析单行为 {addr, phone}；只有一列时按形态判断是地址还是电话
function parseRow(s) {
  const text = String(s || '').trim();
  if (!text) return { addr: '', phone: '' };
  const parts = text.split(CELL_SPLIT).map(x => x.trim()).filter(Boolean);
  if (parts.length >= 2) return { addr: parts[0], phone: parts.slice(1).join(',') };
  const one = parts[0] || '';
  const isPhoneLike = PHONE_LIKE.test(one) && one.replace(/\D/g, '').length >= 7;
  return isPhoneLike ? { addr: '', phone: one } : { addr: one, phone: '' };
}

// 归一为 [{addr, phone}]：兼容对象数组、"地址|电话"字符串数组、整段字符串
function parseOutlets(v) {
  if (!v) return [];
  if (Array.isArray(v)) {
    return v
      .map(x => {
        if (x && typeof x === 'object') {
          return { addr: String(x.addr || x.address || '').trim(), phone: String(x.phone || x.tel || '').trim() };
        }
        return parseRow(x);
      })
      .filter(r => r.addr || r.phone);
  }
  return String(v).split(ROW_SPLIT).map(parseRow).filter(r => r.addr || r.phone);
}

// 网点 ↔ 地址/电话 反填（读端兜底，写法同云函数 deriveOutlets 的正向派生）：
//   - 网点无论字符串还是数组，统一归一写回 record[ok]（数组）
//   - 老字段（fromAddress/fromPhone 等）为空时从网点反填，保证
//     "复制全部地址 / 立即拨打 / 编辑页回显" 在直灌数据上同样可用
function deriveLegacy(record, side) {
  const ok = side === 'from' ? 'fromOutlets' : 'toOutlets';
  const ak = side === 'from' ? 'fromAddress' : 'toAddress';
  const pk = side === 'from' ? 'fromPhone' : 'toPhone';
  const outs = parseOutlets(record[ok]);
  record[ok] = outs;
  if (outs.length) {
    const addrs = outs.map(o => o.addr).filter(Boolean);
    const phones = outs.map(o => o.phone).filter(Boolean);
    if (!record[ak]) record[ak] = addrs.join('\n');
    if (!record[pk]) record[pk] = phones.join(',');
  }
  return record;
}

module.exports = { parseRow, parseOutlets, deriveLegacy, PHONE_SPLIT };
