// pages/line-list/index.js
// 专线列表：搜索逻辑已整体迁入 searchLine 云函数（服务端聚合直达+中转），
// 本页只负责调接口、排序展示、筛选与跳转，不再循环 skip 拉全量。

const stats = require('../../utils/stats.js');

// 安全解码 URL 参数：发送端已 encodeURIComponent，这里解回中文；
// 对已解码或非法编码的值做兜底，避免 decodeURIComponent 抛错
function safeDecode(s) {
  if (!s) return '';
  try {
    return decodeURIComponent(s);
  } catch (e) {
    return s;
  }
}

// 时效天数：把 aging 文案（如"1天""2-3天""次日达"）粗解析成天数上限，
// 用于"只看N天内"筛选。解析失败返回 0（视为不限、不被筛掉）。
function parseDays(aging) {
  if (!aging) return 0;
  const s = String(aging);
  const m = s.match(/(\d+)\s*(?:-\s*(\d+))?\s*天/);
  if (m) return Number(m[2] || m[1]) || 0;
  if (/次日|次日达|次日到/.test(s)) return 1;
  if (/隔日/.test(s)) return 2;
  if (/当天|当日/.test(s)) return 1;
  return 0;
}

// 是否"天天发车"：看 tags 或 lineType 里是否含该语义
function isDaily(item) {
  const tags = Array.isArray(item.tags) ? item.tags : [];
  if (tags.some(t => /天天发车|天天走车|每日发车|天天/.test(String(t)))) return true;
  const type = item.lineType || '';
  if (/天天发车|每日/.test(String(type))) return true;
  return false;
}

Page({
  data: {
    fromCityName: '', toCityName: '',
    lineList: [], transferList: [],
    loading: true,
    loadError: false,    // 与"没查到"区分：true=请求失败，不是真的没有结果
    errorMsg: '',
    // 筛选条件（来自查专线页，也允许在列表页调整）
    filterActive: false,
    filters: { direct: false, daily: false, maxDays: 0 },
    // 服务端返回的原始结果（筛选是客户端做的，需保留全集以便取消筛选）
    rawDirect: [], rawTransfer: []
  },

  // 保存查询参数，供"重新查询"复用
  _query: null,

  onLoad(options) {
    const fromText = safeDecode(options.fromText) || '未知';
    const toText = safeDecode(options.toText) || '未知';
    const fromCity = safeDecode(options.fromCity);
    const toCity = safeDecode(options.toCity);
    const filters = {
      direct: options.direct === '1',
      daily: options.daily === '1',
      maxDays: Number(options.maxDays) || 0
    };
    this._query = { fromCity, fromText, toCity, toText };
    this.setData({
      fromCityName: fromText,
      toCityName: toText,
      loading: true,
      loadError: false,
      filters,
      filterActive: !!(filters.direct || filters.daily || filters.maxDays)
    });
    if (fromText !== '未知' && toText !== '未知') stats.logSearch(fromText, toText);
    this.loadLines(fromCity, fromText, toCity, toText);
  },

  onShareAppMessage() {
    const { fromCityName, toCityName } = this.data;
    return {
      title: `${fromCityName}到${toCityName}物流专线查询`,
      path: '/pages/index/index'
    };
  },

  loadLines(fromCity, fromText, toCity, toText) {
    wx.showLoading({ title: '查询中...' });

    wx.cloud.callFunction({
      name: 'searchLine',
      data: { fromCity, fromText, toCity, toText }
    }).then(res => {
      wx.hideLoading();
      const r = res.result || {};
      if (!r.ok) {
        // 失败不等于"没有线路"：置 loadError，页面展示错误态 + 重试按钮
        this.setData({
          lineList: [], transferList: [], rawDirect: [], rawTransfer: [],
          loading: false, loadError: true, errorMsg: r.error || '查询失败'
        });
        return;
      }
      // 直达结果服务端已按有效会员置顶排序；这里幂等排序兜底
      const directList = (r.directList || []).slice();
      directList.sort((a, b) => (b.isVip || 0) - (a.isVip || 0));
      this.setData({
        rawDirect: directList,
        rawTransfer: r.transferList || [],
        loading: false,
        loadError: false,
        errorMsg: ''
      });
      this.applyFilters();
    }).catch(() => {
      wx.hideLoading();
      this.setData({
        lineList: [], transferList: [], rawDirect: [], rawTransfer: [],
        loading: false, loadError: true,
        errorMsg: '网络连接失败，请检查网络后重试'
      });
    });
  },

  // 客户端筛选：不额外请求云函数，保证筛选即时响应、不产生查询成本
  applyFilters() {
    const { rawDirect, rawTransfer, filters } = this.data;

    const pass = item => {
      // 只看直达：列表页的直达区本身都是直达，"中转"标记项排除
      if (filters.direct && item.transfer) return false;
      if (filters.daily && !isDaily(item)) return false;
      if (filters.maxDays > 0) {
        const d = parseDays(item.aging);
        // 时效缺失（42.5% 填写率）不做排除，否则会把大半线路误杀
        if (d > 0 && d > filters.maxDays) return false;
      }
      return true;
    };

    const lineList = rawDirect.filter(pass);
    // 中转方案只有在"不筛选"或"筛天天发车"时才有意义；
    // 命中"只看直达"时整段隐藏（用户明确不要中转）
    const transferList = filters.direct
      ? []
      : rawTransfer.filter(t => {
        if (!filters.daily && filters.maxDays <= 0) return true;
        const a = t.firstLine || {}, b = t.secondLine || {};
        if (filters.daily && !(isDaily(a) && isDaily(b))) return false;
        if (filters.maxDays > 0) {
          const d = Math.max(parseDays(a.aging), parseDays(b.aging));
          if (d > 0 && d > filters.maxDays) return false;
        }
        return true;
      });

    this.setData({ lineList, transferList, filterActive: !!(filters.direct || filters.daily || filters.maxDays) });
  },

  // 列表页内调整筛选：点"只看直达"类 chip
  toggleDirect() {
    this.setData({ 'filters.direct': !this.data.filters.direct });
    this.applyFilters();
  },

  toggleDaily() {
    this.setData({ 'filters.daily': !this.data.filters.daily });
    this.applyFilters();
  },

  clearFilters() {
    this.setData({ filters: { direct: false, daily: false, maxDays: 0 } });
    this.applyFilters();
  },

  // 错误态上的"重新查询"
  onRetry() {
    const q = this._query;
    if (!q) return;
    this.setData({ loading: true, loadError: false });
    this.loadLines(q.fromCity, q.fromText, q.toCity, q.toText);
  },

  goToDetail(e) {
    const lineId = e.currentTarget.dataset.lineId;
    if (lineId) wx.navigateTo({ url: `/pages/line-detail/index?lineId=${lineId}` });
  },

  // 中转方案点击第一段
  goFirstDetail(e) {
    const lineId = e.currentTarget.dataset.lineId;
    if (lineId) wx.navigateTo({ url: `/pages/line-detail/index?lineId=${lineId}` });
  },

  // 中转方案点击第二段
  goSecondDetail(e) {
    const lineId = e.currentTarget.dataset.lineId;
    if (lineId) wx.navigateTo({ url: `/pages/line-detail/index?lineId=${lineId}` });
  }
});
