// pages/admin/ads/index.js
Page({
  data: {
    ads: [],
    loadError: false,
    soldCount: 0,
    emptyCount: 10,
    linkedCount: 0
  },
  onShow() { this.load(); },

  // 生成 10 个广告位骨架：loadError=true 时用占位名区分"加载失败"与"真空位"，
  // 否则管理员会把网络失败误判成"10 个位都空着"
  buildSlots(list, isError) {
    const ads = [];
    for (let i = 1; i <= 10; i++) {
      const f = list.find(a => a.id === i);
      // 兼容旧数据：优先 companyName，回退到旧的 title
      const name = f ? (f.companyName || f.title || '') : '';
      ads.push({
        id: i,
        name: isError ? '加载失败' : name,
        sold: !isError && !!name,
        region: f ? (f.region || '') : '',
        number: f ? (f.number || '') : '',
        lineId: f ? (f.lineId || 0) : 0
      });
    }
    return ads;
  },

  // 顶部总览：已售 / 空位 / 已关联专线。加载失败时不给出数字，避免误导
  summarize(ads, isError) {
    if (isError) return { soldCount: '—', emptyCount: '—', linkedCount: '—' };
    const sold = ads.filter(a => a.sold).length;
    return {
      soldCount: sold,
      emptyCount: ads.length - sold,
      linkedCount: ads.filter(a => a.sold && a.lineId).length
    };
  },

  load() {
    wx.showLoading({ title: '加载中...' });
    wx.cloud.callFunction({ name: 'adminAd', data: { action: 'list' } })
      .then(res => {
        wx.hideLoading();
        const r = res.result || {};
        if (r.error) {
          const ads = this.buildSlots([], true);
          this.setData(Object.assign({ ads, loadError: true }, this.summarize(ads, true)));
          return wx.showToast({ title: r.error, icon: 'none' });
        }
        const ads = this.buildSlots(r.data || [], false);
        this.setData(Object.assign({ ads, loadError: false }, this.summarize(ads, false)));
      })
      .catch(() => {
        wx.hideLoading();
        const ads = this.buildSlots([], true);
        this.setData(Object.assign({ ads, loadError: true }, this.summarize(ads, true)));
        wx.showToast({ title: '广告加载失败', icon: 'none' });
      });
  },

  edit(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/admin/ad-edit/index?adId=${id}` });
  }
});
