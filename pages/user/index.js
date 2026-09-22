// pages/user/index.js
// 我的页面：展示历史，并识别管理员

const storage = require('../../utils/storage.js');
const { ADMIN_OPENIDS } = require('../../config/admin.js');

Page({
  data: {
    historyList: [],
    isAdmin: false,   // 是否是管理员
    openId: ''        // 当前用户 openid
  },

  // 页面每次显示时执行
  onShow() {
    // 查询历史（本地缓存，同步读取）
    this.setData({ historyList: storage.getSearchHistory() });

    // 识别是否管理员
    this.checkAdmin();
  },

  // 调用云函数获取 openid，判断是否管理员
  checkAdmin() {
    wx.cloud.callFunction({ name: 'getOpenid' })
      .then(res => {
        const openid = res.result.openid;
        // 打印你的 openid，方便复制

        this.setData({
          openId: openid,
          // 如果 openid 在白名单里，就是管理员
          isAdmin: ADMIN_OPENIDS.includes(openid)
        });
      })
      .catch(err => {
        console.error('获取 openid 失败', err);
      });
  },

  // 进入管理后台
  goToAdmin() {
    wx.navigateTo({ url: '/pages/admin/index' });
  },

  // 清空查询历史
  clearHistory() {
    wx.showModal({
      title: '提示',
      content: '确定要清空所有查询历史吗？',
      success: res => {
        if (res.confirm) {
          storage.clearSearchHistory();
          this.setData({ historyList: [] });
        }
      }
    });
  },

  // 点击历史记录重新查询
  reQuery(event) {
    const item = event.currentTarget.dataset.item;
    // 与 line-list 的 onLoad 参数名对齐（fromText/toText），并对中文做 URL 编码
    const q = encodeURIComponent;
    wx.navigateTo({
      url: `/pages/line-list/index?fromCity=&fromText=${q(item.fromCityName || '')}&toCity=&toText=${q(item.toCityName || '')}`
    });
  },

  // 收藏页已从 tabBar 移出（tabBar 让位给 首页/查专线/查公司），改为普通页面跳转
  goToFavorite() {
    wx.navigateTo({ url: '/pages/favorite/index' });
  },

  goContact() {
    wx.navigateTo({ url: '/pages/contact/index' });
  },

  // 信息纠错：不带 kind/key/name 进入 → 表单的"你要反馈的信息"提示条整块隐藏。
  // 用于用户不在具体线路/公司页、却想反馈问题时（如"某某公司已停业"）。
  goReport() {
    wx.navigateTo({ url: '/pages/report/index' });
  },

  // 查看用户服务协议 / 隐私政策
  goAgreement(event) {
    wx.navigateTo({ url: `/pages/agreement/index?type=${event.currentTarget.dataset.type}` });
  }
});