// pages/admin/notice/index.js
const db = wx.cloud.database();
const ui = require('../../../utils/ui.js');

Page({
  data: { text: '' },

  onLoad() {
    // 用固定 _id 'current' 读取（与 adminNotice 云函数写入端一致）
    db.collection('notice').doc('current').get().then(res => {
      if (res.data) this.setData({ text: res.data.text || '' });
    }).catch(() => {});
  },

  onInput(e) { this.setData({ text: e.detail.value }); },

  save() {
    if (!ui.lock(this, 'save')) return;
    wx.showLoading({ title: '保存中...' });
    wx.cloud.callFunction({ name: 'adminNotice', data: { action: 'save', data: { text: this.data.text } } })
      .then((res) => {
        if (res.result && res.result.error) { wx.hideLoading(); ui.unlock(this, 'save'); return wx.showToast({ title: res.result.error, icon: 'none' }); }
        wx.hideLoading(); wx.showToast({ title: '保存成功' }); setTimeout(() => wx.navigateBack(), 1000);
      })
      .catch(() => { wx.hideLoading(); ui.unlock(this, 'save'); wx.showToast({ title: '保存失败', icon: 'none' }); });
  }
});