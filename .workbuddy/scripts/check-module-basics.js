/**
 * PRD「模块基础能力」自检
 *
 * 检查每个页面是否具备符合其场景的基础能力：
 *   列表类页面 → 下拉刷新 / 触底加载 / 加载态 / 空态 / 失败态
 *   表单类页面 → 提交态防重 / 校验 / 成功反馈
 *   tabBar 页面 → 返回顶部（onShow 复位等）
 *
 * 用法：node .workbuddy/scripts/check-module-basics.js
 * 退出码：0 = 全通过，1 = 有缺口
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PAGES = path.join(ROOT, 'pages');

/**
 * 每个页面的场景定义：
 *   kind: list  = 列表/检索型
 *         form  = 表单型
 *         static= 纯静态文本型（协议页）
 *   need: 该场景必须具备的能力键
 */
const SPEC = {
  'index': {
    kind: 'list',
    need: ['pullDown', 'loading', 'empty', 'error'],
    note: '首页：天空大卡 + 公告栏 + 优质线路推广，下拉刷新'
  },
  'search-by-address': {
    kind: 'list',
    need: ['pullDown', 'reachBottom', 'loading', 'empty', 'error'],
    note: '查专线：结果列表需分页加载'
  },
  'search-by-company': {
    kind: 'list',
    need: ['pullDown', 'reachBottom', 'loading', 'empty', 'error'],
    note: '查公司：结果列表需分页加载'
  },
  'route-detail': {
    kind: 'list',
    need: ['pullDown', 'loading', 'empty', 'error'],
    note: '线路详情：跑这条线的公司列表'
  },
  'company-detail': {
    kind: 'list',
    need: ['pullDown', 'loading', 'empty', 'error'],
    note: '公司详情：档案 + 覆盖线路'
  },
  'correction': {
    kind: 'form',
    need: ['submitting', 'validate'],
    note: '纠错表单：防重复提交 + 必填校验'
  },
  'disclaimer': { kind: 'static', need: [], note: '免责声明：纯文本' },
  'privacy': { kind: 'static', need: [], note: '隐私规则：纯文本' },
  /*
   * 后台管理五页（PRD 模块 06 的小程序形态）
   * ★ admin/index 与 admin/quality 的 need 里**故意没有 empty**：
   *   总览和质量看板展示的都是「数字」，0 也是有效结果（0 家公司 = 真的没有），
   *   弹一个「暂无数据」是把正常状态说成异常。缺的是 empty 不是 bug。
   */
  'admin/index': {
    kind: 'list',
    need: ['pullDown', 'loading', 'error'],
    note: '后台总览：身份确认 + 数据规模 + 八个入口（数字恒有，无空态）'
  },
  'admin/list': {
    kind: 'list',
    need: ['pullDown', 'reachBottom', 'loading', 'empty', 'error'],
    note: '后台通用列表：搜索 + 分页 + 删除 + 纠错审核'
  },
  'admin/edit': {
    kind: 'form',
    need: ['submitting', 'validate'],
    note: '后台通用表单：必填校验 + 防重复提交'
  },
  'admin/quality': {
    kind: 'list',
    need: ['pullDown', 'loading', 'error'],
    note: '数据质量看板：数字恒有，无空态'
  },
  'admin/import': {
    kind: 'form',
    need: ['submitting', 'validate'],
    note: '批量导入：两阶段（预览 → 确认），预览不写数据'
  }
};

const CAP_LABEL = {
  pullDown: '下拉刷新（enablePullDownRefresh + onPullDownRefresh）',
  reachBottom: '触底加载（onReachBottom 或 scrolltolower）',
  loading: '加载态（loading 标志 + 骨架/文案）',
  empty: '空态（无数据时的友好提示）',
  error: '失败态（加载失败可重试）',
  submitting: '提交防重（submitting 标志）',
  validate: '必填校验'
};

let fail = 0;
const problems = [];

