// pages/admin/line-edit/index.js
const db = wx.cloud.database();
const vip = require('../../../utils/vip.js');
const ui = require('../../../utils/ui.js');
const outlets = require('../../../utils/outlets.js');
const lineKey = require('../../../utils/lineKey.js');

const DAY = 86400000;

Page({
  data: {
    isEdit: false,
    form: {
      title:'', companyName:'', fromCityName:'', toCityName:'',
      fromAddress:'', toAddress:'', toAreas:'',
      latitude:0, longitude:0, toLatitude:0, toLongitude:0,
      aging:'', priceDesc:'', lineType:'直达',
      fromPhone:'', toPhone:'', tags:'',
      vipExpireAt:0, certified:0, status:1
    },
    // VIP 展示态（由 form.vipExpireAt 派生，wxml 直接绑定）
    vipText: '未开通',
    vipOn: false,
    // 级联选择器状态
    fromRegion: [], toRegion: [],
    // 发货定位显示名（选点结果，便于管理员核对）
    locName: '',
    // 到货定位显示名
    toLocName: '',
    // 线路类型选择器
    lineTypeOptions: ['直达', '中转'],
    lineTypeIndex: 0
  },

  onLoad(options) {
    // 兼容 _id（新链路/老数据）与数字 id（旧链接）两种键
    const key = options.lineId ? lineKey.parseLineKey(options.lineId) : null;
    if (key) {
      this._lineKey = key;
      this.setData({ isEdit: true });
      wx.setNavigationBarTitle({ title: '编辑专线' });
      this.loadLine();
    } else {
      if (options.lineId) wx.showToast({ title: '线路标识不合法', icon: 'none' });
      wx.setNavigationBarTitle({ title: '新增专线' });
      this.refreshVipView();
    }
  },

  loadLine() {
    db.collection('lines').where(lineKey.lineWhere(this._lineKey)).get().then(res => {
      if (res.data.length > 0) {
        const l = res.data[0];
        // 【修复】旧版导入/控制台直灌的数据网点存成字符串、地址电话老字段为空，
        // 直接回显表单会让管理员误以为没填；保存时还会用空值把网点数据冲掉。
        // 加载时先按网点反填老字段（口径同服务端 deriveOutlets），表单回显真实数据。
        outlets.deriveLegacy(l, 'from');
        outlets.deriveLegacy(l, 'to');
        const lineTypeOptions = this.buildLineTypeOptions(l.lineType);
        this.setData({
          form: {
            _id: l._id, id: l.id,
            title: l.title, companyName: l.companyName,
            fromCityName: l.fromCityName, toCityName: l.toCityName,
            fromAddress: l.fromAddress || '', toAddress: l.toAddress || '',
            toAreas: this.arrToStr(l.toAreas),
            latitude: l.latitude || 0, longitude: l.longitude || 0,
            toLatitude: l.toLatitude || 0, toLongitude: l.toLongitude || 0,
            aging: l.aging, priceDesc: l.priceDesc, lineType: l.lineType,
            // 发站/到站电话分列；老数据只有统一 phone 时回填两处，保存后写回新字段
            fromPhone: l.fromPhone || l.phone || '',
            toPhone: l.toPhone || l.phone || '',
            tags: this.arrToStr(l.tags),
            // VIP 用到期时间管理，替代旧的 isVip 裸开关
            vipExpireAt: Number(l.vipExpireAt) || 0,
            certified: l.certified === 1 ? 1 : 0,
            status: l.status === 0 ? 0 : 1
          },
          locName: l.fromAddress ? String(l.fromAddress).slice(0, 15) : '',
          toLocName: (l.toLatitude && l.toAddress) ? String(l.toAddress).slice(0, 15) : '',
          lineTypeOptions,
          lineTypeIndex: Math.max(0, lineTypeOptions.indexOf(l.lineType || '直达'))
        });
        this.refreshVipView();
      } else {
        // 找不到记录：给管理员明确提示，避免停留在空表单上误以为正常
        wx.showToast({ title: '未找到该专线，可能已删除', icon: 'none' });
      }
    }).catch(err => {
      // 网络/数据库异常：兜底提示，避免页面停留在"新增专线"状态
      console.error('加载专线失败：', err);
      wx.showToast({ title: '加载失败，请重试', icon: 'none' });
    });
  },

  onInput(e) { this.setData({ [`form.${e.currentTarget.dataset.field}`]: e.detail.value }); },
  onStatus(e) { this.setData({ 'form.status': e.detail.value ? 1 : 0 }); },
  onCert(e) { this.setData({ 'form.certified': e.detail.value ? 1 : 0 }); },

  // ===== 城市级联选择（保证城市名规范，搜索索引依赖标准城市字段） =====
  // 手输回填：乡镇级地名（如"羊流镇"）不在级联数据里，必须允许直接输入
  onCityInput(e) {
    const field = e.currentTarget.dataset.field;
    if (!field) return;
    this.setData({ [`form.${field}`]: e.detail.value });
    this.maybePrefillTitle();
  },

  onFromCity(e) {
    const r = e.detail.value || [];
    this.setData({ fromRegion: r, 'form.fromCityName': r[1] || r[0] || '' });
    this.maybePrefillTitle();
  },
  onToCity(e) {
    const r = e.detail.value || [];
    this.setData({ toRegion: r, 'form.toCityName': r[1] || r[0] || '' });
    this.maybePrefillTitle();
  },

  // 新增模式下，城市选齐且标题为空时自动预填"济南-重庆 专线"（已手填则不覆盖）
  maybePrefillTitle() {
    const { form, isEdit } = this.data;
    if (isEdit || form.title) return;
    if (form.fromCityName && form.toCityName) {
      this.setData({ 'form.title': `${form.fromCityName}-${form.toCityName} 专线` });
    }
  },

  onLineType(e) {
    const idx = Number(e.detail.value) || 0;
    this.setData({ lineTypeIndex: idx, 'form.lineType': this.data.lineTypeOptions[idx] });
  },

  // 类型选择器选项：内置直达/中转，老数据自定义值（如"专线"）追加为第三项，避免显示错位
  buildLineTypeOptions(current) {
    const base = ['直达', '中转'];
    if (current && base.indexOf(current) === -1) base.push(current);
    return base;
  },

  // ===== VIP 到期时间管理 =====
  refreshVipView() {
    const expire = Number(this.data.form.vipExpireAt) || 0;
    const now = Date.now();
    let text = '未开通';
    if (expire > 0) {
      const d = vip.fmtDate(expire);
      text = expire > now ? `会员至 ${d}` : `已过期 ${d}`;
    }
    this.setData({ vipText: text, vipOn: expire > now });
  },

  // 续费/开通：data-days 为天数（30 / 365），在 max(现有到期, 现在) 基础上顺延
  onVipExtend(e) {
    const days = Number(e.currentTarget.dataset.days) || 0;
    if (days <= 0) return;
    const base = this.data.form.vipExpireAt > Date.now() ? this.data.form.vipExpireAt : Date.now();
    this.setData({ 'form.vipExpireAt': base + days * DAY });
    this.refreshVipView();
  },

  // 停用 VIP：清零到期时间（保存时 isVip 派生为 0）
  onVipClear() {
    this.setData({ 'form.vipExpireAt': 0 });
    this.refreshVipView();
  },

  // 【改】地图选点 = 发货地址，自动填进发货地址，并记录选点名供显示核对
  chooseLocation() {
    wx.chooseLocation({
      success: res => {
        const addr = ((res.address || '') + (res.name || '')).trim();
        const locName = (res.name || res.address || '').slice(0, 15);
        this.setData({
          'form.latitude': res.latitude,
          'form.longitude': res.longitude,
          'form.fromAddress': addr || this.data.form.fromAddress,
          locName
        });
        wx.showToast({ title: '发货地址已定位', icon: 'success' });
      },
      fail: () => wx.showToast({ title: '未选择位置', icon: 'none' })
    });
  },

  // 到货定位：收货方导航用（详情页"导航"按钮可切换发货/到货点）
  chooseToLocation() {
    wx.chooseLocation({
      success: res => {
        const addr = ((res.address || '') + (res.name || '')).trim();
        const toLocName = (res.name || res.address || '').slice(0, 15);
        this.setData({
          'form.toLatitude': res.latitude,
          'form.toLongitude': res.longitude,
          'form.toAddress': addr || this.data.form.toAddress,
          toLocName
        });
        wx.showToast({ title: '到货地址已定位', icon: 'success' });
      },
      fail: () => wx.showToast({ title: '未选择位置', icon: 'none' })
    });
  },

  toArr(s) {
    if (!s) return [];
    if (Array.isArray(s)) return s.map(x => String(x).trim()).filter(Boolean);
    return String(s).replace(/[，、;；/|]/g, ',').split(',').map(x => x.trim()).filter(Boolean);
  },

  // 兼容两种历史格式：数组（新数据/编辑页保存）与逗号字符串（批量导入模板）
  // 修复：导入数据 tags 为字符串时，(l.tags || []).join 报 "join is not a function"
  arrToStr(v) {
    if (!v) return '';
    if (Array.isArray(v)) return v.join(',');
    return String(v);
  },

  // 时效规范化：纯数字或"2-3/2~3/2至3"格式自动补"天"单位
  normAging(s) {
    const t = String(s || '').trim();
    if (!t) return '';
    return /^[\d]+(\s*[-~至]\s*[\d]+)?$/.test(t) ? t + '天' : t;
  },

  // 电话校验：按分隔符拆分后逐段检查（允许数字和 -，5~20 位）；发站/到站至少填一个
  validatePhone(phone) {
    if (!phone) return '';
    const segs = String(phone).split(/[,，、;；/\s]+/).map(p => p.trim()).filter(Boolean);
    for (const p of segs) {
      if (!/^[0-9\-]{5,20}$/.test(p)) return `电话格式有误：${p}`;
    }
    return '';
  },

  save() {
    const f = this.data.form;
    if (!f.title) return wx.showToast({ title: '请填写专线名称', icon: 'none' });
    if (!f.fromCityName) return wx.showToast({ title: '请选择出发城市', icon: 'none' });
    if (!f.toCityName) return wx.showToast({ title: '请选择目的城市', icon: 'none' });
    if (!f.fromPhone && !f.toPhone) return wx.showToast({ title: '发站/到站电话至少填一个', icon: 'none' });
    const phoneErr = this.validatePhone(f.fromPhone) || this.validatePhone(f.toPhone);
    if (phoneErr) return wx.showToast({ title: phoneErr, icon: 'none' });

    // 新增时 id 取 Date.now()：连点会创建两条不同 id 的重复专线，必须加锁
    if (!ui.lock(this, 'save')) return;

    const vipExpireAt = Number(f.vipExpireAt) || 0;
    const data = {
      title: f.title, companyName: f.companyName,
      fromCityId: 0, toCityId: 0,
      fromCityName: f.fromCityName, toCityName: f.toCityName,
      fromAddress: f.fromAddress, toAddress: f.toAddress,
      toAreas: this.toArr(f.toAreas),
      latitude: f.latitude, longitude: f.longitude,
      toLatitude: f.toLatitude, toLongitude: f.toLongitude,
      aging: this.normAging(f.aging), priceDesc: f.priceDesc, lineType: f.lineType,
      fromPhone: f.fromPhone, toPhone: f.toPhone,
      // phone 保留为兼容字段（= 发站电话），老版本详情页/分享卡片回退用
      phone: f.fromPhone || f.toPhone,
      // 统一用 toArr 处理，兼容中英文逗号（toArr 空值返回 []，无需额外三元判断）
      tags: this.toArr(f.tags),
      // isVip 由到期时间派生（未过期=1），vipExpireAt 为收费/续费的事实来源
      isVip: vipExpireAt > Date.now() ? 1 : 0,
      vipExpireAt: vipExpireAt,
      certified: f.certified, status: f.status
    };
    if (f._id) data._id = f._id; else data.id = Date.now();

    wx.showLoading({ title: '保存中...' });
    wx.cloud.callFunction({ name: 'adminLine', data: { action: 'save', data } })
      .then((res) => {
        // 校验失败要解锁让用户改完再点；成功路径不解锁，等页面返回（避免 1 秒内再点一次）
        if (res.result && res.result.error) { wx.hideLoading(); ui.unlock(this, 'save'); return wx.showToast({ title: res.result.error, icon: 'none' }); }
        wx.hideLoading(); wx.showToast({ title: '保存成功' }); setTimeout(()=>wx.navigateBack(),1000);
      })
      .catch(() => { wx.hideLoading(); ui.unlock(this, 'save'); wx.showToast({ title: '保存失败', icon: 'none' }); });
  }
});
