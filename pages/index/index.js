// pages/index/index.js
// 首页：只做"分流"——一句话搜索 + 两个业务入口，不做重查询。
// 查询类需求统一走 pages/line-query（查专线）与 pages/company-list（查公司）。
const db = wx.cloud.database();
const storage = require('../../utils/storage.js');
const ui = require('../../utils/ui.js');
const stats = require('../../utils/stats.js');

Page({
  data: {
    keyword: '',
    ads: [],
    notice: ''
  },

  onLoad() { this.loadAds(); this.loadNotice(); },

  onShareAppMessage() {
    return { title: '物流专线查询 - 找专线 · 找物流公司', path: '/pages/index/index' };
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

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  clearKeyword() {
    this.setData({ keyword: '' });
  },

  // 首页搜索框语义是"按公司名查线路"，统一进查公司页。
  // 注意：查公司是 tabBar 页，必须用 switchTab，且 tabBar 页不能带 URL 参数，
  // 所以关键词走全局变量交接（onShow 里消费一次后清空）。
  onSearch() {
    const kw = (this.data.keyword || '').trim();
    if (!kw) return wx.showToast({ title: '请输入城市或公司名', icon: 'none' });
    if (!ui.lock(this, 'search', false)) return;

    stats.logSearch(kw, 'company');
    const app = getApp();
    app.globalData.pendingCompanyKeyword = kw;
    wx.switchTab({
      url: '/pages/company-list/index',
      complete: () => ui.unlock(this, 'search')
    });
  },

  goLineQuery() {
    wx.switchTab({ url: '/pages/line-query/index' });
  },

  goCompanyList() {
    wx.switchTab({ url: '/pages/company-list/index' });
  },

  goAgreement(e) {
    const type = (e.currentTarget.dataset.type || 'privacy');
    wx.navigateTo({ url: `/pages/agreement/index?type=${type}` });
  }
});
