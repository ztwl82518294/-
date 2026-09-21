// cloudfunctions/searchLine/index.js
// 专线搜索服务端聚合（直达 + 中转），由 pages/line-list 调用。
//
// 【万股级架构】（S1 改造）：
// 旧版把候选线路拉进内存做地名模糊匹配，单查询上限 1000 条，枢纽城市超 1000 条
// 专线后必然漏单。现改为"两级数据库查询"：
//   ① 数据库粗过滤：按标准城市字段 fromCity/toCity 精确匹配（复合索引，
//      毫秒级返回），旧数据用 fromCityName 的后缀变体（济南市/地区/盟/自治州）
//      in-查询兼容；
//   ② 内存精过滤：候选集只有"该城市的线路"（通常几十~几百条），在其中做
//      原有模糊匹配（辐射区/区县归属/别名互通），匹配能力完全不变。
//
// 用户输入 → 标准城市的映射由 regionData.getCityLevel 完成（区县→上级市，
// 市/省→自身），纯内存查表、约 400 城市量级，无性能压力。
//
// 返回口径不变：{ ok, directList, transferList }；VIP 口径：isVip 修正为
// "有效会员"（isVip=1 且未过期），过期会员自动降级。

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const placeMatch = require('./placeMatch.js');
const regionData = require('./regionData.js');
const { cityCore, sameCity, queryTokens, contains, isParentCity } = placeMatch;
const { getCityLevel } = regionData;

// 云函数端单次 get 上限 1000；候选集按城市过滤后通常远小于此
const MAX = 1000;

// 旧数据 fromCityName 的后缀变体（新数据一律有 fromCity 标准字段）
function nameVariants(std) {
  return [std, std + '市', std + '地区', std + '盟', std + '自治州'];
}

const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 数组字段归一：批量导入的数据里 tags/toAreas 可能是逗号字符串，
// 前端 wx:for 直接遍历字符串会逐字渲染，这里在返回前统一转成数组。
function toArr(v) {
  if (v === undefined || v === null || v === '') return [];
  if (Array.isArray(v)) return v.map(x => String(x).trim()).filter(Boolean);
  return String(v).split(/[,，、;；/|\s]+/).map(x => x.trim()).filter(Boolean);
}

function normalizeLine(l) {
  if (!l) return l;
  // 【修复】旧导入数据可能缺 id 字段（id 是业务字段，_id 才是主键），
  // 而前端列表跳转/收藏/管理端编辑都以 id 为键，缺失会让用户"点开报链接失效"。
  // 统一用 _id 兜底，保证返回的每条线路都有稳定唯一键。
  if (!l.id) l.id = l._id;
  l.tags = toArr(l.tags);
  l.toAreas = toArr(l.toAreas);
  return l;
}

async function getAll(where) {
  const res = await db.collection('lines').where(where).limit(MAX).get();
  return res.data;
}

// 有效会员判定：isVip=1 且（无到期时间 或 未过期）。
// 兼容旧数据：vipExpireAt 缺失视为有效（管理端 list 会自愈补齐，收藏快照可能滞后）。
function effectiveVip(line, now) {
  if (!line || line.isVip !== 1) return 0;
  if (!line.vipExpireAt) return 1;
  return line.vipExpireAt > (now || Date.now()) ? 1 : 0;
}

