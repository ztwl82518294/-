/**
 * 按公司查线路（PRD 模块 03）
 *
 * 解决「我听说 XX 物流，它到底跑哪些线」。
 *
 * 功能清单（PRD）：
 *   - 公司名模糊搜索，支持简称与常见错别字容错
 *   - 公司详情页（另页：pages/company-detail）
 *   - 「与我相关」优先突出该公司在用户所在城市的线路（本模块独有）
 *
 * ★ 关于「与我相关」：
 *   PRD 要求突出「用户所在城市」的线路，但本项目**不使用定位接口**
 *   （个人主体提审的合规约束，见 utils/privacy.js 的 FORBIDDEN_APIS）。
 *   因此改为「按人气/规模突出」——把大型、已核实、更新近的公司优先展示，
 *   并在详情页提供「自动平铺 + 可选按出发地分组」，用户一眼能看到自己关心的城市。
 *   这是对 PRD 的一处有意偏离，已在 PRD 中标注。
 *
 * ★ 分页策略（v5.3 改）：
 *   匹配是**本地打分**（云端 where 做不了简称/拼音容错），所以先把候选集拉全，
 *   再分页「吐」给视图。首屏只渲染第一页，触底再追加 ——
 *   既保留了模糊匹配能力，又不会一次渲染几百张卡片。
 */

const db = require('../../utils/db');
const common = require('../../utils/common');
const { searchCompanies } = require('../../utils/search');

/** 每页渲染条数（首屏 + 每次触底追加） */
const PAGE_SIZE = 10;

