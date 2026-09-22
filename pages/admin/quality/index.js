/**
 * 后台管理 · 数据质量看板
 *
 * 与桌面后台的「数据质量」同一口径（云函数里复用同一份统计逻辑 computeQuality）。
 *
 * ★ 看板回答三个问题：
 *   1. 有多少数据缺失（没电话的公司、没时效的关联）；
 *   2. 有多少数据自相矛盾（线路声明的公司数与实际关联数对不上、关联指向不存在的记录）；
 *   3. 用户反馈处理得怎么样（纠错各状态各多少条）。
 *
 * ★ 前三行是「上线硬门槛」，不为 0 就不该提审：
 *   计数不符 / 孤立关联 / 空线路 —— 这三类会直接让用户看到错东西。
 */

const admin = require('../../../utils/admin');

/** 明细最多列几条（看板是看规模的地方，不是查数据的地方） */
const DETAIL_LIMIT = 10;

Page({
  data: {
    loading: true,
    loadError: false,
    errMessage: '',
    fatalMessage: '',

    /** 统计 */
    q: {
      companies: { total: 0, noPhone: 0, noPhonePct: 0, stale: 0 },
      routes: { total: 0, empty: 0, countMismatch: 0 },
      links: { total: 0, noTransit: 0, noTransitPct: 0, orphan: 0 },
      corrections: { pending: 0, accepted: 0, rejected: 0, hold: 0, all: 0 },
      blocking: { countMismatch: 0, orphan: 0, emptyRoutes: 0 }
    },

    /** 明细（各取前 10 条） */
    noPhone: [],
    staleCompanies: [],
    countMismatch: [],
    orphan: []
  },

  onLoad() {
    this.load();
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  onRetry() {
    this.load();
  },

  async load() {
    this.setData({ loading: true, loadError: false, errMessage: '', fatalMessage: '' });

    const r = await admin.quality();
    if (!r.ok) {
      if (admin.isFatal(r.code)) {
        this.setData({ loading: false, fatalMessage: r.message || '没有后台权限' });
      } else {
        this.setData({ loading: false, loadError: true, errMessage: r.message || '加载失败' });
      }
      return;
    }

    const q = r.quality || {};
    const details = q.details || {};

    this.setData({
      loading: false,
      q: {
        companies: q.companies || this.data.q.companies,
        routes: q.routes || this.data.q.routes,
        links: q.links || this.data.q.links,
        corrections: q.corrections || this.data.q.corrections,
        blocking: q.blocking || this.data.q.blocking
      },
      noPhone: (details.noPhone || []).slice(0, DETAIL_LIMIT),
      staleCompanies: (details.staleCompanies || []).slice(0, DETAIL_LIMIT),
      countMismatch: (details.countMismatch || []).slice(0, DETAIL_LIMIT),
      orphan: (details.orphan || []).slice(0, DETAIL_LIMIT)
    });
  },

  /** 点「计数不符」明细：说清楚这条线路到底差在哪 */
  onMismatchTap(e) {
    const i = Number(e.currentTarget.dataset.index);
    const item = this.data.countMismatch[i];
    if (!item) return;
    wx.showModal({
      title: item.routeKey || '线路',
      content: '线路上记录着 ' + item.declared + ' 家公司，实际关联有 ' + item.actual +
        ' 条。一般由「关联被删了但计数没重算」造成；在关联列表里随便做一次增删改就会重算。',
      showCancel: false,
      confirmText: '知道了'
    });
  },

  /** 孤立关联：关联指向的线路或公司已经不存在了 */
  onOrphanTap(e) {
    const i = Number(e.currentTarget.dataset.index);
    const item = this.data.orphan[i];
    if (!item) return;
    wx.showModal({
      title: '孤立关联',
      content: '这条关联指向的记录已经不存在了（线路 ' + (item.routeId || '空') +
        ' / 公司 ' + (item.companyId || '空') + '）。它不会出现在任何查询结果里，属于垃圾数据，应当删除。',
      showCancel: false,
      confirmText: '知道了'
    });
  },

  /** 门槛说明 */
  onGateNote() {
    wx.showModal({
      title: '什么是上线门槛',
      content: '计数不符：线路上写的公司数与实际关联条数对不上，用户会看到「8 家公司」点进去只有 3 家。\n' +
        '孤立关联：关联指向的记录已被删除，属于查不到的垃圾数据。\n' +
        '空线路：线路存在但一家公司都没收录，搜出来是空页。\n\n' +
        '这三项不为 0 时不建议提审。',
      showCancel: false,
      confirmText: '知道了'
    });
  }
});
