// pages/line-detail/index.js
const db = wx.cloud.database();
const storage = require('../../utils/storage.js');
const stats = require('../../utils/stats.js');
const vip = require('../../utils/vip.js');
const outlets = require('../../utils/outlets.js');
const lineKey = require('../../utils/lineKey.js');

Page({
  data: {
    lineInfo: null, isFav: false, phoneList: [],
    fromPhones: [], toPhones: [], fromAddrs: [], toAddrs: [],
    // 网点分组：第 n 组 = 第 n 个地址 + 第 n 个电话（一一配对编号展示）
    fromPairs: [], toPairs: [],
    reduceAnimation: false, loadError: ''
  },

  onLoad(options) {
    // 兼容两种键：数字 id（旧分享链接、老列表跳转）与 _id（主键，新链路首选）。
    // 历史数据可能缺 id 字段，只认数字会让这批线路永远打不开（误报"链接已失效"）。
    const key = lineKey.parseLineKey(options.lineId);
    if (!key) {
      this.setData({ loadError: '链接已失效' });
      return;
    }
    this._lineKey = key;
    this.loadLine();
  },

  // 错误态：重新加载 / 返回
  retryLoad() {
    this.setData({ loadError: '', lineInfo: null });
    if (this._lineKey) this.loadLine();
  },
  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) });
  },

  onUnload() {
    if (this._animationTimer) clearTimeout(this._animationTimer);
  },

  // 兼容多个号码：按中英文逗号、顿号、分号、斜杠、空白分隔，
  // 再去重 + 升序排序（"0"开头的座机自然排在前、"1"开始的手机号在后，
  // 组内各自升序，展示与拨打面板顺序一致）
  splitPhones(phone) {
    const out = [];
    const seen = new Set();
    String(phone || '').split(/[,，、;；/\s]+/).forEach(p => {
      p = p.trim();
      if (p && !seen.has(p)) { seen.add(p); out.push(p); }
    });
    return out.sort();
  },

  // 多个地址：按换行/分号/竖线拆分为独立地址（逗号不拆——地址内部常含逗号），
  // 去重 + 升序排序：相同前缀（同一园区/同一路段）的地址排序后自然相邻
  splitAddrs(addr) {
    const out = [];
    const seen = new Set();
    String(addr || '').split(/[\r\n;；|｜]+/).forEach(a => {
      a = a.trim();
      if (a && !seen.has(a)) { seen.add(a); out.push(a); }
    });
    return out.sort();
  },

  // 网点分组：优先用导入时写入的 fromOutlets/toOutlets（"地址|电话" 精确配对）；
  // 老数据没有该字段时回退为"第 n 个地址 + 第 n 个电话"按下标对位。
  // 一个网点可挂多个电话（phones 数组），数量不等时多出的单独成组，信息不丢。
  buildOutlets(outlets, addrs, phones) {
    const src = Array.isArray(outlets) ? outlets : [];
    let pairs = [];
    if (src.length) {
      src.forEach(o => {
        const addr = (o && (o.addr || o.address)) || '';
        const ps = this.splitPhones((o && (o.phone || o.tel)) || '');
        if (!addr && ps.length === 0) return;
        pairs.push({ idx: pairs.length + 1, addr, phones: ps });
      });
    }
    if (!pairs.length) {
      const n = Math.max(addrs.length, phones.length);
      for (let i = 0; i < n; i++) {
        const addr = addrs[i] || '';
        const ps = phones[i] ? [phones[i]] : [];
        if (!addr && ps.length === 0) continue;
        pairs.push({ idx: pairs.length + 1, addr, phones: ps });
      }
    }
    return pairs;
  },

  // 网点配对：第 n 组 = 第 n 个地址 + 第 n 个电话，一一对应编号展示。

