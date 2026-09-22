/**
 * 小程序入口
 *
 * 职责：
 *   1. 初始化云开发环境
 *   2. 维护全局共享状态（跨 Tab 传参、城市字典缓存）
 *   3. 首次进入的隐私协议弹窗判定
 *
 * ★ 跨 Tab 传参约定（重要）：
 *   Tab 页之间不能用 navigateTo 传参（必须 switchTab，而 switchTab 不支持带参数）。
 *   因此凡「非 Tab 页 → Tab 页」的跳转，都把参数暂存在 globalData 里，
 *   由目标 Tab 页在 onShow 中取用并立即清空。
 *   现有两个通道：
 *     pendingAddressQuery  { from, to }       → 首页/查专线 查询
 *     pendingCompanyKeyword string            → 查公司 搜索
 */

const CLOUD_ENV = 'cloud1-d0ge42roj61603242';

App({
  globalData: {
    /** 云环境是否初始化成功 */
    cloudReady: false,
    /** 云环境 ID */
    cloudEnv: CLOUD_ENV,
    /** 待处理的地址查询（跨 Tab 传参通道 1） */
    pendingAddressQuery: null,
    /** 待处理的公司搜索关键词（跨 Tab 传参通道 2） */
    pendingCompanyKeyword: '',
    /** 城市字典缓存（首次用到时懒加载） */
    cityCache: null,
    /** 系统信息（胶囊按钮位置等，供自定义导航用；当前用默认导航，保留备用） */
    systemInfo: null
  },

  onLaunch() {
    this.initCloud();
    this.readSystemInfo();
  },

  /** 初始化云开发；失败不阻塞启动（页面会走空态而不是白屏） */
  initCloud() {
    if (!wx.cloud) {
      console.warn('[app] 当前基础库不支持云开发，请升级微信开发者工具或基础库版本');
      return;
    }
    try {
      wx.cloud.init({
        env: CLOUD_ENV,
        traceUser: true
      });
      this.globalData.cloudReady = true;
    } catch (e) {
      console.warn('[app] 云开发初始化失败：', (e && (e.errMsg || e.message)) || e);
    }
  },

  readSystemInfo() {
    try {
      // getSystemInfoSync 在新版基础库已标记废弃，但兼容性最好；
      // 这里只用它做降级兜底，不用于关键逻辑。
      const info = wx.getSystemInfoSync();
      this.globalData.systemInfo = info;
    } catch (e) {
      this.globalData.systemInfo = null;
    }
  },

  /* ============================================================
   * 跨 Tab 传参通道
   * ============================================================ */

  /** 写：设置待处理的地址查询 */
  setPendingAddressQuery(from, to) {
    this.globalData.pendingAddressQuery = (from && to) ? { from, to } : null;
  },

  /** 读并清空：地址查询 */
  takePendingAddressQuery() {
    const v = this.globalData.pendingAddressQuery;
    this.globalData.pendingAddressQuery = null;
    return v;
  },

  /** 写：设置待处理的公司关键词 */
  setPendingCompanyKeyword(kw) {
    this.globalData.pendingCompanyKeyword = String(kw || '').trim();
  },

  /** 读并清空：公司关键词 */
  takePendingCompanyKeyword() {
    const v = this.globalData.pendingCompanyKeyword;
    this.globalData.pendingCompanyKeyword = '';
    return v;
  }
});
