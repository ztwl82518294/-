// 地名匹配回归测试：node .workbuddy/scripts/test-place-match.js
// 覆盖：乡镇级容错（羊流镇/羊流/洋流镇）、原有严格口径未被放松、景德镇类专名未被误削。
const assert = require('assert');
const placeMatch = require('../../cloudfunctions/searchLine/placeMatch.js');
const regionData = require('../../cloudfunctions/searchLine/regionData.js');
const { norm, cityCore, sameCity, contains, isParentCity } = placeMatch;
const { getCityLevel } = regionData;

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓', name); }
  catch (e) { fail++; console.log('  ✗', name, '→', e.message); }
}

// 复刻 searchLine.searchDirect 的判定表达式（与 index.js 保持同步）
function directHit(item, fromCity, fromText, toCity, toText) {
  const stdFrom = getCityLevel(fromCity || fromText);
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
  return fromMatch && (toCityMatch || toRad);
}

const yangliu = { fromCityName: '济南市', toCityName: '羊流镇', fromCity: '济南', toCity: '羊流镇', fromAreas: [], toAreas: [], status: 1 };
const yangliuNoIdx = { ...yangliu, fromCity: '', toCity: '' };
const xintai = { fromCityName: '济南市', toCityName: '新泰市', fromCity: '济南', toCity: '新泰', fromAreas: [], toAreas: [], status: 1 };
const jingde = { fromCityName: '济南市', toCityName: '景德镇市', fromCity: '济南', toCity: '景德镇', fromAreas: [], toAreas: [], status: 1 };

console.log('\n[1] 本次报障场景：济南 → 羊流镇');
t('输入"羊流"命中（有索引）', () => assert.strictEqual(directHit(yangliu, '', '济南', '', '羊流'), true));
t('输入"羊流"命中（无索引兜底）', () => assert.strictEqual(directHit(yangliuNoIdx, '', '济南', '', '羊流'), true));
t('输入"羊流镇"命中', () => assert.strictEqual(directHit(yangliu, '', '济南', '', '羊流镇'), true));
t('输入"济南市"出发 + "羊流"命中', () => assert.strictEqual(directHit(yangliu, '', '济南市', '', '羊流'), true));
t('常见错写"洋流镇"命中', () => assert.strictEqual(directHit(yangliu, '', '济南', '', '洋流镇'), true));
t('常见错写"洋流"命中', () => assert.strictEqual(directHit(yangliu, '', '济南', '', '洋流'), true));

console.log('\n[2] 不相关的目的地不得误命中');
t('济南→新泰 不命中羊流线路', () => assert.strictEqual(directHit(yangliu, '', '济南', '', '新泰'), false));
t('济南→泰安 不命中羊流线路', () => assert.strictEqual(directHit(yangliu, '', '济南', '', '泰安'), false));
t('济南→羊流 不命中新泰线路', () => assert.strictEqual(directHit(xintai, '', '济南', '', '羊流'), false));
t('济南→临沂 不命中新泰线路', () => assert.strictEqual(directHit(xintai, '', '济南', '', '临沂'), false));

console.log('\n[3] 原口径保持');
t('济南→新泰 命中新泰线路（市/无后缀互通）', () => assert.strictEqual(directHit(xintai, '', '济南', '', '新泰'), true));
t('济南市→新泰市 命中新泰线路', () => assert.strictEqual(directHit(xintai, '', '济南市', '', '新泰市'), true));
t('景德镇专名未被削字：济南→景德镇 命中', () => assert.strictEqual(directHit(jingde, '', '济南', '', '景德镇'), true));
t('景德镇上游仍可识别：getCityLevel(景德镇市)=景德镇', () => assert.strictEqual(getCityLevel('景德镇市'), '景德镇'));
t('乐平 → 景德镇 判定为下级（isParentCity 未回归）', () => assert.strictEqual(isParentCity('景德镇市', '乐平'), true));

console.log('\n[4] 区县 / 全境 口径未被放松');
t('单字输入不做包含匹配：搜"陵"不命中辐射区含"乐陵"', () =>
  assert.strictEqual(contains(['乐陵'], '陵', '德州'), false));
t('辐射区"德州全境"命中搜"乐陵"', () =>
  assert.strictEqual(contains(['德州全境'], '乐陵', '德州'), true));
t('区县输入命中上级市线路（金堂 → 成都）', () =>
  assert.strictEqual(isParentCity('成都', '金堂'), true));

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
if (fail) process.exit(1);
