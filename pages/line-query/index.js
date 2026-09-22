// pages/line-query/index.js
// 「查专线」tab 页：按出发地 / 目的地查专线。
//
// 与旧首页的区别：
//   1. 查询从首页抽出，首页只做分流（搜索框 + 两个入口卡）；
//   2. 地区选择从原生 picker mode="region"（三列滚轮）换成半屏弹层
//      （components/region-picker），支持"不选区县 = 全市"的常用语义；
//   3. 新增筛选条件（只看直达 / 天天发车 / 时效），随查询参数透传给列表页，
//      在列表页做客户端过滤，不增加云函数负担。
//
// 保持不变的护栏：城市字段仍走 fromCity/fromText/toCity/toText 四个参数，
//   与 searchLine 云函数、utils/storage 的搜索历史口径完全一致。

const storage = require('../../utils/storage.js');
const ui = require('../../utils/ui.js');
const stats = require('../../utils/stats.js');

// 时效筛选：index 0 表示不限，其余为天数上限
const AGING_OPTIONS = ['不限时效', '1天内', '2天内', '3天内'];
const AGING_DAYS = [0, 1, 2, 3];
const AGING_STORAGE_KEY = 'line_query_aging_index';

Page({
  data: {
    fromText: '', toText: '',
    fromCity: '', toCity: '',
    // 筛选条件：直达 / 天天发车 为布尔；时效为下拉索引
    filters: { direct: false, daily: false },
    agingOptions: AGING_OPTIONS,
    agingIndex: 0,
    canQuery: false,

    // 地区弹层
    pickerShow: false,
    pickerTitle: '选择出发地（省/市/区县）',
    pickerValue: null
  },

  // 当前正在编辑哪一端：'from' | 'to'
  _side: 'from',

  onLoad() {
    // 记住上次的时效选择，避免每次重选（货主习惯固定时效）
    try {
      const idx = Number(wx.getStorageSync(AGING_STORAGE_KEY));
      if (idx >= 1 && idx < AGING_OPTIONS.length) this.setData({ agingIndex: idx });
    } catch (e) { /* 读取失败用默认值 */ }
  },

  onShareAppMessage() {
    return { title: '物流专线查询 - 按出发地目的地查专线', path: '/pages/line-query/index' };
  },

  // ---- 地区选择 ----
  pickFrom() {
    this._side = 'from';
    this.setData({
      pickerTitle: '选择出发地（省/市/区县）',
      pickerValue: this.data.fromCity ? { province: this.data.fromCity } : null,
      pickerShow: true
    });
  },

  pickTo() {
    this._side = 'to';
    this.setData({
      pickerTitle: '选择目的地（省/市/区县）',
      pickerValue: this.data.toCity ? { province: this.data.toCity } : null,
      pickerShow: true
    });
  },

  onRegionChange(e) {
    // 弹层内部已算出展示文本与查询城市，这里只落数据
    const d = e.detail || {};
    this.applyRegion(this._side, d);
  },

  onRegionConfirm() {
    this.setData({ pickerShow: false });
  },

  onRegionCancel() {
    this.setData({ pickerShow: false });
  },

  applyRegion(side, d) {
    if (side === 'from') {
      this.setData({
        fromText: d.text || '',
        fromCity: d.queryCity || ''
      });
    } else {
      this.setData({
        toText: d.text || '',
        toCity: d.queryCity || ''
      });
    }
    this.refreshCanQuery();
  },

  refreshCanQuery() {
    const { fromText, toText } = this.data;
    this.setData({ canQuery: !!(fromText && toText) });
  },

  swapCity() {
    const { fromText, toText, fromCity, toCity } = this.data;
    this.setData({
      fromText: toText, toText: fromText,
      fromCity: toCity, toCity: fromCity
    });
    this.refreshCanQuery();
  },

  // ---- 筛选 ----
  toggleDirect() {
    this.setData({ 'filters.direct': !this.data.filters.direct });
  },

  toggleDaily() {
    this.setData({ 'filters.daily': !this.data.filters.daily });
  },

  pickAging() {
    wx.showActionSheet({
      itemList: AGING_OPTIONS,
      success: res => {
        if (res.tapIndex < 0) return;
        this.setData({ agingIndex: res.tapIndex });
        try { wx.setStorageSync(AGING_STORAGE_KEY, res.tapIndex); } catch (e) {}
      }
    });
  },

  // ---- 查询 ----
  onQuery() {
    const { fromText, toText, fromCity, toCity, filters, agingIndex } = this.data;
    if (!fromText) return wx.showToast({ title: '请选择出发地', icon: 'none' });
    if (!toText) return wx.showToast({ title: '请选择目的地', icon: 'none' });

    // 连点会 navigateTo 两次、打开两个列表页；跳转类操作静默忽略（tip=false）
    if (!ui.lock(this, 'query', false)) return;

    storage.addSearchHistory({
      fromCityId: 0, toCityId: 0,
      fromCityName: fromText, toCityName: toText
    });
    stats.logSearch(fromText, toText);

    const q = encodeURIComponent;
    const params = [
      `fromCity=${q(fromCity)}`, `fromText=${q(fromText)}`,
      `toCity=${q(toCity)}`, `toText=${q(toText)}`,
      filters.direct ? 'direct=1' : '',
      filters.daily ? 'daily=1' : '',
      AGING_DAYS[agingIndex] ? `maxDays=${AGING_DAYS[agingIndex]}` : ''
    ].filter(Boolean).join('&');

    wx.navigateTo({
      url: `/pages/line-list/index?${params}`,
      complete: () => ui.unlock(this, 'query')
    });
  },

  goHome() {
    wx.switchTab({ url: '/pages/index/index' });
  },

  // 收藏从 tabBar 让位后移到本页头图，保持"收藏随时可达"
  goFavorite() {
    wx.navigateTo({ url: '/pages/favorite/index' });
  }
});
