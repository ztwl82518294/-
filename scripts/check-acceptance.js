#!/usr/bin/env node
/**
 * PRD 第七章验收自检（A1~A12）
 *
 * ★ 为什么要有这个脚本：
 *   PRD 的验收标准是**给非开发人员看的**（有「检查方法」和「通过标准」两列）。
 *   但「人工点一遍」有两个问题：一是容易漏，二是改完代码后不复验就不知道还在不在。
 *   所以把能静态判定的部分固化成断言 —— 让「AI 认为通过」变成「可复现的机器结论」。
 *
 * ★ 本脚本的边界（必须说清楚，避免误以为它证明了全部）：
 *   它做的是**静态与结构检查**：文件在不在、配置对不对、代码里有没有那个能力。
 *   它**不能**替代真机验证 —— 拨号盘是否能唤起、隐私弹窗是否真的弹出、
 *   云数据库里到底有没有数据，这三类必须人工在微信开发者工具里点一遍。
 *   凡是不能自动判定的，脚本会标 [人工] 并要求人去确认，而不是假装通过。
 *
 * 用法：node scripts/check-acceptance.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

let pass = 0;
let manual = 0;
let fail = 0;
const failures = [];
const manualItems = [];

function ok(label, cond, extra) {
  if (cond) {
    pass++;
    console.log('  ✓ ' + label + (extra ? ' — ' + extra : ''));
  } else {
    fail++;
    failures.push(label + (extra ? ' — ' + extra : ''));
    console.log('  ✗ ' + label + (extra ? ' — ' + extra : ''));
  }
}

/** 需要人工确认的项：不假装通过，明确列出来 */
function needHuman(label, how) {
  manual++;
  manualItems.push(label + '  →  ' + how);
  console.log('  ○ ' + label + '  [人工] ' + how);
}

function section(t) {
  console.log('');
  console.log('【' + t + '】');
}

