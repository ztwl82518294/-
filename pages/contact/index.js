// pages/contact/index.js
// 联系客服：在线客服会话 / 电话 / 微信号复制 / 二维码长按识别
const contact = require('../../utils/contact.js');

Page({
  data: {
    info: contact
  },

  // 拨打电话
  callPhone() {
    if (!contact.phone) return;
    wx.makePhoneCall({ phoneNumber: contact.phone });
  },

  // 复制微信号
  copyWechat() {
    if (!contact.wechat) return;
    wx.setClipboardData({
      data: contact.wechat,
      success: () => wx.showModal({
        title: '微信号已复制',
        content: `微信号：${contact.wechat}\n请打开微信 → 右上角 + → 添加朋友 → 粘贴搜索`,
        showCancel: false,
        confirmText: '我知道了'
      })
    });
  },

  // 预览二维码（可长按识别/保存，微信原生能力，不加多余按钮）
  previewQR() {
    if (!contact.qrcodeFileID) return;
    wx.previewImage({ urls: [contact.qrcodeFileID] });
  }
});
