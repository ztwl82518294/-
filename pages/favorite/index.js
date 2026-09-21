// pages/favorite/index.js
const storage = require('../../utils/storage.js');

Page({
  data: {
    favoriteList: [],
    loadError: false    // true=读取失败，与"暂无收藏"区分，避免丢过收藏的用户以为收藏没了
  },

  onShow() {
    this.loadFavorites();
  },

  loadFavorites() {
    // getFavorites 内部吞错返回 []，用 failed 标记区分"空"与"失败"
    let failed = false;
    storage.getFavorites(() => { failed = true; }).then(list => {
      this.setData({ favoriteList: list, loadError: failed });
    });
  },

  goToDetail(event) {
    const lineId = event.currentTarget.dataset.lineId;
    wx.navigateTo({ url: `/pages/line-detail/index?lineId=${lineId}` });
  },

  cancelFavorite(event) {
    const lineId = event.currentTarget.dataset.lineId;
    wx.showModal({
      title: '提示',
      content: '确定要取消收藏该专线吗？',
      success: res => {
        if (res.confirm) {
          storage.removeFavorite(lineId).then(() => {
            this.loadFavorites();
            wx.showToast({ title: '已取消', icon: 'none' });
          }).catch(() => wx.showToast({ title: '操作失败', icon: 'none' }));
        }
      }
    });
  }
});