// pages/line-list/index.js
// 专线列表：搜索逻辑已整体迁入 searchLine 云函数（服务端聚合直达+中转），
// 本页只负责调接口、排序展示与跳转，不再循环 skip 拉全量。

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

Page({
  data: {
    fromCityName: '', toCityName: '',
    lineList: [], transferList: [],
    loading: true,
    loadError: false,    // 与"没查到"区分：true=请求失败，不是真的没有结果
    errorMsg: ''
  },

  // 保存查询参数，供"重新查询"复用
  _query: null,

  onLoad(options) {
    const fromText = safeDecode(options.fromText) || '未知';
    const toText = safeDecode(options.toText) || '未知';
    const fromCity = safeDecode(options.fromCity);
    const toCity = safeDecode(options.toCity);
    this._query = { fromCity, fromText, toCity, toText };
    this.setData({ fromCityName: fromText, toCityName: toText, loading: true, loadError: false });
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
        this.setData({ lineList: [], transferList: [], loading: false, loadError: true, errorMsg: r.error || '查询失败' });
        return;
      }
      // 直达结果服务端已按有效会员置顶排序；这里幂等排序兜底
      const directList = r.directList || [];
      directList.sort((a, b) => (b.isVip || 0) - (a.isVip || 0));
      this.setData({
        lineList: directList,
        transferList: r.transferList || [],
        loading: false,
        loadError: false,
        errorMsg: ''
      });
    }).catch(() => {
      wx.hideLoading();
      this.setData({
        lineList: [], transferList: [], loading: false, loadError: true,
        errorMsg: '网络连接失败，请检查网络后重试'
      });
    });
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