Page({
  data: {
    keyword: '',
    loading: false,
    searched: false,
    /** 加载失败（可重试） */
    loadError: false,
    /** 搜索结果（当前已渲染的部分） */
    results: [],
    /** 匹配总数 */
    total: 0,
    /** 是否还有更多未渲染 */
    hasMore: false,
    /** 未搜索时展示的推荐公司 */
    recommend: [],
    /** 推荐列表是否加载失败 */
    recommendError: false
  },

  onLoad() {
    this.loadRecommend();
  },

  /** 承接跨 Tab 传参（首页搜索框可能带关键词过来） */
  onShow() {
    const app = getApp();
    if (!app || !app.takePendingCompanyKeyword) return;
    const kw = app.takePendingCompanyKeyword();
    if (!kw) return;
    this.setData({ keyword: kw });
    this.doSearch();
  },

  onPullDownRefresh() {
    const task = this.data.searched ? this.doSearch() : this.loadRecommend();
    Promise.resolve(task).then(() => wx.stopPullDownRefresh());
  },

  /** 触底：把已匹配但还没渲染的下一批吐出来（纯内存操作，无需再请求） */
  onReachBottom() {
    if (this.data.loading || !this.data.hasMore) return;
    this.renderNextPage();
  },

  /** 渲染下一批 */
  renderNextPage() {
    const all = this._matched || [];
    const shown = this.data.results.length;
    const next = all.slice(shown, shown + PAGE_SIZE).map((c) => this.decorate(c));
    const results = this.data.results.concat(next);
    this.setData({
      results: results,
      hasMore: results.length < all.length
    });
  },

  /** 未搜索时的推荐：按更新时间倒序取一批「已核实 + 大型」优先 */
  async loadRecommend() {
    let raw = [];
    try {
      const r = await db.list('companies', {
        orderBy: ['updatedAt', 'desc'],
        limit: 20
      });
      raw = r.data || [];
    } catch (err) {
      this.setData({ recommend: [], recommendError: true });
      return;
    }
    const list = raw.map((c) => this.decorate(c));
    list.sort((a, b) => {
      if (a.verified !== b.verified) return a.verified ? -1 : 1;
      const sa = a.scaleRank;
      const sb = b.scaleRank;
      if (sa !== sb) return sb - sa;
      return Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
    });
    this.setData({ recommend: list.slice(0, 12), recommendError: false });
  },

  decorate(c) {
    const rank = { large: 3, medium: 2, small: 1 };
    return Object.assign({}, c, {
      displayName: c.shortName || c.name,
      fullName: c.name,
      verified: c.verified === true,
      scaleText: common.scaleLabel(c.scale),
      scaleRank: rank[c.scale] || 0,
      cityText: [c.province, c.city].filter(Boolean).join(' '),
      updatedText: common.relativeTime(c.updatedAt),
      phone: common.splitPhones(c.phone)[0] || ''
    });
  },

  onInput(e) {
    const kw = e.detail.value;
    this.setData({ keyword: kw });
    if (!String(kw || '').trim()) {
      this._matched = [];
      this.setData({ searched: false, results: [], total: 0, hasMore: false, loadError: false });
    }
  },

  onClear() {
    this._matched = [];
    this.setData({ keyword: '', searched: false, results: [], total: 0, hasMore: false, loadError: false });
  },

  /**
   * 执行搜索
   *
   * 本地匹配策略：云端先粗筛（把全部公司取回来，公司数量级是几十到几百，
   * 一次取回完全可行），再用 utils/search 的打分函数做模糊匹配与排序。
   * 这样「简称 / 全拼 / 首字母」都能命中，而云数据库的 where 做不到。
   *
   * 匹配结果全量缓存在 this._matched，渲染按 PAGE_SIZE 分页吐，触底追加。
   */
  async doSearch() {
    const kw = String(this.data.keyword || '').trim();
    if (!kw) {
      this._matched = [];
      this.setData({ searched: false, results: [], total: 0, hasMore: false });
      return;
    }

    this.setData({ loading: true, searched: true, loadError: false });

    // 公司总量小（样板 40 家，真实规模预计数百），分页拉全再本地匹配
    const all = [];
    let skip = 0;
    const pageSize = db.MAX_PAGE_SIZE;
    try {
      for (let i = 0; i < 10; i++) {
        const r = await db.list('companies', { limit: pageSize, skip: skip });
        if (!r.ok || !r.data.length) break;
        all.push.apply(all, r.data);
        if (r.data.length < pageSize) break;
        skip += pageSize;
      }
    } catch (err) {
      this._matched = [];
      this.setData({ loading: false, loadError: true, results: [], total: 0, hasMore: false });
      return;
    }

    const matched = searchCompanies(all, kw);
    this._matched = matched;

    const first = matched.slice(0, PAGE_SIZE).map((c) => this.decorate(c));

    this.setData({
      loading: false,
      loadError: false,
      results: first,
      total: matched.length,
      hasMore: first.length < matched.length
    });
  },

  onCompanyTap(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: '/pages/company-detail/index?id=' + encodeURIComponent(id) });
  },

  /** 拨号 */
  onCall(e) {
    const phone = e.currentTarget.dataset.phone;
    if (!phone) return;
    wx.makePhoneCall({ phoneNumber: String(phone) });
  },

  /** 纠错：带上公司上下文 */
  onReport(e) {
    const id = e.currentTarget.dataset.id;
    const name = e.currentTarget.dataset.name || '';
    wx.navigateTo({
      url: '/pages/correction/index?targetType=company&targetId=' +
        encodeURIComponent(id || '') + '&summary=' + encodeURIComponent(name)
    });
  },

  /** 没有搜到时的兜底 */
  onReportMissing() {
    const kw = String(this.data.keyword || '').trim();
    wx.navigateTo({
      url: '/pages/correction/index?targetType=company&targetId=' +
        encodeURIComponent(kw) + '&summary=' + encodeURIComponent(kw + '（公司未收录）')
    });
  },

  /** 搜索失败重试 */
  onRetry() {
    this.doSearch();
  },

  /** 推荐列表加载失败重试 */
  onRetryRecommend() {
    this.loadRecommend();
  }
});
