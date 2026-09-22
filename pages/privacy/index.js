/**
 * 用户信息处理规则（隐私政策）页（PRD 贯穿性要求 1 + 验收 A10/A12）
 *
 * 内容是 utils/privacy.js 的 PRIVACY_TEXT，与弹窗同源 —— 单一来源，
 * 避免弹窗说一套、正式页面说另一套（这是合规检查的常见扣分点）。
 */

const { PRIVACY_TEXT, PRIVACY_APIS, CONTACT } = require('../../utils/privacy');

Page({
  data: {
    title: PRIVACY_TEXT.title,
    intro: PRIVACY_TEXT.intro,
    items: PRIVACY_TEXT.items,
    footer: PRIVACY_TEXT.footer,
    /** 隐私接口清单：逐个写明接口名与在人能看懂的地方写明的用途 */
    apis: PRIVACY_APIS,
    operator: CONTACT.operator,
    subjectType: CONTACT.subjectType,
    phone: CONTACT.phone,
    wechat: CONTACT.wechat,
    updatedAt: '2026-09-19'
  },

  /** 拨号联系运营方 */
  onCall() {
    wx.makePhoneCall({ phoneNumber: this.data.phone });
  },

  /** 复制微信号 */
  onCopyWechat() {
    wx.setClipboardData({
      data: this.data.wechat,
      success: () => wx.showToast({ title: '微信号已复制', icon: 'none' })
    });
  }
});