Object.keys(SPEC).forEach((name) => {
  const dir = path.join(PAGES, name);
  const jsPath = path.join(dir, 'index.js');
  const wxmlPath = path.join(dir, 'index.wxml');
  const jsonPath = path.join(dir, 'index.json');

  const js = fs.existsSync(jsPath) ? fs.readFileSync(jsPath, 'utf8') : '';
  const wxml = fs.existsSync(wxmlPath) ? fs.readFileSync(wxmlPath, 'utf8') : '';
  const json = fs.existsSync(jsonPath) ? JSON.parse(fs.readFileSync(jsonPath, 'utf8')) : {};
  const spec = SPEC[name];

  const hit = {};

  hit.pullDown = json.enablePullDownRefresh === true && /onPullDownRefresh\s*\(/.test(js);
  hit.reachBottom = /onReachBottom\s*\(/.test(js) || /bindscrolltolower|scrolltolower/.test(wxml);
  /*
   * 加载态：标志名可以是 loading，也可以是**区块级的** featLoading / xxLoading。
   * 首页改版后只有「优质线路」一块需要加载态（公告有内置兜底，不会空），
   * 所以标志叫 featLoading —— 只认 `loading:` 会把一个真的有的加载态判成缺失。
   */
  hit.loading = /[A-Za-z]*[Ll]oading\s*[:=]/.test(js) && /loading/.test(wxml);
  /**
   * 空态：两种合法写法都算
   *   a) 有专门的 empty/notFound/noResult 状态标志
   *   b) 直接用「结果长度为 0」驱动渲染（如 wx:if="{{results.length === 0}}"）
   *      —— 这同样是有效的空态，不该判为缺失。
   */
  hit.empty =
    (/empty|notFound|noResult|noData/.test(js) && /empty|notFound|noResult|noData/.test(wxml)) ||
    (/\.length\s*===?\s*0|\.length\s*<\s*1/.test(wxml) && /empty-title|empty-desc/.test(wxml)) ||
    /*
     * 第三种合法写法：空态**只写在模板里**（wx:else + 空态样式类 / 文案）。
     * 首页的「暂无推广线路」就是这个形态 —— JS 里没有 empty 标志，
     * 靠 wx:elif/wx:else 分支驱动。用户看得见，就该算有。
     */
    (/wx:else/.test(wxml) && /empty-inline|empty-title|empty-desc|class="empty"/.test(wxml));
  /**
   * 失败态：必须有「明确区分于空态」的失败标志 + 可点的重试入口。
   *   只在注释里提「重试」不算 —— 用户点不到就不算有失败态。
   */
  /*
   * 失败态的标志名同样允许区块级（featError / xxError）：
   * 只认 loadError 会让「明明有失败态可重试」的页面被判成缺口。
   */
  hit.error =
    /\w*Error\s*[:=]/.test(js) &&
    /\w*Error/.test(wxml) &&
    (/bindtap="onRetry|bindtap="onRetryLoad|bindtap="onRetryRecommend/.test(wxml) || /重试|重新加载|重新查询|重新搜索/.test(wxml));
  hit.submitting = /submitting/.test(js) && /submitting/.test(wxml);
  hit.validate = /必填|validate|请填写|请选择/.test(js);

  const missing = spec.need.filter((k) => !hit[k]);
  const ok = missing.length === 0;

  console.log(
    (ok ? '  [OK]  ' : '  [缺口]') + ' ' + name.padEnd(20) +
    ' (' + spec.kind + ') ' + spec.note
  );
  if (!ok) {
    missing.forEach((k) => console.log('           ✗ 缺: ' + CAP_LABEL[k]));
    fail++;
    problems.push({ page: name, missing: missing.map((k) => CAP_LABEL[k]) });
  }
});

console.log('\n----------------------------------------');
if (fail === 0) {
  console.log('模块基础能力检查：全部通过（' + Object.keys(SPEC).length + ' 个页面）');
  process.exit(0);
} else {
  console.log('模块基础能力检查：' + fail + ' 个页面存在缺口');
  process.exit(1);
}
