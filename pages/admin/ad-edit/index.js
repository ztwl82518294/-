// pages/admin/ad-edit/index.js
const db = wx.cloud.database();
const _ = db.command;
const ui = require('../../../utils/ui.js');
const lineKey = require('../../../utils/lineKey.js');

Page({
  data: {
    adId: 1,
    form: { companyName: '', region: '', number: '', lineId: 0 },
    // 跳转专线搜索选择器状态
    showLinePicker: false,
    searchKeyword: '',
    searchResults: [],
    selectedTitle: '',       // 已选专线的展示标题
    searching: false
  },

  onLoad(options) {
    this.adId = Number(options.adId || 1);
    this.setData({ adId: this.adId });
    this.loadAd();
  },

  loadAd() {
    wx.cloud.callFunction({ name: 'adminAd', data: { action: 'list' } }).then(res => {
      const list = (res.result && res.result.data) || [];
      const f = list.find(a => a.id === this.adId);
      if (!f) return;
      this.setData({
        form: {
          companyName: f.companyName || f.title || '',
          region: f.region || '',
          number: f.number || '',
          lineId: f.lineId || 0
        }
      });
      // 回显已关联专线的标题（兼容数字 id 与 _id 两种键）
      if (f.lineId) {
        const key = lineKey.parseLineKey(f.lineId);
        if (key) {
          db.collection('lines').where(lineKey.lineWhere(key)).limit(1).get().then(r => {
            if (r.data.length > 0) this.setData({ selectedTitle: r.data[0].title });
          }).catch(() => { /* 已删除/无权限时静默失败 */ });
        }
      }
    }).catch(() => {
      // 云函数调用失败（未部署/网络异常等）给管理员明确提示
      wx.showToast({ title: '广告位加载失败', icon: 'none' });
    });
  },

  onInput(e) { this.setData({ [`form.${e.currentTarget.dataset.field}`]: e.detail.value }); },

  // ===== 跳转专线：可搜索选择器（替代原生 picker，万股级可检索）=====
  openLinePicker() { this.setData({ showLinePicker: true, searchKeyword: '', searchResults: [] }); },
  closeLinePicker() { this.setData({ showLinePicker: false }); },

  onSearchInput(e) {
    const kw = (e.detail.value || '').trim();
    this.setData({ searchKeyword: kw });
    if (this._searchTimer) clearTimeout(this._searchTimer);
    if (!kw) { this.setData({ searchResults: [], searching: false }); return; }
    this.setData({ searching: true });
    // 300ms 防抖后服务端正则检索（标题 / 公司名 / 出发目的地，上限 20 条）
    this._searchTimer = setTimeout(() => {
      const reg = db.RegExp({ regexp: kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), options: 'i' });
      db.collection('lines').where(_.or([
        { title: reg }, { companyName: reg },
        { fromCityName: reg }, { toCityName: reg }
      ])).field({ title: true, companyName: true, fromCityName: true, toCityName: true, id: true })
        .limit(20).get().then(res => {
          // 仅在弹窗未关闭且关键词未变时回填，防止过期结果覆盖
          if (this.data.showLinePicker && this.data.searchKeyword === kw) {
            this.setData({ searchResults: res.data, searching: false });
          }
        }).catch(() => this.setData({ searching: false }));
    }, 300);
  },

  selectLine(e) {
    const line = this.data.searchResults[e.currentTarget.dataset.idx];
    if (!line) return;
    // 缺 id 的历史线路用主键兜底，否则关联后点击广告跳不动
    this.setData({ 'form.lineId': line.id || line._id, selectedTitle: line.title, showLinePicker: false });
  },

  clearLine() {
    this.setData({ 'form.lineId': 0, selectedTitle: '' });
  },

  save() {
    const f = this.data.form;
    if (!ui.lock(this, 'save')) return;
    wx.showLoading({ title: '保存中...' });
    wx.cloud.callFunction({
      name: 'adminAd',
      data: { action: 'save', data: { id: this.adId, companyName: f.companyName, region: f.region, number: f.number, lineId: f.lineId || 0 } }
    }).then((res) => {
      if (res.result && res.result.error) { wx.hideLoading(); ui.unlock(this, 'save'); return wx.showToast({ title: res.result.error, icon: 'none' }); }
      wx.hideLoading(); wx.showToast({ title: '保存成功' });
      setTimeout(() => wx.navigateBack(), 1000);
    }).catch(() => { wx.hideLoading(); ui.unlock(this, 'save'); wx.showToast({ title: '保存失败', icon: 'none' }); });
  }
});
