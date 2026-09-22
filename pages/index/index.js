/**
 * 首页总览（PRD 模块 01 + 验收 A3）
 *
 * 首页要回答一个问题：「你这小程序是干嘛的，我怎么用」。用户要在 3 秒内明白。
 *
 * 五个区块（PRD 第三章，从上到下）：
 *   1. 顶部搜索框 —— 同时支持搜城市和搜公司名，系统自动判断类型
 *   2. 快捷入口 —— 「我要发货」→ 查专线 ；「我知道公司名」→ 查公司
 *   3. 热门专线 —— 高频线路卡片，点击直达线路详情
 *   4. 最近更新 —— 最近被修正/新增的公司条目，传递「数据是活的」
 *   5. 底部公示 —— 免责声明入口 + 数据更新时间说明 + 隐私政策入口
 *
 * 首页不做的事（PRD 明确）：不做轮播 Banner、不做登录引导弹窗、不做定位授权强制要求。
 */

const db = require('../../utils/db');
const common = require('../../utils/common');
const { searchCities, detectKeywordType, searchCompanies } = require('../../utils/search');
const { CITIES } = require('../../data/cities');
const { DISCLAIMER_TEXT, CONTACT } = require('../../utils/privacy');

/** 首页热门展示条数 */
const HOT_LIMIT = 6;
/** 最近更新展示条数 */
const RECENT_LIMIT = 5;

Page({
  data: {
    loading: true,
    /** 首页数据加载失败（可重试）。三个区块互相独立，全失败才展示整页失败态 */
    loadError: false,
    keyword: '',

    /** 热门线路：[{ _id, routeKey, fromCity, toCity, companyCount, updatedText }] */
    hotRoutes: [],
    /** 最近更新的公司 */
    recentCompanies: [],

    /** 数据更新时间说明（底部公示用） */
    dataUpdatedText: '',
    /** 免责声明摘要（首页直接展示一句，无需点进去） */
    disclaimerBrief: '',
    operator: CONTACT.operator
  },

  onLoad() {
    this.setData({
      disclaimerBrief: DISCLAIMER_TEXT.paragraphs[0].desc
    });
    this.loadAll();
  },

  onPullDownRefresh() {
    this.loadAll().then(() => wx.stopPullDownRefresh());
  },

  /** 一次性拉齐首页两个数据块；两块都失败才算整页失败，避免一半网络抖动就白屏 */
  async loadAll() {
    this.setData({ loading: true, loadError: false });

    let okCount = 0;

    /*
     * ★★ 不要写成数组解构 `const [r1, r2] = await Promise.all([...])`。
     *   开发者工具开了「增强编译」（project.config.json 的 enhance:true）时用 SWC 编译，
     *   数组解构会被编译成对 @swc/runtime 的 require：
     *     module '@swc/runtime/_array_with_holes.js' is not defined
     *   而本环境没装这个包 ⇒ **整个页面直接白屏**。（2026-09-22 真机踩过）
     *   ⇒ 小程序端一律用下标取值，别用数组解构 / 对象展开 / 数组展开 / for...of。
     */
    const res = await Promise.all([
      db.listHotRoutes(HOT_LIMIT).then((x) => { okCount++; return x; }).catch(() => null),
      db.listRecentCompanies(RECENT_LIMIT).then((x) => { okCount++; return x; }).catch(() => null)
    ]);

    const routes = res[0] || [];
    const companies = res[1] || [];

    if (okCount === 0) {
      this.setData({ loading: false, loadError: true });
      return;
    }

    // 用最新的一个 updatedAt 作为「数据更新时间」展示依据
    let latest = 0;
    routes.concat(companies).forEach((x) => {
      const t = Number(x.updatedAt) || 0;
      if (t > latest) latest = t;
    });

    this.setData({
      loading: false,
      loadError: false,
      hotRoutes: routes.map((r) => this.decorateRoute(r)),
      recentCompanies: companies.map((c) => this.decorateCompany(c)),
      dataUpdatedText: latest
        ? '数据最近更新于 ' + common.formatDate(latest)
        : '数据持续更新中'
    });
  },

  /** 首页加载失败重试 */
  onRetryLoad() {
    this.loadAll();
  },

  /** 线路展示装饰：标题、相对时间 */
  decorateRoute(r) {
    const title = common.routeTitle(r.fromCity, r.toCity);
    return Object.assign({}, r, {
      title: title,
      companyText: (Number(r.companyCount) || 0) + ' 家公司',
      updatedText: common.relativeTime(r.updatedAt)
    });
  },

  /** 公司展示装饰 */
  decorateCompany(c) {
    return Object.assign({}, c, {
      displayName: c.shortName || c.name,
      updatedText: common.relativeTime(c.updatedAt),
      scaleText: common.scaleLabel(c.scale)
    });
  },

  /* ============================================================
   * 区块 1：搜索框
   * ============================================================ */

  onSearchInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  /**
   * 搜索提交：自动判断关键词类型
   *   city    → 跳到查专线（把它当出发地）
   *   company → 跳到查公司
   *   both    → 跳查专线（城市优先，因为城市搜索的确定性更高）
   *   empty   → 提示输入
   */
  async onSearchConfirm() {
    const kw = String(this.data.keyword || '').trim();
    if (!kw) {
      wx.showToast({ title: '请输入城市或公司名', icon: 'none' });
      return;
    }

    const type = detectKeywordType(kw, CITIES);

    if (type === 'company') {
      this.gotoCompanyTab(kw);
      return;
    }

    // city / both：命中城市则直达该城市的线路列表
    const hit = searchCities(CITIES, kw)[0];
    if (hit) {
      this.gotoAddressTab(hit.name, '');
      return;
    }

    // 既不像城市也不是公司：仍给一次公司搜索的机会，避免用户以为没反应
    this.gotoCompanyTab(kw);
  },

  /* ============================================================
   * 区块 2：快捷入口
   * ============================================================ */

  goShip() {
    wx.switchTab({ url: '/pages/search-by-address/index' });
  },

  goCompany() {
    wx.switchTab({ url: '/pages/search-by-company/index' });
  },

  /* ============================================================
   * 区块 3：热门专线
   * ============================================================ */

  onHotTap(e) {
    const routeKey = e.currentTarget.dataset.key;
    if (!routeKey) return;
    wx.navigateTo({
      url: '/pages/route-detail/index?key=' + encodeURIComponent(routeKey)
    });
  },

  /* ============================================================
   * 区块 4：最近更新
   * ============================================================ */

  onRecentTap(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({
      url: '/pages/company-detail/index?id=' + encodeURIComponent(id)
    });
  },

  /* ============================================================
   * 区块 5：底部公示
   * ============================================================ */

  goDisclaimer() {
    wx.navigateTo({ url: '/pages/disclaimer/index' });
  },

  goPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/index' });
  },

  /* ============================================================
   * 跨 Tab 传参
   * ============================================================ */

  /** 跳「查专线」并带上出发地/目的地 */
  gotoAddressTab(from, to) {
    const app = getApp();
    if (app && app.setPendingAddressQuery) app.setPendingAddressQuery(from, to);
    wx.switchTab({ url: '/pages/search-by-address/index' });
  },

  /** 跳「查公司」并带上关键词 */
  gotoCompanyTab(kw) {
    const app = getApp();
    if (app && app.setPendingCompanyKeyword) app.setPendingCompanyKeyword(kw);
    wx.switchTab({ url: '/pages/search-by-company/index' });
  }
});