// ===== 直达搜索：数据库粗过滤（标准城市字段）→ 内存精过滤 =====
async function searchDirect(fromCity, fromText, toCity, toText) {
  const stdFrom = getCityLevel(fromCity || fromText);
  const fromTokens = queryTokens(fromCity || fromText);
  const fromAreasPattern = fromTokens.concat('全境').map(esc).join('|');

  // 候选集：① 标准城市字段精确查（新数据，走复合索引）
  //        ② 旧字段后缀变体 in 查（历史数据兼容）
  //        ③ 辐射区含"全境"的兜底查
  const queries = [
    getAll({ status: 1, fromCity: stdFrom }),
    getAll({ status: 1, fromCityName: _.in(nameVariants(stdFrom)) }),
    getAll({ status: 1, fromAreas: db.RegExp({ regexp: fromAreasPattern }) })
  ];
  const results = await Promise.all(queries);
  const map = {};
  results.forEach(arr => arr.forEach(l => { map[l._id || l.id] = l; }));
  const candidates = Object.values(map);

  return candidates.filter(item => {
    // sameCity：乡镇级容错比较（线路"羊流镇" ←→ 用户输入"羊流"/"洋流镇"）
    const fromCityMatch = (fromCity && sameCity(item.fromCityName, fromCity))
      || sameCity(item.fromCityName, fromText)
      || isParentCity(item.fromCityName, fromText)
      || (item.fromCity && sameCity(item.fromCity, stdFrom));
    const fromMatch = fromCityMatch || contains(item.fromAreas, fromText, item.fromCityName);

    const toCityMatch = (toCity && sameCity(item.toCityName, toCity))
      || sameCity(item.toCityName, toText)
      || isParentCity(item.toCityName, toText)
      || (item.toCity && sameCity(item.toCity, getCityLevel(toCity || toText)));
    const toRad = contains(item.toAreas, toText, item.toCityName);
    const toMatch = toCityMatch || toRad;

    if (fromMatch && toMatch) {
      item.transfer = (toRad && !toCityMatch) ? 1 : 0;
      item.displayRoute = item.transfer
        ? item.fromCityName + ' → ' + item.toCityName + ' → ' + toText
        : item.fromCityName + ' → ' + item.toCityName;
      return true;
    }
    return false;
  }).map(normalizeLine);
}

