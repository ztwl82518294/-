/**
 * 隐私协议弹窗组件（PRD 贯穿性要求 1 + 验收 A10）
 *
 * 首次进入小程序时展示。用户必须点击「同意」才能继续使用，
 * 拒绝则提示无法使用并停留在当前状态。
 *
 * ★ 合规要点：
 *   - 文案必须说明实际使用的接口与用途，不得笼统写「为了更好的服务」
 *   - 必须提供《用户信息处理规则》入口（指向 pages/privacy）
 *   - 同意后写入本地存储，不再重复弹出（由 utils/privacy.js 提供读写）
 */

const { PRIVACY_TEXT, hasAgreed, markAgreed } = require('../../utils/privacy');

Component({
  properties: {
    /** 是否强制展示（调试或重新同意时用） */
    force: {
      type: Boolean,
      value: false
    }
  },

  data: {
    visible: false,
    title: PRIVACY_TEXT.title,
    intro: PRIVACY_TEXT.intro,
    items: PRIVACY_TEXT.items,
    footer: PRIVACY_TEXT.footer
  },

  lifetimes: {
    attached() {
      if (this.properties.force || !hasAgreed()) {
        this.setData({ visible: true });
      }
    }
  },

  methods: {
    /** 同意：落本地存储 + 抛事件给宿主页面 */
    onAgree() {
      markAgreed();
      this.setData({ visible: false });
      this.triggerEvent('agree');
    },

    /**
     * 拒绝：**必须 setData 关掉弹窗**，否则整屏遮罩留在 DOM 里，
     * 会把宿主页面所有按钮的点击全部吃掉 —— 表现为「点哪都没反应」（真实踩过）。
     *
     * 合规上「拒绝」不等于「可以继续用」：这里关掉弹窗只是让用户能看到页面，
     * 不写同意标记，下次进入仍会再弹；真正的功能限制由宿主页面按需决定。
     * 遮罩本身「点一下即拒」也是合规常见做法（用户已知晓并选择不同意）。
     */
    onReject() {
      this.setData({ visible: false });
      this.triggerEvent('reject');
      wx.showToast({ title: '需同意后才能使用查询功能', icon: 'none', duration: 2000 });
    },

    /** 查看完整的《用户信息处理规则》 */
    onOpenDetail() {
      wx.navigateTo({ url: '/pages/privacy/index' });
    },

    /** 吞掉遮罩点击，防穿透（遮罩点击走 onReject，这里保留给面板内空白区） */
    noop() {}
  }
});
