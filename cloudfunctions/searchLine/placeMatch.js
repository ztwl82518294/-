// utils/placeMatch.js
// 地名匹配纯逻辑模块（供 line-list 等页面复用，可在 Node 中直接单测）
//
// 匹配规则总览：
// 1. norm() 去掉 市/区/县/省/自治州/盟 后缀得到核心词；
// 2. 别名分组（PLACE_ALIAS_GROUPS）：同一地区新旧写法互通（如 陵县=陵城区）；
// 3. 普通辐射匹配：单字核心词只接受精确相等（防"乐陵"误命中"陵"）；多字词前缀锚定；
// 4. 全境匹配：辐射区含"全境"时（如 重庆全境 / 全国全境 / 裸"全境"=本线路城市全境），
//    用户输入的下属区县/城市经内置行政区划表（regionData）归属判定后命中。
// 5. 乡镇级容错（sameCity）：城市字段比对时剥离末级行政后缀（镇/乡/街道/村），
//    线路写"羊流镇"、用户搜"羊流"也能命中；regionData 归属判定不受此影响。
//
// 注意：norm/placeKey 仅用于匹配，界面展示一律用原始文字。

const regionData = require('./regionData.js');

function norm(s) {
  if (!s) return '';
  return String(s).trim().replace(/(市|区|县|省|自治州|盟)$/, '');
}

// ===== 乡镇级（末级行政单位）容错 =====
// 背景：专线数据常把目的地直接写到乡镇/街道一级（如"济南-羊流专线：济南市 → 羊流镇"），
// 而用户查询时一般只写核心名（"羊流"）。此前城市字段是"归一化后严格相等"比较，
// "羊流" ≠ "羊流镇" 直接漏单。这里补一层末级后缀容错。
// 注意：仅用于"用户输入地名 vs 线路城市名"的比对；regionData 的上级归属判定
// （全境辐射、isParentCity）仍走 norm，避免把"景德镇"削成"景德"后断链。
const SUB_CITY_SUFFIX = /(镇|乡|街道|办事处|村)$/;

// 乡镇级同音/常见错写归一（只影响比对，不改展示文字）。按需扩展。
const TOWN_ALIAS = { '洋流': '羊流' }; // 常见错写：洋流镇 → 羊流镇（山东新泰）

/**
 * 城市字段比对专用核心词：norm 后再剥掉末级行政后缀（镇/乡/街道/村）。
 * 只有当剥离后仍 ≥2 字才剥，避免"景德镇市""海南州"这类专名被削掉一个字。
 */
function cityCore(s) {
  const n = norm(s);
  if (!n) return '';
  if (n.length <= 2) return TOWN_ALIAS[n] || n;
  const core = n.replace(SUB_CITY_SUFFIX, '');
  return TOWN_ALIAS[core] || core;
}

/**
 * 判定"线路城市名"与"用户输入地名"是否同一地：
 *   ① 归一化相等（济南市 = 济南）；
 *   ② 剥离末级行政后缀后相等（羊流镇 = 羊流、平谷镇 = 平谷）。
 * 单字仍走精确相等，不做包含，避免"陵"误命中"乐陵"。
 */
function sameCity(a, b) {
  const x = cityCore(a);
  const y = cityCore(b);
  return !!x && x === y;
}

// 地名别名归一表：同一地区的新旧/不同写法归到同一规范名。
// 分组内填"归一化后"的名字（已去掉 市/区/县 后缀），第一个为规范名（取最长，通常是现名）
const PLACE_ALIAS_GROUPS = [
  ['陵城', '陵'], // 陵城区（现名）= 陵县（旧称），山东德州
  ['万盛', '万盛经开'], // 万盛（规范）= 万盛经开区/万盛经济技术开发区（norm 后为"万盛经开"），重庆
  ['雄安', '雄安新'], // 雄安新区：norm 后为"雄安新"，归一到雄安，河北保定
  ['两江', '两江新'], // 两江新区，重庆
  ['天府', '天府新'], // 天府新区，四川成都
  ['滨海', '滨海新'], // 滨海新区，天津（表中规范名 norm 后为"滨海新"）
  ['西海岸', '胶南'] // 青岛西海岸新区 = 胶南（旧称）
];
const PLACE_ALIAS_MAP = (() => {
  const m = {};
  PLACE_ALIAS_GROUPS.forEach(g => g.forEach(t => { m[t] = g; }));
  return m;
})();

