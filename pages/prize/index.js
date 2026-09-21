// pages/prize/index.js
// 用户端：查看我的月度名次与兑奖码

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function monthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  return y + '年' + m + '月';
}

Page({
  data: {
    loading: true,
    label: '',
    hasCode: false,
    claimed: false,
    shipped: false,
    manual: false,
    rank: 0,
    code: '',
    total: 0,
    totalUsers: 0,
    topN: 5
  },

  onLoad() { this.loadMyPrize(); },

  loadMyPrize() {
    wx.cloud.callFunction({ name: 'prize', data: { action: 'myPrize' } })
      .then(res => {
        const r = res.result || {};
        if (r.error) {
          this.setData({ loading: false });
          return wx.showToast({ title: r.error, icon: 'none' });
        }
        this.setData({
          loading: false,
          label: monthLabel(r.month || ''),
          hasCode: !!r.hasCode,
          claimed: !!r.claimed,
          shipped: !!r.shipped,
          manual: !!r.manual,
          rank: r.rank || 0,
          code: r.code || '',
          total: r.total || 0,
          totalUsers: r.totalUsers || 0,
          topN: r.topN || 5
        });
      })
      .catch(err => {
        console.error('【兑奖】云函数调用失败：', err);
        this.setData({ loading: false });
        wx.showModal({
          title: '加载失败',
          content: '请确认 prize 云函数已部署（右键 cloudfunctions/prize → 上传并部署）。',
          showCancel: false
        });
      });
  },

  // 跳转联系客服（WXML 中"联系客服兑奖"按钮绑定，缺失时点击无任何反应）
  goContact() {
    wx.navigateTo({ url: '/pages/contact/index' });
  },

  copyCode() {
    if (!this.data.code) return;
    wx.setClipboardData({
      data: this.data.code,
      success: () => wx.showToast({ title: '兑奖码已复制', icon: 'success' })
    });
  }
});
