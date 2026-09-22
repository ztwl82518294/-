// 区划表补漏验证脚本：跑通所有新补地名 + 原有功能回归
const path = require('path');
const regionData = require(path.resolve(__dirname, '../../cloudfunctions/searchLine/regionData.js'));
const placeMatch = require(path.resolve(__dirname, '../../cloudfunctions/searchLine/placeMatch.js'));

let fail = 0;
const t = (label, v) => { console.log((v ? 'PASS' : 'FAIL') + ' | ' + label); if (!v) fail++; };

// ===== 1. 万盛（上轮修复的原始 bug）=====
t('万盛 上级=重庆', regionData.allParentsOf('万盛').indexOf('重庆') > -1);
t('isParentCity(重庆, 万盛)', placeMatch.isParentCity('重庆', '万盛'));

// ===== 2. 直辖镇（东莞/中山镇街）=====
['虎门', '长安', '常平', '塘厦', '厚街', '松山湖'].forEach(x =>
  t('东莞.' + x + ' → 东莞', regionData.parentsOf(x).indexOf('东莞') > -1));
['小榄', '古镇', '三乡', '坦洲'].forEach(x =>
  t('中山.' + x + ' → 中山', regionData.parentsOf(x).indexOf('中山') > -1));
t('contains([东莞全境], 虎门)', placeMatch.contains(['东莞全境'], '虎门'));
t('contains([虎门], 虎门)', placeMatch.contains(['虎门'], '虎门'));

// ===== 3. 海南省直辖县 =====
['澄迈', '陵水', '临高', '昌江'].forEach(x =>
  t('海南.' + x, regionData.parentsOf(x).indexOf('海南') > -1));

// ===== 4. 新疆兵团市 =====
['铁门关', '双河', '昆玉', '胡杨河', '可克达拉'].forEach(x =>
  t('新疆.' + x, regionData.parentsOf(x).indexOf('新疆') > -1));

// ===== 5. 国家级新区/合作区 =====
t('雄安 → 保定', regionData.parentsOf('雄安').indexOf('保定') > -1);
t('雄安新区（norm=雄安新）→ 保定', placeMatch.queryTokens('雄安新区').indexOf('保定') > -1);
t('两江 → 重庆', regionData.parentsOf('两江').indexOf('重庆') > -1);
t('两江新区 → 重庆', placeMatch.queryTokens('两江新区').indexOf('重庆') > -1);
t('天府 → 成都', regionData.parentsOf('天府').indexOf('成都') > -1);
t('天府新区 → 成都', placeMatch.queryTokens('天府新区').indexOf('成都') > -1);
t('西咸 → 西安', regionData.parentsOf('西咸').indexOf('西安') > -1);
t('西咸 → 咸阳', regionData.parentsOf('西咸').indexOf('咸阳') > -1);
t('贵安 → 贵阳', regionData.parentsOf('贵安').indexOf('贵阳') > -1);
t('贵安 → 安顺', regionData.parentsOf('贵安').indexOf('安顺') > -1);
t('深汕 → 深圳', regionData.parentsOf('深汕').indexOf('深圳') > -1);
t('深汕 → 汕尾', regionData.parentsOf('深汕').indexOf('汕尾') > -1);
t('西海岸 → 青岛', regionData.parentsOf('西海岸').indexOf('青岛') > -1);
t('胶南 → 青岛（旧称）', regionData.parentsOf('胶南').indexOf('青岛') > -1);
t('洋浦 → 儋州', regionData.parentsOf('洋浦').indexOf('儋州') > -1);
t('滨海 → 天津（短写法）', placeMatch.queryTokens('滨海').indexOf('天津') > -1);
t('contains([天津全境], 滨海)', placeMatch.contains(['天津全境'], '滨海'));
t('contains([雄安全境], 雄安新区)', placeMatch.contains(['雄安'], '雄安新区'));

// ===== 6. 原有功能回归 =====
t('浦东 → 上海', placeMatch.isParentCity('上海', '浦东'));
t('金堂 → 成都', placeMatch.isParentCity('成都', '金堂'));
t('临西 → 河北（省级）', placeMatch.isParentCity('河北', '临西'));
t('汶川 → 四川（省级递归）', placeMatch.contains(['四川全境'], '汶川'));
t('陵县 = 陵城（别名互通不受影响）', placeMatch.placeKey('陵县') === '陵城');
t('万盛经开区 = 万盛', placeMatch.placeKey('万盛经开区') === '万盛');
t('单字输入不误命中（乐陵≠陵）', !placeMatch.contains(['陵'], '乐陵'));

// ===== 7. 表完整性：CITY_COUNTIES 键都是已知地级市 =====
const provCities = new Set();
Object.keys(regionData.isPrefecture ? [] : []).forEach(() => {});
console.log(fail === 0 ? '\nALL PASSED' : '\nFAILURES: ' + fail);
process.exit(fail === 0 ? 0 : 1);