// 归一并映射到规范名；不在别名表则返回归一化原名
// 规范名取组内第一个元素（如 万盛 组：'万盛'为规范名，'万盛经开'归一到它）
function placeKey(name) {
  const n = norm(name);
  if (!n) return '';
  const g = PLACE_ALIAS_MAP[n];
  if (!g) return n;
  return g[0];
}

// 数据库粗过滤用：返回需纳入匹配的全部写法（自身 + 同组别名）
function aliasTokens(text) {
  const n = norm(text);
  if (!n) return [];
  const g = PLACE_ALIAS_MAP[n];
  return g ? g.slice() : [n];
}

// 数据库粗过滤用：别名写法 + 输入地名的上级地区（如 渝中→重庆），
// 保证"辐射区=全境、线路城市=上级地区"的线路也能被捞出。
// 每个别名变体也并入其上级（如 滨海→滨海新→天津），新区类写法不断链
function queryTokens(text) {
  const toks = aliasTokens(text);
  aliasTokens(text).forEach(t => {
    regionData.parentsOf(t).forEach(p => {
      const n = norm(p);
      if (n && toks.indexOf(n) === -1) toks.push(n);
    });
  });
  return toks;
}

// 全境归属判定：base 为覆盖地区规范名（如 重庆/山东/全国），inputKey 为用户输入规范名
function regionMatch(base, inputKey) {
  const b = placeKey(base);
  if (!b || !inputKey) return false;
  if (b === '全国') return true;                       // 全国全境：任意输入命中
  if (b === inputKey) return true;                    // 输入就是该地区本身
  if (b.indexOf(inputKey) === 0 || inputKey.indexOf(b) === 0) return true; // 前缀锚定（如 重庆市）
  // 递归查找所有上级（省→市→区县），支持省份级全境匹配（如 四川全境 覆盖 汶川）
  // 每个别名变体都参与归属判定（如 滨海=滨海新，任一写法的上级命中即可）
  return aliasTokens(inputKey).some(v =>
    regionData.allParentsOf(v).some(p => placeKey(p) === b)
  );
}

/**
 * 判断辐射区列表是否覆盖 name
 * @param {Array|string} areas 辐射区（数组或逗号分隔字符串）
 * @param {string} name 用户输入地名
 * @param {string} selfCityName 本线路对应端的城市名（裸"全境"时的全境范围）
 */
function contains(areas, name, selfCityName) {
  if (!areas || !name) return false;
  const list = Array.isArray(areas) ? areas : String(areas).split(',');
  const n = placeKey(name);
  if (!n) return false;
  return list.some(a => {
    if (!a) return false;
    const raw = String(a).trim();
    const s = placeKey(raw);
    if (!s) return false;
    // 全境匹配：重庆全境 / 全国全境 / 全国 / 全境（裸=本线路城市全境）
    if (s === '全国' || raw.indexOf('全境') !== -1) {
      let base = s.replace(/全境/g, '');
      if (!base) base = norm(selfCityName || '');
      if (regionMatch(base, n)) return true;
    }
    if (s === n) return true; // 规范名相等（含别名互通，如 陵县=陵城区）
    // 单字核心词只接受精确匹配，避免误命中任何含该字的地名（如"乐陵/广陵/江陵"含"陵"）
    if (n.length === 1) return false;
    // 多字词：前缀锚定匹配（行政区名核心词在开头），不做任意位置包含
    return s.indexOf(n) === 0 || n.indexOf(s) === 0;
  });
}

/**
 * 判断 cityName 是否是 countyName 的上级地区（市/省/直辖市）
 * 用于"用户输入区县名，线路城市=上级市/省"的匹配
 * 例：用户搜金堂，线路 toCityName=成都 → true；用户搜临西，线路 toCityName=河北 → true
 * @param {string} cityName 线路的城市名（可为市、省、直辖市）
 * @param {string} countyName 用户输入的区县名
 */
function isParentCity(cityName, countyName) {
  const cityKey = norm(cityName);
  if (!cityKey || !countyName) return false;
  // 用 allParentsOf 递归查找所有上级（含省→市→区县多级），支持省级目的地匹配
  // 每个别名变体都参与判定（如 滨海=滨海新 → 天津；雄安新=雄安 → 保定）
  return aliasTokens(countyName).some(v =>
    regionData.allParentsOf(v).some(p => norm(p) === cityKey)
  );
}

module.exports = { norm, cityCore, sameCity, placeKey, aliasTokens, queryTokens, contains, regionMatch, isParentCity };
