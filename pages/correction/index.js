/**
 * 数据纠错（PRD 模块 05）
 *
 * 解决「我看到电话是错的，想告诉你」。这是数据质量的闭环保障。
 *
 * 功能清单（PRD）：
 *   - ★ 从任意信息页触发，**自动携带当前记录的上下文**（不需要用户重新描述是哪条）
 *   - 纠错类型：电话有误 / 公司已停业 / 线路已取消 / 信息不完整 / 其他
 *   - 支持上传凭证截图（营业执照、聊天记录等）
 *   - 可选留联系方式（便于回访核实）
 *   - 提交后提示「已收到，我们会核实」，★ 不做即时生效
 *   - ★ 限频：同一用户对同一条记录设提交次数上限，防恶意刷
 *
 * ★ 限频是双层的：
 *   前端在 utils/correction.js 里按 targetId 记次数（即时反馈，省一次网络往返）；
 *   服务端在 cloudfunctions/submitCorrection 里按 openid + target 计数（真防线）。
 *   前端限频只是为了体验，绝不能当成安全机制。
 */

const { CORRECTION_TYPES } = require('../../shared/schema');
const { PRIVACY_APIS } = require('../../utils/privacy');
const correction = require('../../utils/correction');
const params = require('../../utils/params');

const DETAIL_MAX = 300;
const CONTACT_MAX = 60;
const IMAGE_MAX = 3;

