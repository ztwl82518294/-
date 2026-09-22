// pages/company-detail/index.js
// 公司详情页：展示一家物流公司的发站/到站信息、覆盖线路（按出发城市分组）。
//
// 数据来源：searchCompany 云函数 action:'detail'。
// 线路跳转一律走 utils/lineKey.lineRef 口径（_id 优先），
// 与 searchLine 返回项的 ref 字段保持一致，避免"点进去查不到"。

const ui = require('../../utils/ui.js');

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
    company: null,
    loadError: false,
    errorMsg: ''
  },

  _name: '',

  onLoad(options) {
    const name = safeDecode(options.name);
    if (!name) {
      this.setData({ loadError: true, errorMsg: '缺少公司名称' });
      return;
    }
    this._name = name;
    wx.setNavigationBarTitle({ title: name });
    this.loadCompany(name);
  },

  onShareAppMessage() {
    const c = this.data.company;
    if (!c) return { title: '物流专线查询 - 查物流公司', path: '/pages/company-list/index' };
    return {
      title: `${c.companyName} - 物流专线查询`,
      path: `/pages/company-detail/index?name=${encodeURIComponent(c.companyName)}`
    };
  },

  loadCompany(name) {
    wx.showLoading({ title: '加载中...' });
    wx.cloud.callFunction({
      name: 'searchCompany',
      data: { action: 'detail', name }
    }).then(res => {
      wx.hideLoading();
      const r = res.result || {};
      if (!r.ok || !r.company) {
        this.setData({ loadError: true, company: null, errorMsg: r.error || '该公司的线路信息暂不可用' });
        return;
      }
      // 给每个站点补 index，供 wx:key 使用（云函数返回的数组可能含重复地址键）
      const c = r.company;
      // 一个站点可能挂多个号码（云函数用"、"分隔存进 phone）。
      // 拆成 phones 数组后前端可逐号渲染、点击直拨，与专线详情同交互
      //（原实现把多个号码塞进一个胶囊，点击还要再选一次，多点一步）。
      const withPhones = s => Object.assign({}, s, {
        phones: String(s.phone || '').split(/[、,，;；/\s]+/).filter(Boolean)
      });
      c.fromStations = (c.fromStations || []).map((s, i) =>
        Object.assign(withPhones(s), { idx: 'f' + i }));
      c.toStations = (c.toStations || []).map((s, i) =>
        Object.assign(withPhones(s), { idx: 't' + i }));
      // 计数口径：只算"有地址的站"，纯电话站不计入——否则会把 1 个地址 + 3 个电话
      // 显示成"共 4 个"，与实际地址数不符（v6.2 与专线详情统一口径）
      c.fromAddrCount = c.fromStations.filter(s => !!s.addr).length;
      c.toAddrCount = c.toStations.filter(s => !!s.addr).length;
      this.setData({ company: c, loadError: false, errorMsg: '' });
    }).catch(() => {
      wx.hideLoading();
      this.setData({ loadError: true, company: null, errorMsg: '网络连接失败，请检查网络后重试' });
    });
  },

  retryLoad() {
    if (this._name) {
      this.setData({ loadError: false, errorMsg: '' });
      this.loadCompany(this._name);
    } else {
      this.goBack();
    }
  },

  // 点线路行进专线详情（ref = _id 优先，与 searchLine 口径一致）
  goLine(e) {
    const ref = e.currentTarget.dataset.ref;
    if (!ref) return;
    if (!ui.lock(this, 'line', false)) return;
    wx.navigateTo({
      url: `/pages/line-detail/index?lineId=${ref}`,
      complete: () => ui.unlock(this, 'line')
    });
  },

  // 点击单个号码直接拨打（与专线详情同交互：号码胶囊本身就是可点直拨的）
  // 【v6.2】原 onCall（把多个号码塞进一个胶囊、点击后再弹 ActionSheet 选号）已删除：
  // 现在每个号码各自渲染成一个胶囊，一次点击直达拨号，少一步。从 onLoad 的
  // withPhones() 把 phone 拆成 phones 数组后就再无引用，留着是孤儿函数。
  onCallOne(e) {
    const phone = String((e.currentTarget.dataset || {}).phone || '').trim();
    if (!phone) return;
    wx.makePhoneCall({ phoneNumber: phone, fail: () => {} });
  },

  // 纠错：跳转到站内反馈表单（pages/report）。
  // 【v6.4 改】原实现"弹框 → ActionSheet 二选一（打电话/复制微信）"摩擦太大，
  // 用户要跳出小程序才能反馈，实际转化极低。现统一走站内表单，
  // 与专线详情页同一条链路（表单按 kind 区分被反馈对象的类型）。
  onReport() {
    const c = this.data.company;
    const name = c ? c.companyName : this._name;
    if (!name) return wx.showToast({ title: '缺少公司信息', icon: 'none' });
    wx.navigateTo({
      url: `/pages/report/index?kind=company&key=${encodeURIComponent(name)}&name=${encodeURIComponent(name)}`
    });
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/company-list/index' }) });
  }
});
