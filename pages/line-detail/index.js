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
    // 网点分组：第 n 组 = 第 n 个地址 + 挂在该地址下的全部电话（一一配对编号展示）。
    // 【v6.2】纯电话行不再各自成组，统一并入第一个地址组（见 buildOutlets）。
    fromPairs: [], toPairs: [],
    // 统计卡口径：只算"有地址的组"（fromPairs.length 会把纯电话组也算进去，数字虚高）
    fromAddrCount: 0, toAddrCount: 0,
    // 覆盖区域（toAreas 归一后的数组，74% 线路有值，是用户判断"能不能到我这"的依据）
    toAreas: [],
    // 运营信息是否有任意一项有值：全空时整卡隐藏，不留空标题
    hasSpecs: false,
    loadError: ''
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

  // 兼容多个号码：按中英文逗号、顿号、分号、斜杠、空白分隔，再去重。
  // 【v6.2】不再排序：号码是"按业务重要性录入"的（第 1 个常是主号），
  // 排序会打乱运营录入的原始顺序，用户会觉得"号码被乱排了"。
  splitPhones(phone) {
    const out = [];
    const seen = new Set();
    String(phone || '').split(/[,，、;；/\s]+/).forEach(p => {
      p = p.trim();
      if (p && !seen.has(p)) { seen.add(p); out.push(p); }
    });
    return out;
  },

  // 多个地址：按换行/分号/竖线拆分为独立地址（逗号不拆——地址内部常含逗号），去重。
  // 【v6.2】不再排序：保留录入顺序（第 1 个常是主发货点）。
  splitAddrs(addr) {
    const out = [];
    const seen = new Set();
    String(addr || '').split(/[\r\n;；|｜]+/).forEach(a => {
      a = a.trim();
      if (a && !seen.has(a)) { seen.add(a); out.push(a); }
    });
    return out;
  },

  // 网点分组：优先用导入时写入的 fromOutlets/toOutlets（"地址|电话" 精确配对）；
  // 老数据没有该字段时回退为"第 n 个地址 + 第 n 个电话"按下标对位。
  //
  // 【v6.2 修复】直灌数据的网点是"1 个地址行 + N 个纯电话行"（见 outlets.js 形态②），
  // 逐行成组会渲染成「① 地址 / ② 地址未填写 / ③ 地址未填写」，看起来像凭空多出
  // 两个没填地址的网点。而 R-13 明确要求"单地址多电话保持 1 网点挂多号"。
  // 因此：**纯电话行不再各自成组**，而是并入同一侧的地址组；没有地址时单独成一组。
  //
  // 分组规则：
  //   - 地址行（含地址）→ 各自成组，地址按录入顺序排列；
  //   - 无地址的电话行 → 全部并入**第一个**地址组；若该侧没有任何地址，则整体成 1 组。
  // 返回 [ { idx, addr, phones: [] } ]，phoneTail 为"无地址电话"的总数（供展示层判断）。
  buildOutlets(outlets, addrs, phones) {
    const src = Array.isArray(outlets) ? outlets : [];
    let raw = [];
    if (src.length) {
      src.forEach(o => {
        const addr = (o && (o.addr || o.address)) || '';
        const ps = this.splitPhones((o && (o.phone || o.tel)) || '');
        if (!addr && ps.length === 0) return;
        raw.push({ addr, phones: ps });
      });
    }
    // 无网点字段：按下标对位（老字段形态）
    if (!raw.length) {
      const n = Math.max(addrs.length, phones.length);
      for (let i = 0; i < n; i++) {
        const addr = addrs[i] || '';
        raw.push({ addr, phones: phones[i] ? [phones[i]] : [] });
      }
    }

    const withAddr = raw.filter(r => r.addr);
    const withoutAddr = raw.filter(r => !r.addr);
    // 无地址的电话全部拍平成一个数组（保持录入顺序）
    const tailPhones = [];
    const tailSeen = new Set();
    withoutAddr.forEach(r => r.phones.forEach(p => {
      if (!tailSeen.has(p)) { tailSeen.add(p); tailPhones.push(p); }
    }));

    const groups = withAddr.map(r => ({ addr: r.addr, phones: r.phones.slice() }));
    if (groups.length === 0) {
      // 该侧完全没有地址：所有电话合成唯一一组，不造"地址未填写"的空行
      groups.push({ addr: '', phones: tailPhones });
    } else if (tailPhones.length) {
      // 有地址：无地址的电话并入第一个地址组（"单地址多电话 1 网点挂多号"）。
      // 合并时必须对第一个组**已有的号码**再去一次重——直灌数据里同一个号码
      // 可能既写在地址行内、又单占一行（"1 个号写了两遍"），不去重会重复展示。
      const head = groups[0];
      const seenInHead = new Set(head.phones);
      tailPhones.forEach(p => {
        if (!seenInHead.has(p)) { seenInHead.add(p); head.phones.push(p); }
      });
    }

    return groups.map((g, i) => ({ idx: i + 1, addr: g.addr, phones: g.phones }));
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
      // 统计口径：区分"有地址的组"与"仅电话的组"，统计卡只算真实地址数，
      // 否则会把"纯电话"也算成网点，数字虚高（截图中 1 个地址显示成 3）
      const countAddr = ps => ps.filter(p => !!p.addr).length;
      const fromAddrCount = countAddr(fromPairs);
      const toAddrCount = countAddr(toPairs);
      // 底部"立即拨打"用合并列表，两端之间也去一次重
      const phoneList = Array.from(new Set(fromPhones.concat(toPhones)));
      // 运营信息三项全空时整卡隐藏（时效 42% / 价格 43% / 方式 62%，
      // 有相当比例线路一项都没有，留空标题卡会显得页面残缺）
      const hasSpecs = !!(lineInfo.aging || lineInfo.priceDesc || lineInfo.lineType);
      // 收藏状态不阻塞正文渲染：先出内容，状态回填后再亮星标
      storage.isFavorite(lineInfo.id).then(isFav => this.setData({ isFav })).catch(() => {});
      this.setData({
        lineInfo, fromAddrs, toAddrs, fromPhones, toPhones, fromPairs, toPairs, phoneList,
        fromAddrCount, toAddrCount,
        toAreas: lineInfo.toAreas, hasSpecs
      });
      // 浏览埋点（专线成功打开记一次，PV 口径，不阻塞）
      stats.logView(lineInfo);
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

  // 纠错：跳转到站内反馈表单（pages/report）。
  // 【v6.4 改】原实现是"弹框说明 → ActionSheet 二选一（打电话 / 复制微信）"，
  // 用户要跳出小程序切到电话或微信 App，摩擦太大、几乎没人真的反馈。
  // 现改为站内表单：类型 chips + 文字说明 + 图片凭证，写完即提交，
  // 平台后台集中核实（"核实通过后才会修改，不会立即生效"）。
  // 带参只用于给表单一个"你要反馈的信息"提示与写入定位，不参与权限判断。
  onReport() {
    const line = this.data.lineInfo;
    const name = line ? (line.companyName || line.title || '该专线') : '';
    const ref = line ? lineKey.lineRef(line) : '';
    wx.navigateTo({
      url: `/pages/report/index?kind=line&key=${encodeURIComponent(ref)}&name=${encodeURIComponent(name)}`
    });
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