// ===== 中转搜索：fromCityLevel → 中转城市 → toCityLevel =====
// 同样改为数据库粗过滤：起/到两端的候选各查一次（标准字段 + 旧字段变体 + 辐射区）
async function searchTransfer(fromCityLevel, toCityLevel, fromText, toText) {
  const fv = nameVariants(fromCityLevel);
  const tv = nameVariants(toCityLevel);

  // 【修复】①③ 两个标准字段查询此前漏了 status: 1，已下架线路会进入中转候选
  const [f1r, f2r, t1r, t2r] = await Promise.all([
    getAll(_.or([{ status: 1, fromCity: fromCityLevel }, { status: 1, fromCityName: _.in(fv) }])),
    getAll({ status: 1, fromAreas: db.RegExp({ regexp: [esc(fromCityLevel), '全境'].join('|') }) }),
    getAll(_.or([{ status: 1, toCity: toCityLevel }, { status: 1, toCityName: _.in(tv) }])),
    getAll({ status: 1, toAreas: db.RegExp({ regexp: [esc(toCityLevel), '全境'].join('|') }) })
  ]);

  const fMap = {}, tMap = {};
  f1r.forEach(l => { fMap[l._id || l.id] = l; });
  f2r.forEach(l => { fMap[l._id || l.id] = l; });
  t1r.forEach(l => { tMap[l._id || l.id] = l; });
  t2r.forEach(l => { tMap[l._id || l.id] = l; });
  const fromLines = Object.values(fMap).map(normalizeLine);
  const toLines = Object.values(tMap).map(normalizeLine);

  const firstLegs = fromLines.filter(item =>
    cityCore(item.fromCityName) === cityCore(fromCityLevel)
    || (item.fromCity && cityCore(item.fromCity) === cityCore(fromCityLevel))
    || sameCity(item.fromCityName, fromText)
    || contains(item.fromAreas, fromText, item.fromCityName)
  );

  const secondLegs = toLines.filter(item =>
    cityCore(item.toCityName) === cityCore(toCityLevel)
    || (item.toCity && cityCore(item.toCity) === cityCore(toCityLevel))
    || sameCity(item.toCityName, toText)
    || isParentCity(item.toCityName, toText)
    || contains(item.toAreas, toText, item.toCityName)
  );

  const firstDests = {};
  firstLegs.forEach(line => {
    const dest = cityCore(line.toCityName);
    if (!dest) return;
    if (!firstDests[dest]) firstDests[dest] = [];
    firstDests[dest].push(line);
  });

  const secondOrigins = {};
  secondLegs.forEach(line => {
    const origin = cityCore(line.fromCityName);
    if (!origin) return;
    if (!secondOrigins[origin]) secondOrigins[origin] = [];
    secondOrigins[origin].push(line);
  });

  const transferCities = Object.keys(firstDests).filter(c => secondOrigins[c] && c !== cityCore(fromCityLevel) && c !== cityCore(toCityLevel));

  const transferList = [];
  // 用 _id||id 作主键（防御：旧/外部数据可能缺 id 字段；用 _id 兜底避免
  // "undefined-undefined" 让 wxml wx:key 全部冲突、以及同线路被两端引用）。
  // 真·都缺时退到 fromCity→toCity 合成键，保证 wx:key 仍唯一稳定。
  const kid = l => l && (l._id || l.id) || ((l.fromCityName || '') + '|' + (l.toCityName || ''));
  transferCities.forEach(city => {
    firstDests[city].forEach(firstLine => {
      secondOrigins[city].forEach(secondLine => {
        // 排除"同一条线路同时充当两端"（虚拟中转，无意义）
        const k1 = kid(firstLine), k2 = kid(secondLine);
        if (k1 && k1 === k2) return;
        const secondToNorm = cityCore(secondLine.toCityName);
        const needAppend = toText !== toCityLevel && secondToNorm !== cityCore(toText);
        transferList.push({
          key: `${k1}-${k2}`,  // 组合去重键，供 wxml wx:key 使用
          isTransfer: true,
          transferCity: city,
          firstLine,
          secondLine,
          displayRoute: `${firstLine.fromCityName} → ${city} → ${secondLine.toCityName}`,
          fullRoute: `${firstLine.fromCityName} → ${city} → ${secondLine.toCityName}${needAppend ? ' → ' + toText : ''}`
        });
      });
    });
  });

  const dedup = new Set();
  return transferList.filter(t => {
    const key = `${kid(t.firstLine) || ''}-${kid(t.secondLine) || ''}`;
    if (dedup.has(key)) return false;
    dedup.add(key);
    return true;
  }).slice(0, 20);
}

exports.main = async (event) => {
  const fromCity = String(event.fromCity || '');
  const fromText = String(event.fromText || '');
  const toCity = String(event.toCity || '');
  const toText = String(event.toText || '');

  if (!fromText || !toText) return { ok: false, error: '缺少出发地/目的地' };

  try {
    const directList = await searchDirect(fromCity, fromText, toCity, toText);

    if (directList.length > 0) {
      // 有效会员置顶；isVip 修正为"未过期"口径，前端展示零改动
      const now = Date.now();
      directList.forEach(l => { l.isVip = effectiveVip(l, now); });
      directList.sort((a, b) => (b.isVip || 0) - (a.isVip || 0));
      return { ok: true, directList, transferList: [] };
    }

    // 无直达，尝试中转
    const fromCityLevel = getCityLevel(fromCity || fromText);
    const toCityLevel = getCityLevel(toCity || toText);

    if (fromCityLevel && toCityLevel && fromCityLevel !== toCityLevel) {
      const transferList = await searchTransfer(fromCityLevel, toCityLevel, fromText, toText);
      const now = Date.now();
      transferList.forEach(t => {
        t.firstLine.isVip = effectiveVip(t.firstLine, now);
        t.secondLine.isVip = effectiveVip(t.secondLine, now);
      });
      return { ok: true, directList: [], transferList };
    }

    return { ok: true, directList: [], transferList: [] };
  } catch (e) {
    console.error('searchLine 失败：', e);
    return { ok: false, error: '查询失败' };
  }
};
