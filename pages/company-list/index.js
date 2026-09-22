// pages/company-list/index.js
// 「查公司」tab 页：按公司名搜索，返回公司卡片列表。
//
// 数据来源：searchCompany 云函数（服务端按 companyName 聚合 lines）。
// 之所以不建独立 companies 集合：平台数据只有 lines，公司维度的所有字段
// （认证、VIP、覆盖城市）都可由线上线路实时算出，避免双份数据不一致。

const ui = require('../../utils/ui.js');
const stats = require('../../utils/stats.js');

// 安全解码 URL 参数（首页搜索框可能带 keyword 进来）
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
    keyword: '',
    companyList: [],
    total: 0,
    loading: false,
    searched: false,
    loadError: false,
    errorMsg: ''
  },

  onLoad(options) {
    // 从首页搜索框带上关键词时，进来就直接搜
    const kw = safeDecode(options.keyword);
    if (kw) {
      this.setData({ keyword: kw });
      this.search(kw);
    }
  },

  // 首页搜索框走 switchTab 进来时无法带参数，改用 globalData 交接。
  // 读取后立刻清空，避免用户下次切回本 tab 时又莫名触发一次搜索。
  onShow() {
    const app = getApp();
    const pending = app.globalData && app.globalData.pendingCompanyKeyword;
    if (!pending) return;
    app.globalData.pendingCompanyKeyword = '';
    this.setData({ keyword: pending });
    this.search(pending);
  },

  onShareAppMessage() {
    return { title: '物流专线查询 - 查物流公司', path: '/pages/company-list/index' };
  },

  onInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  clearKeyword() {
    // 清空输入同时回到引导态，避免残留上一次结果造成误解
    this.setData({ keyword: '', companyList: [], total: 0, searched: false, loadError: false });
  },

  onSearch() {
    const kw = (this.data.keyword || '').trim();
    if (!kw) return wx.showToast({ title: '请输入公司名', icon: 'none' });
    this.search(kw);
  },

  search(kw) {
    if (!ui.lock(this, 'search', false)) return;
    this.setData({ loading: true, loadError: false, searched: true });
    stats.logSearch(kw, 'company');

    // 用 complete 统一解锁，避免两处 finally 遗漏导致按钮永久锁死
    wx.cloud.callFunction({
      name: 'searchCompany',
      data: { action: 'search', keyword: kw }
    }).then(res => {
      const r = res.result || {};
      if (!r.ok) {
        this.setData({
          loading: false, loadError: true, companyList: [], total: 0,
          errorMsg: r.error || '查询失败'
        });
        return;
      }
      this.setData({
        loading: false,
        loadError: false,
        companyList: r.companies || [],
        total: r.total || 0,
        errorMsg: ''
      });
    }).catch(() => {
      this.setData({
        loading: false, loadError: true, companyList: [], total: 0,
        errorMsg: '网络连接失败，请检查网络后重试'
      });
    }).then(() => {
      ui.unlock(this, 'search');
    });
  },

  onRetry() {
    const kw = (this.data.keyword || '').trim();
    if (kw) this.search(kw);
  },

  goToDetail(e) {
    const name = e.currentTarget.dataset.name;
    if (!name) return;
    if (!ui.lock(this, 'detail', false)) return;
    wx.navigateTo({
      url: `/pages/company-detail/index?name=${encodeURIComponent(name)}`,
      complete: () => ui.unlock(this, 'detail')
    });
  },

  // 「我的」入口：收藏 / 查询历史 / 客服 / 协议都收在这里
  goMine() {
    wx.navigateTo({ url: '/pages/user/index' });
  }
});