// 数组字段归一：导入数据里 tags/toAreas 可能是逗号字符串，
// 字符串直接丢给 wx:for 会逐字渲染成一个个标签，这里统一转成数组
  toArr(v) {
    if (!v) return [];
    if (Array.isArray(v)) return v.map(x => String(x).trim()).filter(Boolean);
    return String(v).split(/[,，、;；/|\s]+/).map(x => x.trim()).filter(Boolean);
  },

  loadLine() {
    const where = lineKey.lineWhere(this._lineKey);
    // 先取线路（拿到 _id 后才能确定收藏键），再并行处理收藏状态与展示数据
    db.collection('lines').where(where).get().then(res => {
      if (!res.data.length) {
        this.setData({ loadError: '未找到该专线，可能已下架' });
        return;
      }
      const lineInfo = res.data[0];
      // 下架线路不再对用户展示（否则停投/违规线路仍能通过旧分享链接、收藏入口访问）
      if (lineInfo.status === 0) {
        this.setData({ loadError: '该专线已下架' });
        return;
      }
      // 收藏以业务 id 为准（与历史收藏数据口径一致）；缺 id 的历史数据用主键兜底，
      // 保证"收藏/取消收藏/分享"三条链路有稳定的唯一键
      lineInfo.id = lineInfo.id || lineInfo._id;
      // VIP 有效性口径统一：过期会员自动降级（徽标/动效随 isVip 联动）
      lineInfo.isVip = vip.effectiveVip(lineInfo);
      lineInfo.tags = this.toArr(lineInfo.tags);
      lineInfo.toAreas = this.toArr(lineInfo.toAreas);
      // 【修复】旧版云函数批量导入/控制台直灌的数据，fromOutlets/toOutlets 是
      // "地址 | 电话1,电话2" 字符串且 fromAddress/fromPhone 为空，buildOutlets
      // 只认数组会导致发站/到站显示"未填写"。这里先归一网点并反填老字段，
      // 与服务端 deriveOutlets 同口径，复制地址/拨打电话链路随之恢复。
      outlets.deriveLegacy(lineInfo, 'from');
      outlets.deriveLegacy(lineInfo, 'to');
      // 发站/到站电话分列展示：新字段 fromPhone/toPhone，老数据回退到统一 phone
      const fromPhones = this.splitPhones(lineInfo.fromPhone || lineInfo.phone);
      const toPhones = this.splitPhones(lineInfo.toPhone || lineInfo.phone);
      // 发站/到站地址拆分为独立条目（多地址去重排序，逐条展示/复制）
      const fromAddrs = this.splitAddrs(lineInfo.fromAddress);
      const toAddrs = this.splitAddrs(lineInfo.toAddress);
      const fromPairs = this.buildOutlets(lineInfo.fromOutlets, fromAddrs, fromPhones);
      const toPairs = this.buildOutlets(lineInfo.toOutlets, toAddrs, toPhones);
      // 底部"立即拨打"用合并列表，两端之间也去一次重
      const phoneList = Array.from(new Set(fromPhones.concat(toPhones)));
      // 收藏状态不阻塞正文渲染：先出内容，状态回填后再亮星标
      storage.isFavorite(lineInfo.id).then(isFav => this.setData({ isFav })).catch(() => {});
      this.setData({ lineInfo, fromAddrs, toAddrs, fromPhones, toPhones, fromPairs, toPairs, phoneList });
      // 浏览埋点（专线成功打开记一次，PV 口径，不阻塞）
      stats.logView(lineInfo);
      // 会员企业动效较密集，5秒后降频以减轻低端机渲染压力
      if (lineInfo.isVip) {
        this._animationTimer = setTimeout(() => {
          this.setData({ reduceAnimation: true });
        }, 5000);
      }
    }).catch(() => this.setData({ loadError: '加载失败，请检查网络后重试' }));
  },

  onShareAppMessage() {
    const { lineInfo } = this.data;
    if (!lineInfo) return { title: '物流专线查询', path: '/pages/index/index' };
    return {
      title: `${lineInfo.fromCityName}到${lineInfo.toCityName}物流专线 - ${lineInfo.title}`,
      path: `/pages/line-detail/index?lineId=${lineInfo.id}`
    };
  },

  toggleFavorite() {
    const { lineInfo, isFav } = this.data;
    if (!lineInfo) return;
    // 防止异步未完成时重复点击导致重复请求/脏数据
    if (this._favBusy) return;
    this._favBusy = true;
    const done = () => { this._favBusy = false; };
    if (isFav) {
      storage.removeFavorite(lineInfo.id)
        .then(() => { this.setData({ isFav: false }); wx.showToast({ title: '已取消收藏', icon: 'none' }); })
        .catch(() => wx.showToast({ title: '操作失败', icon: 'none' }))
        .then(done, done);
    } else {
      storage.addFavorite(lineInfo)
        .then(() => { this.setData({ isFav: true }); wx.showToast({ title: '收藏成功', icon: 'success' }); })
        .catch(() => wx.showToast({ title: '操作失败', icon: 'none' }))
        .then(done, done);
    }
  },

  // 拨打电话：data-station 指定发站/到站取号（老数据两端都回退到 phone），底部"立即拨打"用合并列表
  onCallPhone(e) {
    const station = e && e.currentTarget && e.currentTarget.dataset.station;
    let phones;
    if (station === 'from') phones = this.splitPhones(this.data.lineInfo.fromPhone || this.data.lineInfo.phone);
    else if (station === 'to') phones = this.splitPhones(this.data.lineInfo.toPhone || this.data.lineInfo.phone);
    else phones = this.data.phoneList || [];
    if (phones.length === 0) return wx.showToast({ title: '暂无联系电话', icon: 'none' });
    if (phones.length === 1) return wx.makePhoneCall({ phoneNumber: phones[0] });
    // ActionSheet 的 itemList 上限 6 个：号码更多时引导直接点具体号码（号码行已支持点击直拨）
    // 原文案 16 字会被 toast 截断成"..."，缩短到一行半以内
    if (phones.length > 6) return wx.showToast({ title: '号码较多，请点号码直拨', icon: 'none', duration: 2000 });
    wx.showActionSheet({
      itemList: phones,
      success: (res) => wx.makePhoneCall({ phoneNumber: phones[res.tapIndex] })
    });
  },

  // 点击单个号码直接拨打（多号码时无需经过选择面板）
  onCallOne(e) {
    const phone = e && e.currentTarget && e.currentTarget.dataset.phone;
    if (!phone) return;
    wx.makePhoneCall({ phoneNumber: phone });
  },

  // 网点右侧拨号按钮：组内 1 个号直接拨；2~6 个弹选择面板；
  // 超过 6 个（ActionSheet itemList 上限）引导点具体号码（号码行已支持直拨）
  onCallGroup(e) {
    const station = e && e.currentTarget && e.currentTarget.dataset.station;
    const index = Number(e && e.currentTarget && e.currentTarget.dataset.index);
    const pairs = station === 'to' ? this.data.toPairs : this.data.fromPairs;
    const phones = (pairs && pairs[index] && pairs[index].phones) || [];
    if (phones.length === 0) return wx.showToast({ title: '暂无联系电话', icon: 'none' });
    if (phones.length === 1) return wx.makePhoneCall({ phoneNumber: phones[0] });
    if (phones.length > 6) return wx.showToast({ title: '号码较多，请点号码直拨', icon: 'none', duration: 2000 });
    wx.showActionSheet({
      itemList: phones,
      success: (res) => wx.makePhoneCall({ phoneNumber: phones[res.tapIndex] })
    });
  },

  // 复制整组地址：多地址一键复制全部（换行分隔），单地址与逐条复制等效
  onCopyAllAddr(e) {
    const station = e && e.currentTarget && e.currentTarget.dataset.station;
    const list = station === 'to' ? this.data.toAddrs : this.data.fromAddrs;
    if (!list || list.length === 0) return wx.showToast({ title: '暂无地址', icon: 'none' });
    wx.setClipboardData({
      data: list.join('\n'),
      success: () => wx.showToast({ title: list.length > 1 ? `已复制全部 ${list.length} 个地址` : '已复制', icon: 'none' })
    });
  },

  onCopyText(e) {
    const text = e.currentTarget.dataset.text;
    if (!text) return wx.showToast({ title: '暂无地址', icon: 'none' });
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: '已复制', icon: 'none' })
    });
  },

  // 【改】双端导航：发货点/到货点均有定位时弹选择，仅一端有则直达；
  // 到货点无定位时降级为复制到货地址（用户可粘贴到地图 App）
  onOpenMap() {
    const { lineInfo } = this.data;
    const hasFrom = Number(lineInfo.latitude) && Number(lineInfo.longitude);
    const hasTo = Number(lineInfo.toLatitude) && Number(lineInfo.toLongitude);

    if (hasFrom && hasTo) {
      return wx.showActionSheet({
        itemList: ['🚚 导航到发货点', '🏭 导航到到货点'],
        success: res => {
          if (res.tapIndex === 0) this.openNav(lineInfo.latitude, lineInfo.longitude, lineInfo.companyName || lineInfo.title, lineInfo.fromAddress);
          else this.openNav(lineInfo.toLatitude, lineInfo.toLongitude, lineInfo.companyName || lineInfo.title, lineInfo.toAddress);
        }
      });
    }
    if (hasFrom) return this.openNav(lineInfo.latitude, lineInfo.longitude, lineInfo.companyName || lineInfo.title, lineInfo.fromAddress);
    if (hasTo) return this.openNav(lineInfo.toLatitude, lineInfo.toLongitude, lineInfo.companyName || lineInfo.title, lineInfo.toAddress);

    // 两端都无坐标：能复制的给地址，否则提示
    if (lineInfo.fromAddress || lineInfo.toAddress) {
      return wx.showActionSheet({
        itemList: ['复制发货地址', '复制到货地址'].filter((_, i) => (i === 0 ? lineInfo.fromAddress : lineInfo.toAddress)),
        success: res => {
          const text = res.tapIndex === 0 && lineInfo.fromAddress ? lineInfo.fromAddress : lineInfo.toAddress;
          wx.setClipboardData({ data: text, success: () => wx.showToast({ title: '地址已复制', icon: 'none' }) });
        }
      });
    }
    wx.showToast({ title: '该专线暂未设置定位', icon: 'none' });
  },

  openNav(lat, lng, name, address) {
    wx.openLocation({
      latitude: Number(lat),
      longitude: Number(lng),
      name: name || '',
      address: address || '',
      scale: 16
    });
  }
});