/**
 * 公司详情页（PRD 模块 03）
 *
 * 「纵向展开」——一家公司铺开看。与线路详情页（横向对比）方向相反，
 * 因此字段排布必须差异化。
 *
 * ★ 线路展示策略（v5.3 改）：
 *   默认 **平铺** 全部线路，不再按出发城市自动拆组。
 *   原因：实测 25 家多线路公司里 16 家（64%）横跨多个出发城市，
 *   按出发城市自动分组会把「同一家公司的线路」拆得七零八落
 *   （如中铁快运 4 条被拆成 济南/成都/乌鲁木齐 3 组），
 *   与用户「同一公司所有线路合并一起」的诉求相反。
 *   保留一个「按出发地分组」开关供需要时归拢，默认关闭。
 *
 * 功能清单（PRD）：
 *   - 公司详情页：全称、简称、总部地址、电话、经营主体、简介、是否已核实
 *   - 「覆盖线路」平铺展示全部线路（可切换按出发地分组）
 *   - 跳转线路详情：点击某条线路可跳到「跑这条线的所有公司」
 *
 * ★ 与线路详情的差异（PRD 2.2 关键设计原则）：
 *   线路详情 = 比价台 → 字段垂直对齐，一眼扫完
 *   公司详情 = 档案页 → 强调这家公司的覆盖广度与完整线路清单
 */

const db = require('../../utils/db');
const common = require('../../utils/common');
const params = require('../../utils/params');
const search = require('../../utils/search');

