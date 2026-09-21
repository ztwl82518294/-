// pages/admin/index.js
const db = wx.cloud.database();

Page({
  data: { lineCount: 0 },


  onShow() { this.loadStats(); },

  loadStats() {
    // 统计失败不能静默：否则管理员看到 0 条会误以为库是空的
    db.collection('lines').count()
      .then(res => this.setData({ lineCount: res.total, countError: false }))
      .catch(err => {
        console.error('统计专线数量失败', err);
        this.setData({ countError: true });
        wx.showToast({ title: '统计加载失败', icon: 'none' });
      });
  },

  goToLines() { wx.navigateTo({ url: '/pages/admin/lines/index' }); },
  goToAds() { wx.navigateTo({ url: '/pages/admin/ads/index' }); },
  goToNotice() { wx.navigateTo({ url: '/pages/admin/notice/index' }); },
  goToStats() { wx.navigateTo({ url: '/pages/admin/stats/index' }); },
  goToPrize() { wx.navigateTo({ url: '/pages/admin/prize/index' }); }
});