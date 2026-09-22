/**
 * 后台管理 · 批量导入（两阶段：预览 → 确认）
 *
 * ★ 为什么必须两阶段：PRD C1 要求「明确标出错误行与原因，拒绝或跳过，
 *   不污染数据库」。粘贴完直接写库的话，第 3 行有个坏电话就会把整批搞脏，
 *   而且用户根本不知道哪里错了。
 *
 * ★ 预览阶段**一个字节都不写**，错误行带行号列出来，确认后只写通过的那些行
 *   ——「一行坏掉全批作废」是要避免的，不是要追求的。
 *
 * ★ 手机端没法上传文件，所以入口是「粘贴 CSV 文本」：
 *   电脑上用 Excel 存成 CSV，内容发到微信里，在手机上复制粘贴进来。
 *   模板可以直接复制到剪贴板，再粘贴到电脑上做成文件。
 *
 * ★ 解析与校验用的是 shared/import.js —— 与桌面后台、云函数**同一份**，
 *   不会出现「电脑上能导入、手机上不行」。
 */

const admin = require('../../../utils/admin');
const sharedImport = require('../../../shared/import');

/** 预览里最多列出多少条错误（太多看不过来，截图也截不全） */
const MAX_ERRORS_SHOWN = 20;

Page({
  data: {
    /** input | preview | done */
    stage: 'input',

    /** 粘贴进来的 CSV 文本 */
    text: '',

    /** 预览结果 */
    summary: { total: 0, validCount: 0, invalidCount: 0, newCompanies: 0, existingCompanies: 0, newRoutes: 0 },
    invalidRows: [],
    hiddenErrorCount: 0,

    /** 导入结果 */
    result: { created: 0, links: 0, updated: 0, failedCount: 0 },
    failedRows: [],

    /** 提交中（防重复提交） */
    submitting: false,
    /** 网络类失败（可重试） */
    loadError: false,
    errMessage: '',
    /** 没权限 / 没部署：给指引不给重试 */
    fatalMessage: ''
  },

  /* ============================================================
   * 输入
   * ============================================================ */

  onInputText(e) {
    this.setData({ text: e.detail.value || '' });
  },

  /** 从剪贴板读取（电脑发到微信里的 CSV 内容，复制后在这里一键粘进来） */
  onPaste() {
    wx.getClipboardData({
      success: (res) => {
        const t = (res && res.data) || '';
        if (!String(t).trim()) {
          wx.showToast({ title: '剪贴板是空的', icon: 'none' });
          return;
        }
        this.setData({ text: String(t) });
        wx.showToast({ title: '已粘贴', icon: 'none' });
      },
      fail: () => {
        wx.showToast({ title: '读取剪贴板失败', icon: 'none' });
      }
    });
  },

  /** 复制模板到剪贴板 */
  onCopyTemplate() {
    wx.setClipboardData({
      data: sharedImport.templateCsv(),
      success: () => {
        wx.showToast({ title: '模板已复制', icon: 'none' });
      }
    });
  },

  /** 看模板长什么样（不复制，只是看一眼表头） */
  onViewTemplate() {
    const labels = sharedImport.FIELD_LABELS.map((f) => f.label).join('、');
    wx.showModal({
      title: 'CSV 表头',
      content: '一行一条，第一行为表头。支持的表头有：\n' + labels +
        '\n\n顺序不强制，也允许常见的中文别名；最少要有「公司全称 / 出发城市 / 到达城市」三列。',
      showCancel: false,
      confirmText: '知道了'
    });
  },

  /* ============================================================
   * 阶段 1：预览
   * ============================================================ */

  onPreview() {
    if (this.data.submitting) return;
    const text = String(this.data.text || '').trim();
    if (!text) {
      wx.showToast({ title: '请填写 CSV 内容（可点右上角从剪贴板粘贴）', icon: 'none' });
      return;
    }
    this.setData({ submitting: true });
    this.doPreview(text);
  },

  async doPreview(text) {
    const r = await admin.importPreview(text);
    this.setData({ submitting: false });

    if (!r.ok) {
      if (admin.isFatal(r.code)) this.setData({ fatalMessage: r.message || '没有后台权限' });
      else this.setData({ loadError: true, errMessage: r.message || '预览失败' });
      return;
    }

    const invalid = r.invalid || [];
    this.setData({
      stage: 'preview',
      summary: r.summary || this.data.summary,
      invalidRows: invalid.slice(0, MAX_ERRORS_SHOWN),
      hiddenErrorCount: invalid.length > MAX_ERRORS_SHOWN ? invalid.length - MAX_ERRORS_SHOWN : 0,
      loadError: false,
      errMessage: ''
    });
  },

  /* ============================================================
   * 阶段 2：确认导入
   * ============================================================ */

  onCommit() {
    if (this.data.submitting) return;
    const s = this.data.summary || {};
    const okCount = Number(s.validCount) || 0;
    if (!okCount) {
      wx.showToast({ title: '没有可导入的数据', icon: 'none' });
      return;
    }

    const bad = Number(s.invalidCount) || 0;
    const content = bad
      ? '将导入 ' + okCount + ' 行，跳过 ' + bad + ' 行有问题的数据（原因已在预览里列出）。导入后不可撤销，确定继续？'
      : '将导入 ' + okCount + ' 行。导入后不可撤销，确定继续？';

    wx.showModal({
      title: '确认导入',
      content: content,
      confirmText: '导入',
      cancelText: '再看看',
      success: (r) => {
        if (!r.confirm) return;
        this.setData({ submitting: true });
        this.doCommit();
      }
    });
  },

  async doCommit() {
    const r = await admin.importCommit(String(this.data.text || ''));
    this.setData({ submitting: false });

    if (!r.ok) {
      if (admin.isFatal(r.code)) this.setData({ fatalMessage: r.message || '没有后台权限' });
      else this.setData({ loadError: true, errMessage: r.message || '导入失败' });
      return;
    }

    const res = r.result || {};
    const failed = res.failed || [];
    this.setData({
      stage: 'done',
      result: {
        created: res.created || 0,
        links: res.links || 0,
        updated: res.updated || 0,
        failedCount: failed.length
      },
      failedRows: failed.slice(0, MAX_ERRORS_SHOWN),
      loadError: false,
      errMessage: ''
    });
  },

  /* ============================================================
   * 导航
   * ============================================================ */

  /** 回输入态（改一改再导） */
  onBackToInput() {
    this.setData({ stage: 'input', loadError: false, errMessage: '' });
  },

  /** 导入完成后回后台首页 */
  onFinish() {
    wx.navigateBack({ delta: 1 });
  },

  onRetry() {
    this.setData({ loadError: false, errMessage: '' });
  }
});
