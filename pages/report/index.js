// pages/report/index.js
// 信息纠错反馈表单（取代原先"弹框 → 引导去打电话/加微信"的旧流程）。
//
// 旧流程的问题：用户在专线详情页发现问题时，要跳出小程序、切到电话/微信 App，
// 摩擦太大，实际几乎不会有人反馈。改为站内表单后，几步就能提交完。
//
// 入口有两个（都带参进来，页面不自己查库）：
//   /pages/report/index?kind=line&key=<线路_id>&name=<公司名>
//   /pages/report/index?kind=company&key=<公司名>&name=<公司名>
// 参数只用于"你要反馈的信息"这一条提示与写入时的定位字段，
// **不参与任何权限判断**，也不影响页面可用性（缺参时提示条整块隐藏）。
//
// 提交走 reportFeedback 云函数（服务端再校验一次 + 频控），前端校验只为体验。

const ui = require('../../utils/ui.js');

// 问题类型：与云函数 reportFeedback 的 TYPES 白名单**必须一一对应**。
// 前端传 key，label 由服务端反查——前端只管展示。
const TYPES = [
  { key: 'phone', label: '电话有误' },
  { key: 'closed', label: '公司已停业' },
  { key: 'cancelled', label: '线路已取消' },
  { key: 'incomplete', label: '信息不完整' },
  { key: 'other', label: '其他' }
];

const DETAIL_MAX = 200;   // 与 WXML textarea 的 maxlength 一致
const IMAGE_MAX = 3;      // 与参考图"最多 3 张"一致
const CONTACT_MAX = 60;

function safeDecode(s) {
  if (!s) return '';
  try {
    return decodeURIComponent(s);
  } catch (e) {
    return s;
  }
}

Page({
  data: {
    types: TYPES,
    typeKey: '',            // 选中的类型 key
    detail: '',
    detailLen: 0,
    detailMax: DETAIL_MAX,
    images: [],             // 云存储 fileID 数组
    imageMax: IMAGE_MAX,
    contact: '',
    contactMax: CONTACT_MAX,
    submitting: false,
    // 被反馈对象（提示条用；拿不到就整块不渲染，不留空条）
    targetName: '',
    targetKind: 'line',
    targetKey: ''
  },

  onLoad(options) {
    const kind = options.kind === 'company' ? 'company' : 'line';
    const key = safeDecode(options.key);
    const name = safeDecode(options.name);
    // 只填有值的项：名称为空时提示条整体隐藏（wx:if 判 targetName）
    this.setData({
      targetKind: kind,
      targetKey: key,
      targetName: name
    });
  },

  // 选中问题类型（单选：再点一次取消，便于误触后纠正）
  onPickType(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ typeKey: this.data.typeKey === key ? '' : key });
  },

  // 具体说明：同步字数，供右下角 0/200 计数
  onInputDetail(e) {
    const v = e.detail.value || '';
    this.setData({ detail: v, detailLen: v.length });
  },

  onInputContact(e) {
    this.setData({ contact: e.detail.value || '' });
  },

  // 上传凭证：选图 → 上传云存储 → 存 fileID。
  // 为什么压缩：微信原图动辄 3~5MB，反馈图只是给人工看"哪里错了"，
  // 压缩到 80% 清晰度足够辨认，能显著减少上传耗时与存储占用。
  onAddImage() {
    const rest = IMAGE_MAX - this.data.images.length;
    if (rest <= 0) return wx.showToast({ title: `最多上传 ${IMAGE_MAX} 张`, icon: 'none' });
    wx.chooseMedia({
      count: rest,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: res => {
        const files = (res.tempFiles || []).map(f => f.tempFilePath).filter(Boolean);
        if (!files.length) return;
        this.uploadAll(files);
      }
    });
  },

  // 逐张上传（串行）：并发上传多张会让弱网下的失败原因难以归因，
  // 且反馈场景一次最多 3 张，串行的总耗时差异可以忽略。
  uploadAll(files) {
    wx.showLoading({ title: '上传中...', mask: true });
    const uploaded = [];
    const fail = () => {
      wx.hideLoading();
      // 部分成功也保留：已经传上去的图不该因为后面一张失败而全丢
      if (uploaded.length) this.setData({ images: this.data.images.concat(uploaded) });
      ui.error('图片上传失败，可稍后重试或直接提交文字说明');
    };
    const next = i => {
      if (i >= files.length) {
        wx.hideLoading();
        this.setData({ images: this.data.images.concat(uploaded) });
        return;
      }
      const path = files[i];
      const ext = (path.match(/\.(\w+)$/) || [])[1] || 'jpg';
      // 路径带日期与随机串：避免同一毫秒内多张图覆盖同名文件
      const name = `feedback/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      wx.cloud.uploadFile({
        cloudPath: name,
        filePath: path,
        success: r => { if (r && r.fileID) uploaded.push(r.fileID); next(i + 1); },
        fail
      });
    };
    next(0);
  },

  // 预览已上传的图（大图查看，确认没传错）
  onPreviewImage(e) {
    const idx = Number(e.currentTarget.dataset.index) || 0;
    wx.previewImage({ current: this.data.images[idx], urls: this.data.images });
  },

  onRemoveImage(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const images = this.data.images.slice();
    const removed = images.splice(idx, 1)[0];
    this.setData({ images });
    // 顺手删掉云存储文件，避免用户删图后空间仍被占用、后台也看不到"废图"
    if (removed) wx.cloud.deleteFile({ fileList: [removed] }).catch(() => {});
  },

  submit() {
    const { typeKey, detail, images, contact, targetName, targetKind, targetKey } = this.data;

    if (!typeKey) return wx.showToast({ title: '请选择问题类型', icon: 'none' });
    if (!detail.trim()) return wx.showToast({ title: '请填写具体说明', icon: 'none' });

    // 防重复提交：连点会写入多条相同反馈，后台核实时要逐条排除
    if (!ui.lock(this, 'submit', false)) return;
    this.setData({ submitting: true });

    wx.cloud.callFunction({
      name: 'reportFeedback',
      data: {
        action: 'submit',
        type: typeKey,
        detail: detail.trim(),
        images: images,
        contact: contact.trim(),
        target: targetName,
        targetKind: targetKind,
        targetKey: targetKey
      }
    }).then(res => {
      const r = (res && res.result) || {};
      if (!r.ok) throw new Error(r.error || '提交失败，请稍后重试');
      return r;
    }).then(() => {
      this.setData({ submitting: false });
      wx.showModal({
        title: '提交成功',
        content: '感谢反馈！我们会人工核实，核实通过后才会修改信息。',
        showCancel: false,
        confirmText: '我知道了',
        success: () => this.goBack()
      });
    }).catch(err => {
      this.setData({ submitting: false });
      const msg = (err && err.message) || '';
      // 云函数未部署时给出可操作的提示，避免用户以为是网络问题反复重试
      if (/not found|FUNCTION_NOT_FOUND|-501000/i.test(msg) || !msg) {
        return ui.notDeployed('reportFeedback');
      }
      ui.error(msg);
    }).then(() => ui.unlock(this, 'submit'));
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) });
  },

  onShareAppMessage() {
    return { title: '物流专线查询', path: '/pages/index/index' };
  }
});
