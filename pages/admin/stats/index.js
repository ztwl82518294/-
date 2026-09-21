// pages/admin/stats/index.js
// 月度访问用户统计排名（仅管理员，数据由 adminStats 云函数校验后返回）

const ui = require('../../../utils/ui.js');

function pad(n) { return n < 10 ? '0' + n : '' + n; }

// 当前自然月 yyyy-MM（统一按东八区，与埋点/云函数口径一致）
function currentMonth() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1);
}

// 月份字符串加减
function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1);
}

// yyyy-MM → "2026年9月"
function monthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  return y + '年' + m + '月';
}

// openid 脱敏：前6 + **** + 后4
function maskOpenid(openid) {
  if (!openid) return '未知用户';
  if (openid.length <= 12) return openid;
  return openid.slice(0, 6) + '****' + openid.slice(-4);
}

// 时间戳 → "MM-dd HH:mm"
function fmtTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

Page({
  data: {
    month: '',
    label: '',
    isCurrent: true,   // 是否当月（当月不允许再往后翻）
    totals: { users: 0, usersCapped: false, search: 0, view: 0 },
    usersText: '0',    // 活跃用户展示值：达上限时显示 "1000+"
    users: [],
    loading: true
  },

  onLoad() {
    const month = currentMonth();
    this.setData({ month, label: monthLabel(month), isCurrent: true });
    this.loadStats();
  },

  prevMonth() {
    const month = shiftMonth(this.data.month, -1);
    this.setData({ month, label: monthLabel(month), isCurrent: false });
    this.loadStats();
  },

  nextMonth() {
    if (this.data.isCurrent) return;
    const month = shiftMonth(this.data.month, 1);
    const cur = currentMonth();
    this.setData({ month, label: monthLabel(month), isCurrent: month >= cur });
    this.loadStats();
  },

  loadStats() {
    this.setData({ loading: true });
    wx.cloud.callFunction({
      name: 'adminStats',
      data: { month: this.data.month }
    }).then(res => {
      const r = res.result || {};
      if (r.error) {
        this.setData({ loading: false });
        return wx.showToast({ title: r.error, icon: 'none' });
      }
      const users = (r.users || []).map(u => ({
        ...u,
        openidMask: maskOpenid(u.openid),
        lastTime: fmtTime(u.lastTs)
      }));
      // usersCapped = 活跃用户数达到聚合上限（1000），展示为 "1000+" 而非错误的精确值
      const totals = r.totals || { users: 0, usersCapped: false, search: 0, view: 0 };
      this.setData({
        totals,
        usersText: totals.usersCapped ? totals.users + '+' : String(totals.users || 0),
        users,
        loading: false
      });
    }).catch(err => {
      // 最常见原因：adminStats 云函数尚未部署（函数不存在时 callFunction 会 reject）
      console.error('【月度统计】云函数调用失败：', err);
      this.setData({ loading: false });
      wx.showModal({
        title: '统计加载失败',
        content: '请先在开发者工具中右键 cloudfunctions/adminStats 文件夹，选择“上传并部署：云端安装依赖”，部署完成后重试。',
        showCancel: false,
        confirmText: '我知道了'
      });
    });
  },

  // 快捷发奖：给该用户（按当前统计月份）手动发放兑奖码
  assignPrize(e) {
    const openid = e.currentTarget.dataset.openid;
    if (!openid) return;
    wx.showModal({
      title: '指定该用户中奖？',
      content: `将为该用户发放${this.data.label}的兑奖码（与排名无关，标记为特批）`,
      confirmText: '发码',
      success: (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '发放中...' });
        wx.cloud.callFunction({
          name: 'prize',
          data: { action: 'assign', openid, month: this.data.month }
        }).then(r => {
          wx.hideLoading();
          const result = r.result || {};
          if (result.error) return wx.showModal({ title: '发放失败', content: result.error, showCancel: false });
          wx.showModal({ title: '发放成功', content: '兑奖码：' + result.code, showCancel: false });
        }).catch(err => {
          wx.hideLoading();
          console.error('指定中奖失败：', err);
          // 原文案 17 字，toast 会被截断；ui.error 自动降级为 modal
          ui.error('发放失败，请确认 prize 云函数已部署');
        });
      }
    });
  }
});
