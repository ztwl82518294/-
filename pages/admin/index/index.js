/**
 * 后台管理 · 总览（PRD 模块 06 的小程序形态）
 *
 * 三个作用：
 *   1. **确认身份** —— 是管理员就进，不是就直接把自己的 openid 摆出来，
 *      复制填进云函数的白名单即可，不需要额外工具；
 *   2. **看一眼数据规模** —— 公司 / 线路 / 关联各多少条；
 *   3. **入口** —— 公司、线路、关联、公告、推广位、纠错、导入、质量八个入口。
 *
 * ★ 入口是隐藏的：首页只在 whoami 判定为管理员时才显示「管理」两个字，
 *   普通用户完全看不到这里（他就算摸进来，本页也只给一个 openid）。
 *
 * ★★ 与桌面后台（admin/）的冲突，必须写在最显眼的地方：
 *   桌面后台改的是**本地副本** admin/data/，再导出导入云端；
 *   这里的每一次保存都是**直接写云端**。一旦在这里改过数据，
 *   桌面后台的本地副本就过期了，下次千万不能拿它去覆盖云端。
 */

const admin = require('../../../utils/admin');

/** 八个入口（六个数据类型 + 批量导入 + 数据质量） */
const ENTRIES = [
  { type: 'companies', page: 'list', label: '公司', desc: '档案 · 电话 · 城市' },
  { type: 'routes', page: 'list', label: '线路', desc: '出发 → 到达' },
  { type: 'links', page: 'list', label: '关联', desc: '时效 · 直达 · 频率' },
  { type: 'announcements', page: 'list', label: '公告', desc: '首页滚动播' },
  { type: 'featured', page: 'list', label: '推广位', desc: '首页优质线路' },
  { type: 'corrections', page: 'list', label: '纠错审核', desc: '用户提交的反馈' },
  { type: '', page: 'import', label: '批量导入', desc: 'CSV 粘贴 · 先预览' },
  { type: '', page: 'quality', label: '数据质量', desc: '缺失 · 异常 · 门槛' }
];

Page({
  data: {
    /** 正在确认身份 / 拉取总览 */
    loading: true,
    /** 加载失败（可重试） */
    loadError: false,
    errMessage: '',

    /** 是否管理员 */
    isAdmin: false,
    /** 当前用户的 openid（非管理员时要显示出来给人复制） */
    openid: '',
    /** 不是管理员的原因：NOT_ADMIN（不在白名单）/ NOT_CONFIGURED（白名单空的） */
    denyCode: '',

    /** 数据规模 */
    counts: {
      companies: 0, routes: 0, links: 0,
      corrections: 0, pendingCorrections: 0,
      announcements: 0, featured: 0
    },
    /** 上线硬门槛：这三项必须为 0 */
    blocking: { countMismatch: 0, orphan: 0, emptyRoutes: 0 },

    entries: ENTRIES
  },

  onLoad() {
    this.loadAll();
  },

  onPullDownRefresh() {
    this.loadAll().then(() => wx.stopPullDownRefresh());
  },

  onRetry() {
    this.loadAll();
  },

  /**
   * 身份 + 总览
   *
   * ★ 两步串行而不是并行：不是管理员时根本拿不到总览（服务端会拦），
   *   并行只会多一个必然失败的请求，还让页面出现「先显示数字再消失」的抖动。
   */
  async loadAll() {
    this.setData({ loading: true, loadError: false, errMessage: '' });

    const who = await admin.whoami();
    if (!who.ok) {
      this.setData({ loading: false, loadError: true, errMessage: who.message || '连接后台失败' });
      return;
    }

    const openid = who.openid || '';
    if (!who.isAdmin) {
      this.setData({
        loading: false,
        isAdmin: false,
        openid: openid,
        denyCode: who.code || 'NOT_ADMIN'
      });
      return;
    }

    this.setData({ isAdmin: true, openid: openid });

    const ov = await admin.overview();
    if (!ov.ok) {
      this.setData({ loading: false, loadError: true, errMessage: ov.message || '总览加载失败' });
      return;
    }

    this.setData({
      loading: false,
      counts: ov.counts || this.data.counts,
      blocking: ov.blocking || this.data.blocking
    });
  },

  /* ============================================================
   * 入口
   * ============================================================ */

  onEntryTap(e) {
    const d = e.currentTarget.dataset || {};
    if (d.page === 'import') {
      wx.navigateTo({ url: '/pages/admin/import/index' });
      return;
    }
    if (d.page === 'quality') {
      wx.navigateTo({ url: '/pages/admin/quality/index' });
      return;
    }
    wx.navigateTo({
      url: '/pages/admin/list/index?type=' + encodeURIComponent(d.type || '')
    });
  },

  /* ============================================================
   * openid（非管理员时用）
   * ============================================================ */

  onCopyOpenid() {
    const id = this.data.openid;
    if (!id) return;
    wx.setClipboardData({
      data: id,
      success: () => {
        wx.showToast({ title: '已复制 openid', icon: 'none' });
      }
    });
  },

  /** 看不懂 openid 该怎么用时，给一段人话说明 */
  onHowTo() {
    wx.showModal({
      title: '怎么成为管理员',
      content: '把上面这串 openid 复制到 cloudfunctions/adminApi/index.js 里的 ADMIN_OPENIDS 数组中，保存后在开发者工具里重新上传部署这个云函数，再回来刷新即可。',
      showCancel: false,
      confirmText: '知道了'
    });
  },

  /* ============================================================
   * 提示
   * ============================================================ */

  /** 底部那条「别拿本地副本覆盖云端」的说明，点开看全文 */
  onConflictNote() {
    wx.showModal({
      title: '与桌面后台的冲突',
      content: '桌面后台（电脑上打开的那个）改的是本地副本 admin/data/，之后要导出再导入云端；而小程序后台是**直接写云端**。所以只要在这里改过数据，桌面后台的本地副本就已经过期了，下次绝不能拿它去覆盖云端 —— 那样会把这里的改动整批抹掉。',
      showCancel: false,
      confirmText: '记住了'
    });
  }
});
