// pages/admin/prize/index.js
// 管理员：生成月度兑奖码、查看名单、输入码核销

const ui = require('../../../utils/ui.js');

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function currentMonth() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1);
}
function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1);
}
function monthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  return y + '年' + m + '月';
}
function maskOpenid(openid) {
  if (!openid) return '未知用户';
  if (openid.length <= 12) return openid;
  return openid.slice(0, 6) + '****' + openid.slice(-4);
}
function fmtTime(ts) {
  const d = new Date(ts + 8 * 3600 * 1000);
  return pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
}
// 日志操作类型 → 标签/配色
const OP_META = {
  assign:   { tag: '指定中奖', cls: 'log-assign' },
  generate: { tag: '批量生成', cls: 'log-gen' },
  verify:   { tag: '核销',     cls: 'log-verify' },
  ship:     { tag: '发放',     cls: 'log-ship' },
  unship:   { tag: '撤销发放', cls: 'log-plain' },
  unclaim:  { tag: '撤销核销', cls: 'log-plain' },
  remove:   { tag: '作废',     cls: 'log-remove' }
};

Page({
  data: {
    month: '',
    label: '',
    isCurrent: false,
    list: [],
    logs: [],
    showLogs: false,
    loading: false,
    verifyCode: ''
  },

  onLoad() {
    // 默认展示上月（结算月）
    const month = shiftMonth(currentMonth(), -1);
    this.setData({ month, label: monthLabel(month), isCurrent: false });
    this.loadList();
  },

  prevMonth() {
    const month = shiftMonth(this.data.month, -1);
    this.setData({ month, label: monthLabel(month) });
    this.loadList();
  },
  nextMonth() {
    const cur = currentMonth();
    if (this.data.month >= cur) return;
    const month = shiftMonth(this.data.month, 1);
    this.setData({ month, label: monthLabel(month), isCurrent: month >= cur });
    this.loadList();
  },

  onCodeInput(e) { this.setData({ verifyCode: e.detail.value }); },

  call(action, data) {
    return wx.cloud.callFunction({ name: 'prize', data: Object.assign({ action }, data || {}) });
  },

  // 生成兑奖码
  generate() {
    wx.showModal({
      title: '生成兑奖码',
      content: `将为${this.data.label}活跃榜前 5 名生成兑奖码（已生成的不会重复），确认？`,
      success: (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '生成中...' });
        this.call('generate', { month: this.data.month }).then(r => {
          wx.hideLoading();
          const result = r.result || {};
          if (result.error) return wx.showToast({ title: result.error, icon: 'none' });
          wx.showToast({ title: `已生成 ${result.count} 个`, icon: 'success' });
          this.loadList();
        }).catch(err => {
          wx.hideLoading();
          console.error('生成兑奖码失败：', err);
          // 走 ui.error：文案超 14 字，toast 会被截断成"..."，自动降级为 modal
          ui.error('生成失败，请确认 prize 云函数已部署');
        });
      }
    });
  },

  // 名单
  loadList() {
    this.setData({ loading: true });
    this.call('list', { month: this.data.month }).then(r => {
      const result = r.result || {};
      if (result.error) { this.setData({ loading: false, list: [] }); return; }
      const list = (result.list || []).map(it => ({ ...it, openidMask: maskOpenid(it.openid) }));
      this.setData({ list, loading: false });
    }).catch(() => this.setData({ loading: false, list: [] }));
    this.loadLogs();
  },

  // 操作日志（按当前月份）
  loadLogs() {
    this.call('logs', { month: this.data.month }).then(r => {
      const result = r.result || {};
      if (result.error) return;
      const logs = (result.list || []).map(it => ({
        ...it,
        timeText: fmtTime(it.ts),
        meta: OP_META[it.op] || { tag: it.op || '操作', cls: 'log-plain' }
      }));
      this.setData({ logs });
    }).catch(() => {});
  },

  toggleLogs() {
    this.setData({ showLogs: !this.data.showLogs });
  },

  // 核销
  verify() {
    const code = (this.data.verifyCode || '').trim();
    if (!code) return wx.showToast({ title: '请输入兑奖码', icon: 'none' });
    // 连点会把同一条码核销两次
    if (!ui.lock(this, 'verify')) return;
    this.call('verify', { code }).then(r => {
      ui.unlock(this, 'verify');
      const result = r.result || {};
      if (result.error) return wx.showModal({ title: '核销失败', content: result.error, showCancel: false });
      const rec = result.record || {};
      wx.showModal({
        title: result.alreadyClaimed ? '该码已核销过' : '核销成功',
        content: `${monthLabel(rec.month)}榜单第 ${rec.rank} 名\n兑奖码：${rec.code}`,
        showCancel: false
      });
      this.setData({ verifyCode: '' });
      this.loadList();
    }).catch(err => {
      ui.unlock(this, 'verify');
      console.error('核销失败：', err);
      ui.error('核销失败，请确认 prize 云函数已部署');
    });
  },

  copyCode(e) {
    wx.setClipboardData({
      data: e.currentTarget.dataset.code,
      success: () => wx.showToast({ title: '已复制', icon: 'success' })
    });
  },

  // 手动指定用户中奖：输入完整 openid 发码（与榜单无关，标记为特批）
  assignManual() {
    wx.showModal({
      title: '指定用户中奖',
      editable: true,
      placeholderText: '粘贴用户完整 openid',
      confirmText: '发码',
      success: (res) => {
        if (!res.confirm) return;
        const openid = (res.content || '').trim();
        if (!openid) return wx.showToast({ title: '请输入 openid', icon: 'none' });
        wx.showLoading({ title: '发放中...' });
        this.call('assign', { openid, month: this.data.month }).then(r => {
          wx.hideLoading();
          const result = r.result || {};
          if (result.error) return wx.showModal({ title: '发放失败', content: result.error, showCancel: false });
          wx.showModal({
            title: '发放成功',
            content: `兑奖码：${result.code}\n该用户进入「我的-排行榜兑奖」即可查看`,
            showCancel: false
          });
          this.loadList();
        }).catch(err => {
          wx.hideLoading();
          console.error('指定中奖失败：', err);
          ui.error('发放失败，请确认 prize 云函数已部署');
        });
      }
    });
  },

  // 名单项统一操作入口（op: claim 核销 / ship 标记发放 / unship 撤销发放 / unclaim 撤销核销 / remove 作废）
  onItemAction(e) {
    const { op, id } = e.currentTarget.dataset;
    const item = this.data.list.find(it => it._id === id);
    if (!item) return;
    const conf = {
      claim: { title: '确认核销？', content: `兑奖码 ${item.code}（第${item.rank}名）核销后用户将看到"奖品发放中"` },
      ship: { title: '确认已发放？', content: `第${item.rank}名（${item.code}）的礼品将标记为已发放` },
      unship: { title: '撤销发放？', content: `第${item.rank}名将回退为"已核销、待发放"` },
      unclaim: { title: '撤销核销？', content: `第${item.rank}名将回退为"未核销"，可重新核销` },
      remove: { title: '作废该兑奖码？', content: `第${item.rank}名的兑奖码 ${item.code} 将被删除，该用户不再显示中奖` }
    }[op];
    wx.showModal({
      title: conf.title,
      content: conf.content,
      confirmColor: op === 'remove' ? '#dc2626' : '#2563eb',
      success: (res) => {
        if (!res.confirm) return;
        const action = op === 'claim' ? 'verify' : (op === 'remove' ? 'remove' : 'update');
        const data = op === 'claim' ? { code: item.code } : (op === 'remove' ? { id } : { id, op });
        wx.showLoading({ title: '处理中...' });
        this.call(action, data).then(r => {
          wx.hideLoading();
          const result = r.result || {};
          if (result.error) return wx.showToast({ title: result.error, icon: 'none' });
          wx.showToast({ title: '操作成功', icon: 'success' });
          this.loadList();
        }).catch(err => {
          wx.hideLoading();
          console.error('中奖管理操作失败：', err);
          wx.showToast({ title: '操作失败', icon: 'none' });
        });
      }
    });
  }
});
