// app.js
// 小程序入口文件

App({
  /**
   * 全局数据
   */
  globalData: {
    userInfo: null,
    token: '',
    baseUrl: '',
    fromCity: null,
    toCity: null
  },

  /**
   * 小程序启动时执行
   */
  onLaunch() {
    console.log('物流专线查询小程序启动成功');

    // 【新增】初始化云开发环境
    // wx.cloud 是微信提供的云开发对象
    if (wx.cloud) {
      wx.cloud.init({
        // 云开发环境 ID（云开发控制台 > 设置 > 环境设置）
        env: 'cloud1-d0ge42roj61603242',

        // 是否追踪用户openid，设为true后云函数能自动获取用户身份
        traceUser: true
      });

      console.log('云开发环境初始化成功');
      this.watchGlobalErrors();
    } else {
      console.error('当前微信版本过低，无法使用云开发');
    }
  },

  /**
   * 全局错误上报：写入 app_errors 集合（集合由 statLog 云函数首次调用时自动创建）。
   * 线上排障用：管理端后续可在云控制台按时间排查。fire-and-forget，绝不影响主流程。
   */
  reportError(source, detail) {
    if (!wx.cloud || !wx.cloud.database) return;
    try {
      wx.cloud.database().collection('app_errors').add({
        data: {
          source: source,                          // 'onError' | 'unhandledRejection'
          msg: String(detail).slice(0, 1000),      // 截断防止超大栈写库
          page: (getCurrentPages().pop() || {}).route || '',
          ts: Date.now()
        }
      }).catch(() => {});
    } catch (e) { /* 上报失败静默 */ }
  },

  watchGlobalErrors() {
    const report = (source, detail) => this.reportError(source, detail);
    if (wx.onError) wx.onError(msg => report('onError', msg));
    if (wx.onUnhandledRejection) {
      wx.onUnhandledRejection(res => report('unhandledRejection', (res && res.reason) || ''));
    }
  }
});