function read(rel) {
  const p = path.join(ROOT, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

/** 递归收集某目录下指定后缀的文件 */
function walk(dir, ext, out) {
  out = out || [];
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  fs.readdirSync(abs, { withFileTypes: true }).forEach((d) => {
    const rel = path.join(dir, d.name);
    if (d.isDirectory()) walk(rel, ext, out);
    else if (!ext || d.name.endsWith(ext)) out.push(rel);
  });
  return out;
}

/* ============================================================ */
console.log('PRD 第七章验收自检（A1~A12）');
console.log('='.repeat(56));
console.log('');
console.log('说明：本脚本做静态与结构检查。「拨号、隐私弹窗、云库数据」三类');
console.log('      必须人工验，脚本会标 [人工] —— 不会假装通过。');

const appJson = JSON.parse(read('app.json'));
const pages = appJson.pages || [];

/* ---------- A1 云环境可用 ---------- */
section('A1 云环境可用');
const appJs = read('app.js');
ok('app.js 里初始化了云开发', /wx\.cloud\.init/.test(appJs));
/*
 * ★ 云环境 ID 的位置：直接写在 app.js 的 CLOUD_ENV 常量里。
 *   不单独建 config/ 目录 —— 小程序只有一个云环境，
 *   为它单开一个配置文件属于「为了分层而分层」，反而多一处要同步的地方。
 */
ok('云环境 ID 已配置（app.js 的 CLOUD_ENV 常量）',
  /CLOUD_ENV\s*=\s*'[^']+'/.test(appJs),
  (appJs.match(/CLOUD_ENV\s*=\s*'([^']+)'/) || [])[1]);
ok('云环境 ID 不是占位符', !/CLOUD_ENV\s*=\s*'(your|xxx|TODO|<)/i.test(appJs));
ok('云初始化失败不阻塞启动（有 try/catch 兜底）',
  /initCloud[\s\S]{0,600}catch/.test(appJs));
ok('utils/db.js 封装了数据库访问', exists('utils/db.js'));
ok('页面通过工具层取数（不散落 db.collection 调用）',
  walk('pages', '.js').every((f) => !/\.collection\(/.test(read(f))),
  '页面里不应直接出现 .collection(');
needHuman('列表页有真实数据渲染且无报错',
  '在微信开发者工具打开首页/列表页，确认有数据、Console 无红色报错');

/* ---------- A2 数据表建成 ---------- */
section('A2 数据表建成（8 张）');
const schema = read('shared/schema.js');
/*
 * ★ 集合清单必须与 shared/schema.js 的 COLLECTIONS **同源**，别再手抄一遍。
 *   2026-09-22 加了 announcements / featured_routes 之后，这里的手写清单
 *   还停在 6 张，静态检查全绿却漏掉了两张表 —— 手写清单一定会漂移。
 */
const ALL_COLLECTIONS = Object.values(require('../shared/schema').COLLECTIONS);
ALL_COLLECTIONS.forEach((c) => {
  ok('schema 里定义了 ' + c, schema.indexOf(c) >= 0);
});
ok('schema 有 COLLECTIONS 常量（集合名唯一来源）', /COLLECTIONS/.test(schema));
ok('各表字段定义齐全（FIELD 定义存在）', /FIELDS/.test(schema));
needHuman('云开发控制台里 ' + ALL_COLLECTIONS.length + ' 张表实际存在',
  '打开云开发控制台 → 数据库，确认 ' + ALL_COLLECTIONS.length + ' 个集合都在（' +
  ALL_COLLECTIONS.join(' / ') + '），且已导入 .data/*.jsonl');

/* ---------- A3 冷启动完整链路 ---------- */
section('A3 冷启动完整链路（匿名可查）');
ok('首页存在', pages.indexOf('pages/index/index') >= 0);
ok('按地址查专线页存在', pages.indexOf('pages/search-by-address/index') >= 0);
ok('线路详情页存在', pages.indexOf('pages/route-detail/index') >= 0);
ok('公司详情页存在', pages.indexOf('pages/company-detail/index') >= 0);
const routeDetailJs = read('pages/route-detail/index.js');
const routeDetailWxml = read('pages/route-detail/index.wxml');
ok('线路详情页能拿到公司列表', /compan/.test(routeDetailJs));
ok('线路详情页有拨号能力', /makePhoneCall|phone/i.test(routeDetailJs));
ok('线路详情页模板里有电话入口', /phone|电话|拨号/.test(routeDetailWxml));
needHuman('走完「首页 → 选城市 → 线路详情 → 看到公司 → 点电话可拨号」且无死链',
  '在开发者工具里实际点一遍');

/* ---------- A4 按公司查链路 ---------- */
section('A4 按公司查链路');
ok('按公司查页存在', pages.indexOf('pages/search-by-company/index') >= 0);
const byCompanyJs = read('pages/search-by-company/index.js');
ok('该页调用公司搜索', /search|compan/i.test(byCompanyJs));
ok('公司详情页能列出该公司的全部线路', /route/.test(read('pages/company-detail/index.js')));
needHuman('输入某公司简称 → 能搜到 → 详情页看到全部线路', '实际输入「鲁通」之类简称试一次');

/* ---------- A5 反向查询 ---------- */
section('A5 反向查询');
/** 所有页面的 js / wxml 拼接体（供通用能力断言使用） */
const allJs = walk('pages', '.js').map(read).join('\n') +
  walk('components', '.js').map(read).join('\n');
const allWxml = walk('pages', '.wxml').map(read).join('\n') +
  walk('components', '.wxml').map(read).join('\n');
/*
 * ★ 反向查是**页面级能力**，不放在 utils：
 *   它要做的是「把当前路由参数里的 from/to 互换后重新查询」，
 *   属于页面职责（要知道自己的路由参数结构），塞进 utils 反而要额外传一堆上下文。
 *   所以这里断言的是「页面里有这个能力」，不是「utils 里有这个函数」。
 */
const addrPageJs = read('pages/search-by-address/index.js');
const addrPageWxml = read('pages/search-by-address/index.wxml');
const rdPageJs = read('pages/route-detail/index.js');
const rdPageWxml = read('pages/route-detail/index.wxml');
ok('按地址查页实现了反向查', /reverse|反向|swap/i.test(addrPageJs));
ok('按地址查页有反向查按钮', /reverse|反向|换向|对调/i.test(addrPageWxml));
ok('线路详情页也有反向查入口（查回程）',
  /reverse|反向/i.test(rdPageJs + rdPageWxml));
ok('互换逻辑确实交换了出发与到达', /swap|互换|\[to,\s*from\]|\[1\]\s*,\s*.*\[0\]/i.test(
  addrPageJs + rdPageJs));
ok('反向查无数据时走空状态（不是报错）',
  /empty|暂无|没有找到|空状态/i.test(addrPageJs + rdPageJs));
needHuman('在结果页点「反向查」，出发与目的地互换，无数据时显示空状态而非报错',
  '实际点一次，并试一个没有数据的反向线路');

/* ---------- A6 空结果不崩 ---------- */
section('A6 空结果不崩');
ok('列表页有空状态处理', /empty|暂无|没有找到|空状态/i.test(allJs));
ok('空状态有引导文案（不是光秃秃的空白）', /暂无|没有找到|换个|试试|引导/i.test(allJs));
ok('有统一的错误处理（不裸奔）', exists('utils/db.js') && /catch/.test(read('utils/db.js')));
needHuman('查一条不存在的线路（如 拉萨→某小城），显示空状态、无白屏、无报错',
  '实际查一次');

/* ---------- A7 匿名可用 ---------- */
section('A7 匿名可用（不登录不授权也能用）');
ok('app.json 里没有强制登录页', !/login/i.test(JSON.stringify(pages)));
ok('代码里没有「必须登录」的拦截', !/requireLogin|mustLogin/i.test(read('app.js') + read('utils/db.js')));
ok('隐私弹窗是「弹窗」而非「登录墙」（组件形式）', exists('components/privacy-modal/index.wxml'));
const privacyModalJs = read('components/privacy-modal/index.js');
ok('隐私弹窗可跳过/可关闭（不阻断查询）', /close|skip|agree|reject|取消/i.test(privacyModalJs));
needHuman('清除小程序缓存后重进，不登录不授权仍能完成全部查询与拨号',
  '开发者工具里「清缓存 → 清除全部缓存」后重进试一次');

/* ---------- A8 更新时间可见 ---------- */
section('A8 更新时间可见（X 天前更新）');
ok('utils/common.js 有相对时间格式化', /timeAgo|relativeTime|天前|fromNow/i.test(read('utils/common.js')));
ok('详情页渲染里用到了相对时间', /timeAgo|天前/i.test(allJs + allWxml));
ok('数据里带 updatedAt 字段', /updatedAt/.test(schema));
needHuman('打开任意线路详情，每行能看到「X 天前更新」字样', '实际看一眼');

/* ---------- A9 免责声明 ---------- */
section('A9 免责声明可查');
ok('免责声明页存在', pages.indexOf('pages/disclaimer/index') >= 0);
const disclaimerWxml = read('pages/disclaimer/index.wxml');
ok('免责声明内容非空且成段', disclaimerWxml.length > 800, disclaimerWxml.length + ' 字符');
ok('首页底部有免责声明入口',
  /disclaimer/i.test(read('pages/index/index.wxml')));
needHuman('首页底部有入口，点开有完整内容', '点一次看排版');

/* ---------- A10 隐私合规 ---------- */
section('A10 隐私合规');
ok('隐私政策页存在', pages.indexOf('pages/privacy/index') >= 0);
const privacyWxml = read('pages/privacy/index.wxml');
ok('隐私政策内容非空且成段', privacyWxml.length > 800, privacyWxml.length + ' 字符');
ok('首次进入弹出隐私协议（app.js 里有处理）',
  /privacy|隐私/i.test(read('app.js')));
ok('utils/privacy.js 存在（隐私状态管理）', exists('utils/privacy.js'));
ok('有《用户信息处理规则》表述',
  /用户信息处理规则|信息处理规则/.test(privacyWxml + read('pages/privacy/index.js')));
needHuman('首次进入真的弹出隐私协议；能找到《用户信息处理规则》页',
  '清缓存后重进验证弹窗；从「我的」或首页找到政策页');

/* ---------- A11 拨号可用 ---------- */
section('A11 拨号可用');
const phoneCalls = walk('pages', '.js').filter((f) => /wx\.makePhoneCall/.test(read(f)));
ok('有页面实现了 wx.makePhoneCall', phoneCalls.length > 0,
  phoneCalls.join(', '));
ok('拨号前会清洗号码（去空格/横线）', /replace\(|cleanPhone|normalizePhone/i.test(
  read('utils/common.js') + read('utils/privacy.js') + phoneCalls.map(read).join('\n')));
ok('拨号失败有兜底提示（用户取消不该报错）', /fail\s*:|catch/i.test(phoneCalls.map(read).join('\n')));
needHuman('点任意电话号码，唤起系统拨号盘且号码正确', '真机预览点一次');

/* ---------- A12 提审材料 ---------- */
section('A12 提审材料');
ok('有隐私政策页（提审必需）', pages.indexOf('pages/privacy/index') >= 0);
ok('有免责声明页（提审必需）', pages.indexOf('pages/disclaimer/index') >= 0);
/*
 * ★ 客服联系方式的唯一来源是 utils/privacy.js 的 CONTACT 常量
 *   （不单独建 contact.js —— 它与隐私政策正文里写的联系方式是同一份信息，
 *    分开放必然出现「政策里改了、页脚没改」的不一致）。
 */
const privacyJs = read('utils/privacy.js');
ok('客服联系方式已配置在 utils/privacy.js 的 CONTACT',
  /const CONTACT\s*=/.test(privacyJs));
ok('客服电话是真实号码（非占位符）', /phone:\s*'\d{11}'/.test(privacyJs),
  (privacyJs.match(/phone:\s*'([^']+)'/) || [])[1]);
ok('客服微信已配置', /wechat:\s*'[^']+'/.test(privacyJs),
  (privacyJs.match(/wechat:\s*'([^']+)'/) || [])[1]);
ok('CONTACT 已导出供页面使用', /CONTACT\s*[,}]/.test(privacyJs) && /module\.exports/.test(privacyJs));
ok('隐私政策正文里写明了联系方式（法定要求，不能只写「运营方」）',
  /15165018553|联系方式/.test(read('pages/privacy/index.wxml') + privacyJs));
ok('project.config.json 存在且配置完整',
  exists('project.config.json') && !!JSON.parse(read('project.config.json')).appid);
ok('sitemap.json 存在（收录配置）', exists('sitemap.json'));
needHuman('类目资质说明（个人主体 → 工具 → 信息查询）已备好',
  '提审时在微信后台填写；个人主体不能选需企业资质的类目');

/* ============================================================ */
console.log('');
console.log('='.repeat(56));
console.log('静态断言 ' + (pass + fail) + ' 个：通过 ' + pass + '，失败 ' + fail);
console.log('需人工确认 ' + manual + ' 项');
if (fail) {
  console.log('');
  console.log('失败项：');
  failures.forEach((f) => console.log('  ✗ ' + f));
}
if (manualItems.length) {
  console.log('');
  console.log('需人工在微信开发者工具 / 真机确认的项：');
  manualItems.forEach((m) => console.log('  ○ ' + m));
}
console.log('');
console.log(fail ? '❌ 有静态检查未通过' : '✅ 静态检查全部通过（人工项见上）');

process.exit(fail ? 1 : 0);
