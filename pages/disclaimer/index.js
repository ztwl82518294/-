/**
 * 免责声明页（PRD 贯穿性要求 3 + 验收 A9）
 *
 * 信息由公开渠道整理，仅供参考，请自行核实 —— 可挡掉大量纠纷。
 * 这是 PRD 三阶段「贯穿三条硬约束」之一，属于 P0，不可延后。
 */

const { DISCLAIMER_TEXT, CONTACT } = require('../../utils/privacy');

Page({
  data: {
    title: DISCLAIMER_TEXT.title,
    paragraphs: DISCLAIMER_TEXT.paragraphs,
    operator: CONTACT.operator,
    subjectType: CONTACT.subjectType,
    phone: CONTACT.phone,
    wechat: CONTACT.wechat,
    note: CONTACT.note,
    updatedAt: '2026-09-19'
  },

  onCall() {
    wx.makePhoneCall({ phoneNumber: this.data.phone });
  },

  onCopyWechat() {
    wx.setClipboardData({
      data: this.data.wechat,
      success: () => wx.showToast({ title: '微信号已复制', icon: 'none' })
    });
  },

  /** 去纠错页（不带上下文，通用反馈） */
  goCorrection() {
    wx.navigateTo({ url: '/pages/correction/index?targetType=other&targetId=&summary=' });
  }
});
