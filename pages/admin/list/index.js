/**
 * 后台管理 · 通用列表（公司 / 线路 / 关联 / 公告 / 推广位 / 纠错）
 *
 * ★ 为什么要做成「一个列表页 + 一个表单页」而不是六套页面：
 *   小程序屏小、包体也有限，六张表的操作其实高度同构（列表 → 编辑 → 保存）。
 *   用 type 驱动，新增一张表只要在 utils/admin.js 里加一份元信息，
 *   不用再复制粘贴一整套页面 —— 复制出来的页面迟早会各自漂移。
 *
 * ★ 功能与桌面后台一一对应，不偷工：
 *   搜索、分页（下拉刷新 + 触底加载）、新建、编辑、删除、纠错审核。
 *
 * ★★ 每一次保存/删除都是**直接写云端**，没有「本地副本」这一层。
 */

const admin = require('../../../utils/admin');
const params = require('../../../utils/params');

const PAGE_SIZE = 20;

Page({
  data: {
    /** 数据类型（companies / routes / links / announcements / featured / corrections） */
    type: '',
    label: '',
    desc: '',
    note: '',
    searchable: false,
    editable: false,
    deletable: false,
    isCorrections: false,

    /** 搜索词 */
    kw: '',

    /** 展示行：[{ id, title, sub, chips, raw }] */
    rows: [],
    total: 0,
    page: 1,
    pages: 1,
    hasMore: false,

    /** 首次加载 / 刷新 */
    loading: true,
    /** 触底加载更多（与首次加载分开，避免整列表闪一下） */
    loadingMore: false,
    /** 加载失败（可重试） */
    loadError: false,
    errMessage: '',
    /** 「再试也没用」的错误：没权限 / 没配置 / 没部署 —— 给指引而不是重试按钮 */
    fatalMessage: '',
    /** 类型非法（被人手改了参数） */
    badType: false,

    /** 行内操作进行中（删除 / 审核），防重复点 */
    acting: false,

    /**
     * 从编辑页返回后要不要重拉
     * ★ 不用全局变量 / 事件总线：跳转前打个标记，onShow 里看一眼就够了。
     */
    needReload: false
  },

  onShow() {
    if (!this.data.needReload) return;
    this.setData({ needReload: false });
    this.load(true);
  },

  onLoad(options) {
    const o = options || {};
    const type = params.safeDecode(o.type);
    const meta = admin.TYPES[type];

    if (!meta) {
      this.setData({ badType: true, loading: false });
      wx.setNavigationBarTitle({ title: '后台管理' });
      return;
    }

    this.setData({
      type: type,
      label: meta.label,
      desc: meta.desc,
      note: meta.note || '',
      searchable: !!meta.searchable,
      editable: !!meta.editable,
      deletable: !!meta.deletable,
      isCorrections: type === 'corrections'
    });
    wx.setNavigationBarTitle({ title: '管理 · ' + meta.label });

    this.load(true);
  },

  onPullDownRefresh() {
    this.load(true).then(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (!this.data.hasMore) return;
    if (this.data.loading || this.data.loadingMore) return;
    this.load(false);
  },

  onRetry() {
    this.load(true);
  },

  /**
   * 加载列表
   * @param {boolean} reset true = 重新从第 1 页开始（刷新 / 换关键词）
   */
  async load(reset) {
    if (reset) {
      this.setData({
        rows: [], page: 1, total: 0, pages: 1, hasMore: false,
        loading: true, loadError: false, errMessage: '', fatalMessage: ''
      });
    } else {
      this.setData({ loadingMore: true });
    }

    const page = reset ? 1 : this.data.page + 1;
    const r = await admin.list(this.data.type, this.data.kw, page, PAGE_SIZE);

    if (!r.ok) {
      if (admin.isFatal(r.code)) {
        this.setData({ loading: false, loadingMore: false, fatalMessage: r.message || '没有后台权限' });
      } else {
        this.setData({
          loading: false, loadingMore: false,
          loadError: true, errMessage: r.message || '加载失败'
        });
      }
      return;
    }

    const built = (r.rows || []).map((x) => admin.buildRow(this.data.type, x));
    const rows = reset ? built : this.data.rows.concat(built);

    this.setData({
      rows: rows,
      total: r.total || 0,
      page: r.page || page,
      pages: r.pages || 1,
      hasMore: (r.page || page) < (r.pages || 1),
      loading: false,
      loadingMore: false,
      loadError: false
    });
  },

  /* ============================================================
   * 搜索
   * ============================================================ */

  onSearchInput(e) {
    this.setData({ kw: e.detail.value || '' });
  },

  onSearchConfirm() {
    this.load(true);
  },

  onClearSearch() {
    this.setData({ kw: '' }, () => {
      this.load(true);
    });
  },

  /* ============================================================
   * 新建 / 编辑 / 删除
   * ============================================================ */

  onCreate() {
    this.setData({ needReload: true });
    wx.navigateTo({
      url: '/pages/admin/edit/index?type=' + encodeURIComponent(this.data.type)
    });
  },

  onRowTap(e) {
    const i = Number(e.currentTarget.dataset.index);
    const row = this.data.rows[i];
    if (!row) return;

    // 纠错不进编辑页（内容是用户提交的凭证，只审核不修改）
    if (this.data.isCorrections) {
      this.showCorrection(row);
      return;
    }
    if (!this.data.editable) return;

    this.setData({ needReload: true });
    wx.navigateTo({
      url: '/pages/admin/edit/index?type=' + encodeURIComponent(this.data.type) +
        '&id=' + encodeURIComponent(row.id)
    });
  },

  /**
   * 删除
   *
   * ★ 必删的级联由服务端做（删公司会连带删它的关联、删线路会连带删关联并重算计数），
   *   前端只负责「让用户确认清楚会连带删掉什么」。
   */
  onDelete(e) {
    if (this.data.acting) return;
    const i = Number(e.currentTarget.dataset.index);
    const row = this.data.rows[i];
    if (!row) return;

    let content = '确定删除「' + row.title + '」？删除后不可恢复。';
    if (this.data.type === 'companies') {
      content = '确定删除「' + row.title + '」？它在各条线路上的关联也会一并删除，且不可恢复。';
    } else if (this.data.type === 'routes') {
      content = '确定删除线路「' + row.title + '」？跑这条线的关联会一并删除，且不可恢复。';
    }

    wx.showModal({
      title: '删除确认',
      content: content,
      confirmText: '删除',
      confirmColor: '#D44C47',
      cancelText: '取消',
      success: (r) => {
        if (!r.confirm) return;
        this.doDelete(i, row.id);
      }
    });
  },

  async doDelete(index, id) {
    this.setData({ acting: true });
    const r = await admin.remove(this.data.type, id);
    this.setData({ acting: false });

    if (!r.ok) {
      wx.showToast({ title: r.message || '删除失败', icon: 'none' });
      return;
    }

    // 本地摘掉这一行，省一次整列表刷新
    const rows = this.data.rows.slice();
    rows.splice(index, 1);
    this.setData({ rows: rows, total: Math.max(0, this.data.total - 1) });

    const extra = r.cascadedLinks ? '，连带删除 ' + r.cascadedLinks + ' 条关联' : '';
    wx.showToast({ title: '已删除' + extra, icon: 'none' });
  },

  /* ============================================================
   * 纠错审核
   * ============================================================ */

  /** 点纠错行：看全文（含联系方式、凭证图） */
  showCorrection(row) {
    const c = row.raw || {};
    const bits = [];
    bits.push('问题类型：' + (admin.CORRECTION_TYPE_LABELS[c.type] || '其他'));
    bits.push('反馈内容：' + (c.content || '(未填写)'));
    if (c.contact) bits.push('联系方式：' + c.contact);
    if (c.rejectReason) bits.push('处理备注：' + c.rejectReason);

    wx.showModal({
      title: c.targetSummary || '纠错详情',
      content: bits.join('\n'),
      showCancel: false,
      confirmText: '知道了'
    });
  },

  /** 采纳 / 驳回 / 待定 */
  onReview(e) {
    if (this.data.acting) return;
    const d = e.currentTarget.dataset || {};
    const status = String(d.status || '');
    const id = String(d.id || '');
    if (!id || !status) return;

    const label = admin.CORRECTION_STATUS_LABELS[status] || status;
    wx.showModal({
      title: '标记为「' + label + '」',
      content: '确定把这条纠错标记为「' + label + '」？',
      success: (r) => {
        if (!r.confirm) return;
        this.doReview(id, status);
      }
    });
  },

  async doReview(id, status) {
    this.setData({ acting: true });
    const r = await admin.review(id, status, '');
    this.setData({ acting: false });

    if (!r.ok) {
      wx.showToast({ title: r.message || '操作失败', icon: 'none' });
      return;
    }
    wx.showToast({ title: '已更新', icon: 'none' });
    // 状态变了，列表里的徽章也要跟着变 —— 整页重拉最稳
    this.load(true);
  },

  /* ============================================================
   * 提示
   * ============================================================ */

  onNote() {
    if (!this.data.note) return;
    wx.showModal({
      title: this.data.label,
      content: this.data.note,
      showCancel: false,
      confirmText: '知道了'
    });
  }
});