Page({
  data: {
    /* 上下文（由触发页带入） */
    targetType: '',
    targetId: '',
    targetSummary: '',

    /* 表单 */
    types: CORRECTION_TYPES,
    typeIndex: -1,
    detail: '',
    detailLen: 0,
    detailMax: DETAIL_MAX,
    contact: '',
    contactMax: CONTACT_MAX,
    images: [],
    imageMax: IMAGE_MAX,

    /* 提交状态 */
    submitting: false,
    uploaded: 0,
    uploading: false
  },

  onLoad(options) {
    const o = options || {};
    // 用 params.safeDecode 而不是裸 decodeURIComponent：
    // onLoad 的 options 已被框架解过码，二次解码遇到脏数据（含 % 的城市名）会抛错白屏
    const targetType = params.safeDecode(o.targetType);
    const targetId = params.safeDecode(o.targetId);
    const targetSummary = params.safeDecode(o.summary);

    // 前置校验：缺目标的（例如从别处误入）仍允许提交，但提示补充说明
    this.setData({
      targetType: targetType || 'other',
      targetId: targetId,
      targetSummary: targetSummary
    });

    if (targetSummary) {
      wx.setNavigationBarTitle({ title: '信息纠错' });
    }
  },

  /* ============================================================
   * 表单交互
   * ============================================================ */

  /** 选择问题类型（再次点击可取消） */
  onPickType(e) {
    const idx = Number(e.currentTarget.dataset.index);
    this.setData({ typeIndex: this.data.typeIndex === idx ? -1 : idx });
  },

  onInputDetail(e) {
    const v = e.detail.value || '';
    this.setData({ detail: v, detailLen: v.length });
  },

  onInputContact(e) {
    this.setData({ contact: e.detail.value || '' });
  },

  /* ============================================================
   * 凭证上传
   * ============================================================ */

  onAddImage() {
    const remain = IMAGE_MAX - this.data.images.length;
    if (remain <= 0) {
      wx.showToast({ title: '最多上传 ' + IMAGE_MAX + ' 张', icon: 'none' });
      return;
    }

    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        const files = (res.tempFiles || []).map((f) => f.tempFilePath).filter(Boolean);
        if (files.length) this.uploadAll(files);
      },
      fail: (err) => {
        // 用户主动取消不算错误，不提示
        const msg = (err && err.errMsg) || '';
        if (/cancel/i.test(msg)) return;
        wx.showToast({ title: '选择图片失败', icon: 'none' });
      }
    });
  },

  /**
   * 串行上传（不用 Promise.all）
   *
   * 理由：并发上传容易触发云存储的频控，且失败时难以归因是哪张图。
   * 串行慢一点但可控，且**部分成功也保留**——不让用户因为一张图失败而重填整表。
   */
  async uploadAll(files) {
    this.setData({ uploading: true });

    const app = getApp();
    if (!app || !app.globalData.cloudReady) {
      this.setData({ uploading: false });
      wx.showToast({ title: '云环境未就绪，暂不能上传', icon: 'none' });
      return;
    }

    const done = [];
    for (let i = 0; i < files.length; i++) {
      const path = files[i];
      const ext = (path.match(/\.([a-zA-Z0-9]+)$/) || [, 'jpg'])[1];
      const name = 'corrections/' + correction.todayPath() + '/' +
        Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.' + ext;
      try {
        const res = await new Promise((resolve, reject) => {
          wx.cloud.uploadFile({ cloudPath: name, filePath: path, success: resolve, fail: reject });
        });
        if (res && res.fileID) done.push(res.fileID);
      } catch (e) {
        // 单张失败：继续传下一张，最后统一提示
      }
    }

    const images = this.data.images.concat(done).slice(0, IMAGE_MAX);
    this.setData({ uploading: false, images, uploaded: done.length });

    if (done.length < files.length) {
      wx.showToast({ title: '部分图片上传失败，可稍后重试', icon: 'none' });
    }
  },

  onPreviewImage(e) {
    const idx = Number(e.currentTarget.dataset.index);
    wx.previewImage({ current: this.data.images[idx], urls: this.data.images });
  },

  onRemoveImage(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const url = this.data.images[idx];
    const images = this.data.images.slice();
    images.splice(idx, 1);
    this.setData({ images });
    // 顺手删云端文件，避免留垃圾（失败不影响本地列表）
    if (url && wx.cloud && wx.cloud.deleteFile) {
      wx.cloud.deleteFile({ fileList: [url] }).catch(() => {});
    }
  },

  /* ============================================================
   * 提交
   * ============================================================ */

  async onSubmit() {
    if (this.data.submitting) return;

    const type = this.data.typeIndex >= 0 ? this.data.types[this.data.typeIndex] : null;
    if (!type) {
      wx.showToast({ title: '请选择问题类型', icon: 'none' });
      return;
    }

    const detail = String(this.data.detail || '').trim();
    if (!detail) {
      wx.showToast({ title: '请填写具体说明', icon: 'none' });
      return;
    }

    // 前端限频（体验层，真防线在服务端）
    const guard = correction.checkLocalLimit(this.data.targetId);
    if (!guard.ok) {
      wx.showModal({
        title: '提交过于频繁',
        content: '您对这条记录已提交过 ' + guard.count + ' 次，我们会尽快核实。如有补充信息，请稍后再试。',
        showCancel: false,
        confirmText: '知道了'
      });
      return;
    }

    this.setData({ submitting: true });

    try {
      const res = await wx.cloud.callFunction({
        name: 'submitCorrection',
        data: {
          action: 'submit',
          targetType: this.data.targetType,
          targetId: this.data.targetId,
          targetSummary: this.data.targetSummary,
          type: type.value,
          content: detail,
          images: this.data.images,
          contact: String(this.data.contact || '').trim()
        }
      });

      const r = (res && res.result) || {};

      if (r.ok === false) {
        this.setData({ submitting: false });
        if (r.code === 'RATE_LIMITED') {
          wx.showModal({
            title: '提交过于频繁',
            content: r.message || '您对这条记录提交次数已达上限，我们会尽快核实。',
            showCancel: false,
            confirmText: '知道了'
          });
        } else {
          wx.showToast({ title: r.message || '提交失败，请稍后重试', icon: 'none' });
        }
        return;
      }

      // 记一次本地次数，用于前端即时反馈
      correction.markLocalSubmitted(this.data.targetId);
      this.setData({ submitting: false });

      wx.showModal({
        title: '已收到您的反馈',
        content: '感谢反馈！我们会尽快核实并修正。信息不会立即生效，核实后统一更新。',
        showCancel: false,
        confirmText: '好',
        success: () => wx.navigateBack({ delta: 1 })
      });
    } catch (e) {
      this.setData({ submitting: false });
      const msg = (e && (e.errMsg || e.message)) || '';
      if (/not found|FUNCTION_NOT_FOUND|-501000/i.test(msg)) {
        wx.showModal({
          title: '功能尚未启用',
          content: '纠错提交的云函数尚未部署，请联系运营方完成部署后重试。',
          showCancel: false
        });
      } else {
        wx.showToast({ title: '网络异常，请稍后重试', icon: 'none' });
      }
    }
  },

  /** 展示凭证上传的用途说明（合规：在人能看懂的地方写明用途） */
  onImageNote() {
    const item = PRIVACY_APIS[0];
    wx.showModal({
      title: '关于上传凭证',
      content: (item && item.purpose) || '仅用于核实信息。',
      showCancel: false,
      confirmText: '知道了'
    });
  }
});