Page({
  data: {
    id: '',
    loading: true,
    /** 加载失败（与「没找到」区分开：失败可重试，没找到重试也无用） */
    loadError: false,
    notFound: false,
    company: null,
    /** 装饰后的基本信息 */
    info: {
      displayName: '',
      fullName: '',
      verified: false,
      scaleText: '',
      cityText: '',
      address: '',
      phones: [],
      intro: '',
      updatedText: ''
    },
    /** 平铺后的全部线路（默认视图） */
    routes: [],
    /** 按出发城市分组后的线路（开关打开时才用） */
    groups: [],
    /** 是否按出发地分组展示 */
    grouped: false,
    /** 线路总数 */
    routeCount: 0,
    /** 去过的出发城市数，用于提示「覆盖 N 个出发地」 */
    fromCityCount: 0
  },

  onLoad(options) {
    const id = params.safeDecode(options && options.id);
    if (!id) {
      this.setData({ loading: false, notFound: true });
      return;
    }
    this.setData({ id });
    this.load(id);
  },

  onPullDownRefresh() {
    this.load(this.data.id).then(() => wx.stopPullDownRefresh());
  },

  async load(id) {
    this.setData({ loading: true, loadError: false });

    let company = null;
    let raw = [];
    try {
      company = await db.getById('companies', id);
      if (!company) {
        this.setData({ loading: false, notFound: true, loadError: false });
        return;
      }
      raw = await db.listCompanyRoutes(id);
    } catch (err) {
      // 与「查无此人」区分：这里是网络/云函数异常，给重试入口
      this.setData({ loading: false, notFound: false, loadError: true });
      return;
    }

    const routes = this.decorate(raw);
    const groups = this.buildGroups(routes);

    this.setData({
      loading: false,
      loadError: false,
      notFound: false,
      company: company,
      info: {
        displayName: company.shortName || company.name,
        fullName: company.name,
        verified: company.verified === true,
        scaleText: common.scaleLabel(company.scale),
        cityText: [company.province, company.city].filter(Boolean).join(' '),
        address: company.address || '',
        phones: common.splitPhones(company.phone).concat(common.splitPhones(company.backupPhone)),
        intro: company.intro || '',
        updatedText: common.relativeTime(company.updatedAt)
      },
      routes: routes,
      groups: groups,
      routeCount: routes.length,
      fromCityCount: new Set(routes.map((r) => r.fromCity || '未知')).size
    });

    wx.setNavigationBarTitle({ title: (company.shortName || company.name) || '公司详情' });

    // 浏览量统计：静默调用，失败不影响页面（这是附属功能，主流程优先）
    this.trackView(id);
  },

  /**
   * 把 [{link, route}] 装饰成可直接渲染的行
   * ★ 顺序即展示顺序：出发城市 → 目的地，保证同城线路连在一起
   */
  decorate(raw) {
    const rows = (Array.isArray(raw) ? raw : []).map(({ link, route }) => ({
      link: link,
      route: route,
      routeKey: (route && route.routeKey) || link.routeKey || '',
      fromCity: (route && route.fromCity) || '',
      toCity: (route && route.toCity) || '',
      title: common.routeTitle((route && route.fromCity) || '', (route && route.toCity) || ''),
      transitText: common.transitLabel(link.transitDays),
      isDirect: link.isDirect === true,
      frequencyText: common.frequencyLabel(link.frequency),
      priceNote: link.priceNote || '',
      remark: link.remark || '',
      updatedText: common.relativeTime(link.updatedAt),
      companyCount: Number((route && route.companyCount) || 0)
    }));

    // 平铺排序：出发城市（同城连续）→ 目的地 → 跑的公司多的在前
    rows.sort((a, b) => {
      const c = String(a.fromCity).localeCompare(String(b.fromCity), 'zh');
      if (c !== 0) return c;
      const t = String(a.toCity).localeCompare(String(b.toCity), 'zh');
      if (t !== 0) return t;
      return b.companyCount - a.companyCount;
    });

    return rows;
  },

  /** 分组视图：复用 utils/search 的分组，再把装饰结果挂回去 */
  buildGroups(routes) {
    const byKey = {};
    routes.forEach((r) => { byKey[r.routeKey] = r; });

    return search.groupRoutesByFromCity(
      routes.map((r) => ({ link: r.link, route: r.route }))
    ).map((g) => ({
      city: g.city,
      province: g.province,
      count: g.routes.length,
      collapsed: false,
      routes: g.routes.map((x) => byKey[(x.route && x.route.routeKey) || ''] || null).filter(Boolean)
    }));
  },

  /** 上报一次浏览；失败不提示、不阻塞 */
  trackView(companyId) {
    const app = getApp();
    if (!app || !app.globalData.cloudReady) return;
    wx.cloud.callFunction({
      name: 'trackCompanyView',
      data: { companyId: companyId }
    }).catch(() => {
      // 云函数未部署或网络异常都走这里，静默忽略
    });
  },

  /** 拨号 */
  onCall(e) {
    const phone = e.currentTarget.dataset.phone;
    if (!phone) return;
    wx.makePhoneCall({ phoneNumber: String(phone) });
  },

  /** 复制单个号码（长按） */
  onCopyPhone(e) {
    const phone = e.currentTarget.dataset.phone;
    if (!phone) return;
    wx.setClipboardData({
      data: String(phone),
      success: () => wx.showToast({ title: '号码已复制', icon: 'none' })
    });
  },

  /** 复制地址 */
  onCopyAddress() {
    const addr = this.data.info.address;
    if (!addr) return;
    wx.setClipboardData({
      data: addr,
      success: () => wx.showToast({ title: '地址已复制', icon: 'none' })
    });
  },

  /** 复制全部电话 */
  onCopyPhones() {
    const phones = this.data.info.phones || [];
    if (!phones.length) return;
    wx.setClipboardData({
      data: phones.join('\n'),
      success: () => wx.showToast({ title: '已复制 ' + phones.length + ' 个号码', icon: 'none' })
    });
  },

  /** 点击某条线路 → 跳该线路的「所有公司」 */
  onRouteTap(e) {
    const key = e.currentTarget.dataset.key;
    if (!key) return;
    wx.navigateTo({ url: '/pages/route-detail/index?key=' + encodeURIComponent(key) });
  },

  /** 纠错：带上公司上下文 */
  onReport() {
    const c = this.data.company;
    const name = c ? (c.shortName || c.name) : '';
    wx.navigateTo({
      url: '/pages/correction/index?targetType=company&targetId=' +
        encodeURIComponent(this.data.id) +
        '&summary=' + encodeURIComponent(name)
    });
  },

  /** 切换「平铺 / 按出发地分组」 */
  onToggleGroupMode() {
    this.setData({ grouped: !this.data.grouped });
  },

  /** 折叠/展开某个城市分组 */
  onToggleGroup(e) {
    const city = e.currentTarget.dataset.city;
    const groups = this.data.groups.map((g) => {
      if (g.city !== city) return g;
      return Object.assign({}, g, { collapsed: !g.collapsed });
    });
    this.setData({ groups });
  },

  /** 失败重试 */
  onRetry() {
    if (this.data.id) this.load(this.data.id);
  },

  /** 跳公司列表（线路为空时的兜底出口） */
  goCompanySearch() {
    wx.switchTab({ url: '/pages/search-by-company/index' });
  }
});
