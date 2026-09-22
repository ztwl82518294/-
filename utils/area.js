/**
 * 区县（市/县/区）工具层
 *
 * ★★ 为什么要这一层（2026-09-22 补的缺口）：
 *   出发地/目的地以前只能选到「城市」这一级，直辖市以下的区县选不到 ——
 *   北京只能选到「北京」，选不到朝阳区、通州区；重庆选不到万州区。
 *   而 data/districts.js 里其实早就备好了完整的「城市 → 区县」字典
 *   （344 城全覆盖、2980 个区县），只是**从来没有被任何代码引用过**。
 *   本文件就是把这份字典接进业务的第一层。
 *
 * ★★ 最重要的设计取舍：区县**只影响展示，不影响查询**。
 *   专线数据是按城市收录的（routes.routeKey = '济南-广州'），
 *   不存在「济南-朝阳区」这种线路。所以：
 *     - 用户选「北京 · 朝阳区」时，**查询仍按「北京」**；
 *     - 区县级只是让用户把「发到哪儿」说得更清楚，
 *       真正按区县派送是承运公司的末端服务，不体现在专线库里。
 *   这样 routes 表一条都不用改，routeKey 口径完全不变。
 *
 * ★ 区县名有重名的（如「市中区」在济南和枣庄都有，「鼓楼区」在南京和徐州都有），
 *   所以反查是「区县 → 城市数组」，不是一对一。实际使用总是先选了城市，
 *   再由 cityHint 消歧。
 */

const { DISTRICTS } = require('../data/districts');
const { CITIES } = require('../data/cities');
const common = require('./common');

/* ============================================================
 * 反查表（只建一次）
 * ============================================================ */

/** 区县 → 城市数组（可能多个，因为重名） */
const AREA_TO_CITIES = {};

Object.keys(DISTRICTS).forEach((city) => {
  const list = DISTRICTS[city] || [];
  list.forEach((area) => {
    if (!AREA_TO_CITIES[area]) AREA_TO_CITIES[area] = [];
    if (AREA_TO_CITIES[area].indexOf(city) < 0) AREA_TO_CITIES[area].push(city);
  });
});

/** 城市名 → 城市对象（含 province 等） */
const CITY_BY_NAME = {};
CITIES.forEach((c) => { CITY_BY_NAME[c.name] = c; });

/* ============================================================
 * 基础查询
 * ============================================================ */

/** 某城市下的区县列表（没有则返回空数组，不做任何兜底填充） */
function areasOf(city) {
  return (DISTRICTS[city] || []).slice();
}

/** 某区县所属的城市（可能多个） */
function citiesOfArea(area) {
  return (AREA_TO_CITIES[area] || []).slice();
}

/** 是不是一个已知城市 */
function isCity(name) {
  return !!name && !!CITY_BY_NAME[name];
}

/** 是不是一个已知区县 */
function isArea(name) {
  return !!name && !!AREA_TO_CITIES[name];
}

/**
 * 把一个名字解析成 { city, area }
 *
 * @param {string} name      城市名或区县名
 * @param {string} cityHint  已知的城市上下文（用于区县重名消歧）
 * @returns {{city:string, area:string}} area 为空表示「全市」
 */
function resolvePlace(name, cityHint) {
  const n = String(name || '').trim();
  if (!n) return { city: '', area: '' };

  if (isCity(n)) return { city: n, area: '' };

  const owners = citiesOfArea(n);
  if (!owners.length) return { city: n, area: '' };

  // 重名消歧：优先取城市上下文里那个
  if (cityHint && owners.indexOf(cityHint) >= 0) return { city: cityHint, area: n };
  return { city: owners[0], area: n };
}

/** 「北京 · 朝阳区」这种展示文案 */
function formatPlace(city, area) {
  const c = String(city || '').trim();
  const a = String(area || '').trim();
  if (!c) return a;
  if (!a) return c;
  return c + ' · ' + a;
}

/* ============================================================
 * 搜索：城市 + 区县 混合结果
 * ============================================================ */

/**
 * 区县匹配打分（区县没有拼音数据，只按名称匹配）
 *   100 完全相等 / 90 前缀 / 70 包含
 */
function scoreArea(area, kw) {
  const q = common.normText(kw);
  const name = common.normText(area);
  if (!q || !name) return 0;
  if (name === q) return 100;
  if (name.indexOf(q) === 0) return 90;
  if (q.length >= 2 && name.indexOf(q) >= 0) return 70;
  return 0;
}

/**
 * 搜索「城市 + 区县」混合结果
 *
 * 为什么区县要一起搜：用户输入「朝阳」时，他要的是朝阳区，
 * 只搜城市会一条都搜不到，用户就会以为「没有这个地方」。
 *
 * @returns [{ name, city, area, label, type:'city'|'area', province, _score }]
 */
function searchPlaces(kw, limit) {
  const q = String(kw || '').trim();
  const max = Number(limit) > 0 ? Number(limit) : 40;
  if (!q) return [];

  const out = [];

  // 区县：重名的每个城市都返回一条，标签带城市名，用户一眼能分辨
  Object.keys(AREA_TO_CITIES).forEach((area) => {
    const s = scoreArea(area, q);
    if (s <= 0) return;
    AREA_TO_CITIES[area].forEach((city) => {
      out.push({
        name: area,
        city: city,
        area: area,
        label: area,
        subLabel: city,
        type: 'area',
        province: (CITY_BY_NAME[city] && CITY_BY_NAME[city].province) || '',
        _score: s
      });
    });
  });

  // 城市：给城市一点加权，同名时城市优先（用户更多时候要选市）
  CITIES.forEach((c) => {
    const nq = common.normText(q);
    const name = common.normText(c.name);
    let s = 0;
    if (name === nq) s = 110;
    else if (name.indexOf(nq) === 0) s = 100;
    else if (c.pinyin && common.normText(c.pinyin).indexOf(nq) === 0) s = 80;
    else if (c.initial && common.normText(c.initial).indexOf(nq) === 0) s = 70;
    else if (nq.length >= 2 && name.indexOf(nq) >= 0) s = 60;
    if (s <= 0) return;
    out.push({
      name: c.name,
      city: c.name,
      area: '',
      label: c.name,
      subLabel: '全市',
      type: 'city',
      province: c.province || '',
      _score: s
    });
  });

  out.sort((a, b) => {
    if (b._score !== a._score) return b._score - a._score;
    return String(a.name).localeCompare(String(b.name), 'zh');
  });

  return out.slice(0, max);
}

module.exports = {
  areasOf,
  citiesOfArea,
  isCity,
  isArea,
  resolvePlace,
  formatPlace,
  scoreArea,
  searchPlaces
};
