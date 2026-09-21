// pages/index/index.js
const db = wx.cloud.database();
const storage = require('../../utils/storage.js');
const ui = require('../../utils/ui.js');

Page({
  data: {
    fromText: '', toText: '',
    fromCity: '', toCity: '',
    ads: [], notice: ''
  },

  onLoad() { this.loadAds(); this.loadNotice(); },

  onShareAppMessage() {
    return { title: '物流专线查询 - 快速找到合适的物流专线', path: '/pages/index/index' };
  },

  loadNotice() {
    // 公告用固定 _id（与 adminNotice 云函数写入端一致），避免 limit(1) 无序匹配历史脏 doc
    db.collection('notice').doc('current').get()
      .then(res => { if (res.data) this.setData({ notice: res.data.text || '' }); })
      .catch(() => {});
  },

  onNoticeTap() {
    if (this.data.notice) wx.showModal({ title: '公告', content: this.data.notice, showCancel: false });
  },

  loadAds() {
    const build = (found, i) => {
      if (found) {
        // 兼容旧数据：无 companyName 时回退到旧的 title
        const companyName = found.companyName || found.title || '';
        return {
          id: i,
          companyName,
          region: found.region || '',
          number: found.number || '',
          lineId: found.lineId || 0,
          initial: companyName ? companyName.charAt(0) : '广',
          colorIdx: ((i - 1) % 8) + 1,
          empty: !companyName
        };
      }
      return { id: i, companyName: '', region: '', number: '', lineId: 0, initial: '招', colorIdx: ((i - 1) % 8) + 1, empty: true };
    };
    db.collection('ads').orderBy('id', 'asc').get()
      .then(res => {
        const list = res.data; const ads = [];
        // 合规：只展示已售出的广告位，空位一律不渲染
        // （平台《常见拒绝情形》3.2.2：页面内含空白广告位、招商广告将被拒绝）
        for (let i = 1; i <= 10; i++) {
          const item = build(list.find(a => a.id === i), i);
          if (!item.empty) ads.push(item);
        }
        this.setData({ ads });
      })
      .catch(() => {
        // 加载失败时同样不展示空广告位
        this.setData({ ads: [] });
      });
  },

  onAdTap(e) {
    const ad = e.currentTarget.dataset.ad;
    // 空广告位已不渲染，有链接直接跳详情，无链接仅提示
    if (ad && ad.lineId) wx.navigateTo({ url: `/pages/line-detail/index?lineId=${ad.lineId}` });
  },

  onFromInput(e) { this.setData({ fromText: e.detail.value, fromCity: '' }); },
  onToInput(e) { this.setData({ toText: e.detail.value, toCity: '' }); },

  onFromChange(e) {
    const r = e.detail.value;
    this.setData({ fromCity: r[1], fromText: r[2] });
  },
  onToChange(e) {
    const r = e.detail.value;
    this.setData({ toCity: r[1], toText: r[2] });
  },

  swapCity() {
    const { fromText, toText, fromCity, toCity } = this.data;
    this.setData({ fromText: toText, toText: fromText, fromCity: toCity, toCity: fromCity });
  },

  onQuery() {
    const { fromText, toText, fromCity, toCity } = this.data;
    if (!fromText) return wx.showToast({ title: '请填写出发地', icon: 'none' });
    if (!toText) return wx.showToast({ title: '请填写目的地', icon: 'none' });

    // 连点会 navigateTo 两次、打开两个列表页；跳转类操作静默忽略（tip=false）
    if (!ui.lock(this, 'query', false)) return;

    storage.addSearchHistory({ fromCityId: 0, toCityId: 0, fromCityName: fromText, toCityName: toText });

    const q = encodeURIComponent;
    wx.navigateTo({
      url: `/pages/line-list/index?fromCity=${q(fromCity)}&fromText=${q(fromText)}&toCity=${q(toCity)}&toText=${q(toText)}`,
      complete: () => ui.unlock(this, 'query')
    });
  }
});