/**
 * 公司详情页（PRD 模块 03）
 *
 * 「纵向展开」——一家公司铺开看。与线路详情页（横向对比）方向相反，
 * 因此字段排布必须差异化：这里按出发城市分组展示全部线路。
 *
 * 功能清单（PRD）：
 *   - 公司详情页：全称、简称、总部地址、电话、经营主体、简介、是否已核实
 *   - 「覆盖线路」按出发地城市分组展示所有目的地
 *   - 跳转线路详情：点击某条线路可跳到「跑这条线的所有公司」
 *
 * ★ 与线路详情的差异（PRD 2.2 关键设计原则）：
 *   线路详情 = 比价台 → 字段垂直对齐，一眼扫完
 *   公司详情 = 档案页 → 分组展开，强调这家公司的覆盖广度
 */

const db = require('../../utils/db');
const common = require('../../utils/common');
const params = require('../../utils/params');

Page({
  data: {
    id: '',
    loading: true,
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
    /** 按出发城市分组的线路 */
    groups: [],
    /** 线路总数 */
    routeCount: 0
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
    this.setData({ loading: true });

    const company = await db.getById('companies', id);
    if (!company) {
      this.setData({ loading: false, notFound: true });
      return;
    }

    const raw = await db.listCompanyRoutes(id);
    const rows = raw.map(({ link, route }) => ({
      link: link,
      route: route,
      routeKey: (route && route.routeKey) || link.routeKey || '',
      title: common.routeTitle((route && route.fromCity) || '', (route && route.toCity) || ''),
      toCity: (route && route.toCity) || '',
      transitText: common.transitLabel(link.transitDays),
      isDirect: link.isDirect === true,
      directText: link.isDirect === true ? '直达' : '中转',
      frequencyText: common.frequencyLabel(link.frequency),
      priceNote: link.priceNote || '',
      remark: link.remark || '',
      updatedText: common.relativeTime(link.updatedAt),
      companyCount: Number((route && route.companyCount) || 0)
    }));

    const groups = require('../../utils/search').groupRoutesByFromCity(
      rows.map((r) => ({ link: r.link, route: r.route, _deco: r }))
    ).map((g) => ({
      city: g.city,
      province: g.province,
      count: g.routes.length,
      routes: g.routes.map((x) => x._deco)
    }));

    this.setData({
      loading: false,
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
      groups: groups,
      routeCount: rows.length
    });

    wx.setNavigationBarTitle({ title: (company.shortName || company.name) || '公司详情' });

    // 浏览量统计：静默调用，失败不影响页面（这是附属功能，主流程优先）
    this.trackView(id);
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

  /** 折叠/展开某个城市分组 */
  onToggleGroup(e) {
    const city = e.currentTarget.dataset.city;
    const groups = this.data.groups.map((g) => {
      if (g.city !== city) return g;
      return Object.assign({}, g, { collapsed: !g.collapsed });
    });
    this.setData({ groups });
  }
});
