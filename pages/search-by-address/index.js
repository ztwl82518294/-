/**
 * 按地址查专线（PRD 模块 02）
 *
 * 解决「我有货要从 A 发到 B，谁跑这条线」。
 *
 * 功能清单（PRD）：
 *   - 出发地 + 目的地两级选择器（省 → 市逐级选，也可直接输关键字）
 *   - 结果筛选：是否直达 / 是否天天发车 / 时效范围
 *   - 结果卡片：公司名、电话（一键拨打）、时效、备注
 *   - ★ 一键反向查：交换出发地与目的地，查回程线路（本模块独有）
 *   - 空结果引导：推荐相邻城市 / 提示可提交需求
 *
 * 本页同时是 Tab 页，可能被首页用 globalData 通道带入初始条件。
 */

const db = require('../../utils/db');
const common = require('../../utils/common');
const params = require('../../utils/params');
const { filterRows, sortRows } = require('../../utils/search');

/** 时效筛选项（null 表示不限） */
const DAY_OPTIONS = [
  { value: '', label: '不限时效' },
  { value: 1, label: '1 天内' },
  { value: 2, label: '2 天内' },
  { value: 3, label: '3 天内' }
];

Page({
  data: {
    fromCity: '',
    /** 出发地区县（可空；★ 只影响展示，查询按 fromCity 走） */
    fromArea: '',
    toCity: '',
    /** 到达地区县（同上） */
    toArea: '',

    /** 城市选择器 */
    pickerVisible: false,
    pickerTitle: '选择城市',
    /** 'from' | 'to' */
    pickerTarget: 'from',

    /** 筛选条件 */
    directOnly: false,
    dailyOnly: false,
    maxDays: '',
    dayOptions: DAY_OPTIONS,
    dayIndex: 0,

    /** 结果 */
    loading: false,
    searched: false,
    /** 加载失败（可重试） */
    loadError: false,
    rows: [],
    total: 0,

    /** 分页：是否还有下一页 */
    hasMore: false,
    /** 是否正在加载下一页（触底时用） */
    loadingMore: false,

    /** 空结果引导 */
    emptyHint: '',

    /** 展开的备注（点整卡展开/收起备注与价格） */
    expandId: ''
  },

  onLoad() {
    // 支持从别的页面带参进入（如首页热门线路点击后的反向）
    const q = this.options || {};
    const from = params.safeDecode(q.from);
    const to = params.safeDecode(q.to);
    const next = {};
    if (from) next.fromCity = from;
    if (to) next.toCity = to;
    // 区县只做展示，但既然传来了就收下，否则用户选的区县一跳就没了
    const fa = params.safeDecode(q.fromArea);
    const ta = params.safeDecode(q.toArea);
    if (fa) next.fromArea = fa;
    if (ta) next.toArea = ta;
    if (Object.keys(next).length) this.setData(next);
  },

  /** 下拉刷新：有查询条件就重查，没有就只是收掉刷新动画 */
  onPullDownRefresh() {
    const done = () => wx.stopPullDownRefresh();
    if (this.data.searched && this.data.fromCity && this.data.toCity) {
      // 清掉展开项，回到「这条线的全量结果」——这才是刷新该有的语义
      this.setData({ expandId: '' }, () => {
        this.doSearch().then(done).catch(done);
      });
    } else {
      done();
    }
  },

  /**
   * 触底加载下一页
   *
   * ★ 不能简单地「拉一页就显示」：筛选项（直达/天天发车/时效）是**客户端**过滤，
   *   若当前页全被筛掉，用户会看到「列表到底了但其实还有数据」。
   *   因此这里循环补页，直到「攒够足够展示的条数」或「后端真的没有下一页」。
   */
  async onReachBottom() {
    if (this.data.loadingMore || !this.data.hasMore) return;
    if (!this._route) return;

    this.setData({ loadingMore: true });
    try {
      await this.loadMoreUntilEnough();
    } catch (err) {
      wx.showToast({ title: '加载失败，请稍后重试', icon: 'none' });
    }
    this.setData({ loadingMore: false });
  },

  /** 每次补到「已过滤结果 >= 本页下限」为止；最多补 5 页防止死循环 */
  async loadMoreUntilEnough() {
    const MIN_VISIBLE = 8;
    for (let i = 0; i < 5; i++) {
      if (!this.data.hasMore) break;
      const res = await db.pageRouteCompanies(this._route._id, this._page, db.PAGE_SIZE);
      this._page += 1;
      this._allRows = (this._allRows || []).concat((res.rows || []).map((x) => this.decorate(x)));
      this.setData({ hasMore: res.hasMore === true });
      this.applyFilter();
      if (this.data.rows.length >= MIN_VISIBLE || !res.rows.length) break;
    }
  },

  /**
   * 承接首页/其它页的跨 Tab 传参。
   * 必须在 onShow 里做（switchTab 不触发 onLoad）。
   */
  onShow() {
    const app = getApp();
    if (!app || !app.takePendingAddressQuery) return;
    const pending = app.takePendingAddressQuery();
    if (!pending) return;

    const next = {};
    if (pending.from) next.fromCity = pending.from;
    if (pending.to) next.toCity = pending.to;
    /*
     * ★ 区县要一起带过来。首页搜「朝阳」时 hit.city = '北京'、hit.area = '朝阳区'，
     *   若这里只接城市，用户会看到「朝阳区」跳过来变成光秃秃的「北京」，
     *   像是我们把他的选择丢了。
     */
    next.fromArea = pending.fromArea || '';
    next.toArea = pending.toArea || '';
    // 带入新条件时清掉旧的筛选，避免「上次勾了直达导致看着像没结果」
    next.directOnly = false;
    next.dailyOnly = false;
    next.maxDays = '';
    next.dayIndex = 0;
    next.rows = [];
    next.searched = false;
    this.setData(next);

    if (pending.from && pending.to) this.doSearch();
  },

  /* ============================================================
   * 城市选择
   * ============================================================ */

  onPickFrom() {
    this.setData({ pickerVisible: true, pickerTarget: 'from', pickerTitle: '选择出发地' });
  },

  onPickTo() {
    this.setData({ pickerVisible: true, pickerTarget: 'to', pickerTitle: '选择目的地' });
  },

  /**
   * 城市（含区县）选定
   *
   * ★ detail 里 city 与 area 是两回事：
   *   city 用于**查询**（专线库按城市收录），area 只用于**展示**。
   *   这里绝不能拿 detail.name / detail.area 去覆盖 city ——
   *   否则选了「朝阳区」就变成查「朝阳区」，永远查不到线路。
   */
  onCitySelected(e) {
    const d = e.detail || {};
    const city = d.city || '';
    if (!city) return;

    const isFrom = this.data.pickerTarget === 'from';
    const next = { pickerVisible: false };
    if (isFrom) {
      next.fromCity = city;
      next.fromArea = d.area || '';
    } else {
      next.toCity = city;
      next.toArea = d.area || '';
    }
    // 条件变了，旧结果失效
    next.rows = [];
    next.searched = false;
    this.setData(next);
  },

  onPickerClose() {
    this.setData({ pickerVisible: false });
  },

  /** 清空某一侧（区县跟着一起清，否则会残留一个没城市的区县） */
  onClearFrom() {
    this.setData({ fromCity: '', fromArea: '', rows: [], searched: false });
  },

  onClearTo() {
    this.setData({ toCity: '', toArea: '', rows: [], searched: false });
  },

  /* ============================================================
   * ★ 一键反向查（本模块独有）
   * ============================================================ */

  onSwap() {
    const { fromCity, toCity, fromArea, toArea } = this.data;
    if (!fromCity && !toCity) {
      wx.showToast({ title: '请先选择城市', icon: 'none' });
      return;
    }
    // 区县跟着城市一起换，否则「北京·朝阳 → 上海」反向后变成「上海 → 北京·朝阳」
    this.setData({
      fromCity: toCity,
      fromArea: toArea,
      toCity: fromCity,
      toArea: fromArea,
      rows: [],
      searched: false
    }, () => {
      // 交换后若两侧都有值，自动查一次（这就是「反向查」的价值：少点一步）
      if (this.data.fromCity && this.data.toCity) this.doSearch();
    });
  },

  /* ============================================================
   * 筛选
   * ============================================================ */

  onToggleDirect() {
    this.setData({ directOnly: !this.data.directOnly }, () => this.applyFilter());
  },

  onToggleDaily() {
    this.setData({ dailyOnly: !this.data.dailyOnly }, () => this.applyFilter());
  },

  onDayChange(e) {
    const idx = Number(e.detail.value) || 0;
    const opt = DAY_OPTIONS[idx] || DAY_OPTIONS[0];
    this.setData({ dayIndex: idx, maxDays: opt.value }, () => this.applyFilter());
  },

  onResetFilter() {
    this.setData({ directOnly: false, dailyOnly: false, maxDays: '', dayIndex: 0 }, () => this.applyFilter());
  },

  /* ============================================================
   * 查询
   * ============================================================ */

  async doSearch() {
    const { fromCity, toCity } = this.data;

    if (!fromCity) {
      wx.showToast({ title: '请选择出发地', icon: 'none' });
      return;
    }
    if (!toCity) {
      wx.showToast({ title: '请选择目的地', icon: 'none' });
      return;
    }
    if (fromCity === toCity) {
      wx.showToast({ title: '出发地和目的地相同', icon: 'none' });
      return;
    }

    this.setData({ loading: true, searched: true, loadError: false, expandId: '' });

    let route = null;
    let page = null;
    try {
      route = await db.findRoute(fromCity, toCity);
      if (route) page = await db.pageRouteCompanies(route._id, 0, db.PAGE_SIZE);
    } catch (err) {
      // 网络/云函数异常：跟「查无此线」是两回事，必须分开提示
      this._allRows = [];
      this._route = null;
      this.setData({
        loading: false,
        loadError: true,
        rows: [],
        total: 0,
        hasMore: false,
        emptyHint: ''
      });
      return;
    }

    if (!route) {
      this._allRows = [];
      this._route = null;
      this.setData({
        loading: false,
        loadError: false,
        rows: [],
        total: 0,
        hasMore: false,
        emptyHint: this.buildEmptyHint(fromCity, toCity)
      });
      return;
    }

    // 归一：每条关联自带公司档案，预处理出展示字段
    this._allRows = (page.rows || []).map((x) => this.decorate(x));
    this._route = route;
    this._page = 1;

    this.setData({
      loading: false,
      loadError: false,
      hasMore: page.hasMore === true
    });
    this.applyFilter();

    // 首页若被筛空，但后端还有数据，主动再补几页，避免误判「没有直达/没有天天发车」
    if (this.data.rows.length === 0 && this.data.hasMore) {
      await this.loadMoreUntilEnough();
    }
  },

  /** 关联行 → 展示用的行数据 */
  decorate({ link, company }) {
    const phones = common.splitPhones(company.phone).concat(common.splitPhones(company.backupPhone));
    const primaryPhone = phones[0] || '';
    return {
      link: link,
      company: company,
      companyId: company._id,
      displayName: company.shortName || company.name,
      fullName: company.name,
      verified: company.verified === true,
      scaleText: common.scaleLabel(company.scale),
      cityText: [company.province, company.city].filter(Boolean).join(' '),
      phone: primaryPhone,
      hasPhone: !!primaryPhone,
      transitText: common.transitLabel(link.transitDays),
      directText: link.isDirect === true ? '直达' : '需中转',
      isDirect: link.isDirect === true,
      frequencyText: common.frequencyLabel(link.frequency),
      priceNote: link.priceNote || '',
      remark: link.remark || '',
      updatedText: common.relativeTime(link.updatedAt),
      stations: common.parseStations(company.departureStations)
    };
  },

  /** 应用筛选 + 排序后刷新列表 */
  applyFilter() {
    const all = this._allRows || [];
    if (!all.length) {
      this.setData({ rows: [], total: 0 });
      return;
    }

    const filtered = filterRows(
      all.map((r) => ({ link: r.link, company: r.company, _deco: r })),
      {
        direct: this.data.directOnly,
        daily: this.data.dailyOnly,
        maxDays: this.data.maxDays
      }
    );

    const sorted = sortRows(filtered, 'composite');
    const rows = sorted.map((x) => x._deco);

    this.setData({ rows, total: rows.length });
  },

  /** 空结果引导文案（PRD：推荐相邻城市 / 提示可提交需求） */
  buildEmptyHint(fromCity, toCity) {
    return '暂时没有找到「' + fromCity + ' → ' + toCity + '」的专线。\n' +
      '可以试试：\n' +
      '· 换一个相邻城市，例如 ' + fromCity + ' 周边的物流枢纽\n' +
      '· 用「反向查」看看是否有回程线路\n' +
      '· 如果这条线确实存在，欢迎通过页面右下角反馈给我们';
  },

  /* ============================================================
   * 结果操作
   * ============================================================ */

  /** 点击整卡：展开/收起备注 */
  onRowTap(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ expandId: this.data.expandId === id ? '' : id });
  },

  /** 拨号 */
  onCall(e) {
    const phone = e.currentTarget.dataset.phone;
    if (!phone) return;
    wx.makePhoneCall({ phoneNumber: String(phone) });
  },

  /** 进公司详情 */
  onCompanyTap(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: '/pages/company-detail/index?id=' + encodeURIComponent(id) });
  },

  /** 纠错：带上当前线路上下文 */
  onReport(e) {
    const routeKey = e.currentTarget.dataset.key;
    const name = e.currentTarget.dataset.name || '';
    wx.navigateTo({
      url: '/pages/correction/index?targetType=route_company&targetId=' +
        encodeURIComponent(routeKey || '') + '&summary=' + encodeURIComponent(name)
    });
  },

  /** 空状态下引导去反馈 */
  onEmptyReport() {
    const { fromCity, toCity } = this.data;
    const summary = fromCity && toCity ? (fromCity + ' → ' + toCity + '（线路缺失）') : '';
    wx.navigateTo({
      url: '/pages/correction/index?targetType=route_company&targetId=' +
        encodeURIComponent(common.buildRouteKey(fromCity, toCity)) +
        '&summary=' + encodeURIComponent(summary)
    });
  },

  /** 加载失败重试 */
  onRetry() {
    this.doSearch();
  },

  /** 失败态里换个条件 */
  onResetQuery() {
    this.setData({
      fromCity: '',
      fromArea: '',
      toCity: '',
      toArea: '',
      rows: [],
      total: 0,
      searched: false,
      loadError: false,
      expandId: ''
    });
  }
});
