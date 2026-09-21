// pages/admin/ads/index.js
Page({
  data: { ads: [], loadError: false },
  onShow() { this.load(); },

  // 生成 10 个广告位骨架：loadError=true 时用占位名区分"加载失败"与"真空位"，
  // 否则管理员会把网络失败误判成"10 个位都空着"
  buildSlots(list, isError) {
    const ads = [];
    for (let i = 1; i <= 10; i++) {
      const f = list.find(a => a.id === i);
      // 兼容旧数据：优先 companyName，回退到旧的 title
      ads.push({ id: i, name: f ? (f.companyName || f.title || '') : (isError ? '加载失败' : '') });
    }
    return ads;
  },

  load() {
    wx.showLoading({ title: '加载中...' });
    wx.cloud.callFunction({ name: 'adminAd', data: { action: 'list' } })
      .then(res => {
        wx.hideLoading();
        const r = res.result || {};
        if (r.error) {
          this.setData({ ads: this.buildSlots([], true), loadError: true });
          return wx.showToast({ title: r.error, icon: 'none' });
        }
        this.setData({ ads: this.buildSlots(r.data || [], false), loadError: false });
      })
      .catch(() => {
        wx.hideLoading();
        this.setData({ ads: this.buildSlots([], true), loadError: true });
        wx.showToast({ title: '广告加载失败', icon: 'none' });
      });
  },

  edit(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/admin/ad-edit/index?adId=${id}` });
  }
});