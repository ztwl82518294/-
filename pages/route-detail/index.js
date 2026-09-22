/**
 * 线路详情 / 线路公司列表（PRD 模块 04）
 *
 * 解决「就这一条线，把所有跑的公司摆出来让我挑」。
 *
 * 功能清单（PRD）：
 *   - 页面头部固定显示：线路名（如 济南 → 广州）+ 公司总数
 *   - 排序：综合 / 最近更新 / 公司规模 / 时效
 *   - 每行字段：公司名 + 电话 + 时效 + 数据更新时间（如「3天前更新」）
 *   - 标签过滤：只看直达 / 只看天天发车
 *   - ★ 字段横向对齐，保证可扫读
 *
 * 「字段横向对齐」的实现要点：公司名占固定宽度，右侧时效/直达列右对齐，
 * 这样纵向扫视时同一列能对齐成一条线。不能用 flex 自适应宽度，
 * 否则每行长度不同会参差不齐。
 */

const db = require('../../utils/db');
const common = require('../../utils/common');
const params = require('../../utils/params');
const { filterRows, sortRows } = require('../../utils/search');

const SORT_OPTIONS = [
  { value: 'composite', label: '综合' },
  { value: 'updated', label: '最近更新' },
  { value: 'scale', label: '公司规模' },
  { value: 'transit', label: '时效' }
];

Page({
  data: {
    routeKey: '',
    routeTitle: '',
    loading: true,
    notFound: false,
    /** 加载失败（可重试），与 notFound 区分 */
    loadError: false,
    /** 公司总数（未过滤前，头部展示用） */
    totalCount: 0,

    /* 排序与过滤 */
    sortOptions: SORT_OPTIONS,
    sort: 'composite',
    directOnly: false,
    dailyOnly: false,

    /** 过滤后列表 */
    rows: [],
    filteredCount: 0
  },

  onLoad(options) {
    const key = params.safeDecode(options && options.key);
    if (!key) {
      this.setData({ loading: false, notFound: true });
      return;
    }
    this.setData({ routeKey: key, routeTitle: common.routeTitle(common.parseRouteKey(key).fromCity, common.parseRouteKey(key).toCity) });
    this.load(key);
  },

  onPullDownRefresh() {
    this.load(this.data.routeKey).then(() => wx.stopPullDownRefresh());
  },

  async load(key) {
    this.setData({ loading: true, loadError: false });

    let route = null;
    let raw = [];
    try {
      // 按 routeKey 查线路
      const r = await db.list('routes', { where: { routeKey: key }, limit: 1 });
      route = (r.data || [])[0] || null;

      if (!route) {
        this.setData({ loading: false, notFound: true, loadError: false });
        return;
      }

      raw = await db.listRouteCompanies(route._id);
    } catch (err) {
      this.setData({ loading: false, notFound: false, loadError: true });
      return;
    }

    this._allRows = raw.map((x) => this.decorate(x));
    this._route = route;

    const title = common.routeTitle(route.fromCity, route.toCity);
    this.setData({
      loading: false,
      notFound: false,
      loadError: false,
      routeTitle: title,
      totalCount: Number(route.companyCount) || this._allRows.length
    });

    wx.setNavigationBarTitle({ title: title || '线路详情' });
    this.applyFilter();
  },

  /** 加载失败重试 */
  onRetry() {
    if (this.data.routeKey) this.load(this.data.routeKey);
  },

  /** 没找到时的出口：去按地址查 */
  goAddressSearch() {
    wx.switchTab({ url: '/pages/search-by-address/index' });
  },

  /** 关联行 → 展示数据 */
  decorate({ link, company }) {
    const primary = common.splitPhones(company.phone)[0] || '';
    return {
      link: link,
      company: company,
      id: company._id,
      displayName: company.shortName || company.name,
      fullName: company.name,
      verified: company.verified === true,
      phone: primary,
      hasPhone: !!primary,
      transitText: common.transitLabel(link.transitDays),
      isDirect: link.isDirect === true,
      directText: link.isDirect === true ? '直达' : '中转',
      frequencyText: common.frequencyLabel(link.frequency),
      priceNote: link.priceNote || '',
      remark: link.remark || '',
      updatedText: common.relativeTime(link.updatedAt),
      scaleText: common.scaleLabel(company.scale)
    };
  },

  /* ============================================================
   * 排序与过滤
   * ============================================================ */

  onSortChange(e) {
    const sort = e.currentTarget.dataset.sort;
    if (!sort || sort === this.data.sort) return;
    this.setData({ sort }, () => this.applyFilter());
  },

  onToggleDirect() {
    this.setData({ directOnly: !this.data.directOnly }, () => this.applyFilter());
  },

  onToggleDaily() {
    this.setData({ dailyOnly: !this.data.dailyOnly }, () => this.applyFilter());
  },

  onResetFilter() {
    this.setData({ directOnly: false, dailyOnly: false, sort: 'composite' }, () => this.applyFilter());
  },

  applyFilter() {
    const all = this._allRows || [];
    const filtered = filterRows(
      all.map((r) => ({ link: r.link, company: r.company, _deco: r })),
      { direct: this.data.directOnly, daily: this.data.dailyOnly, maxDays: '' }
    );
    const sorted = sortRows(filtered, this.data.sort);
    const rows = sorted.map((x) => x._deco);
    this.setData({ rows, filteredCount: rows.length });
  },

  /* ============================================================
   * 操作
   * ============================================================ */

  onCall(e) {
    const phone = e.currentTarget.dataset.phone;
    if (!phone) return;
    wx.makePhoneCall({ phoneNumber: String(phone) });
  },

  onCompanyTap(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: '/pages/company-detail/index?id=' + encodeURIComponent(id) });
  },

  /** 纠错：带上本线路的上下文 */
  onReport(e) {
    const name = e.currentTarget.dataset.name || '';
    wx.navigateTo({
      url: '/pages/correction/index?targetType=route_company&targetId=' +
        encodeURIComponent(this.data.routeKey) +
        '&summary=' + encodeURIComponent(this.data.routeTitle + (name ? ' · ' + name : ''))
    });
  },

  /** 这条线的反向线路 */
  onReverse() {
    const p = common.parseRouteKey(this.data.routeKey);
    if (!p.fromCity || !p.toCity) return;
    wx.navigateTo({
      url: '/pages/route-detail/index?key=' + encodeURIComponent(common.buildRouteKey(p.toCity, p.fromCity))
    });
  },

  /** 复制全部公司电话（便于批量联系） */
  onCopyPhones() {
    const phones = (this.data.rows || []).map((r) => r.phone).filter(Boolean);
    if (!phones.length) {
      wx.showToast({ title: '没有可复制的电话', icon: 'none' });
      return;
    }
    wx.setClipboardData({
      data: phones.join('\n'),
      success: () => wx.showToast({ title: '已复制 ' + phones.length + ' 个号码', icon: 'none' })
    });
  }
});
