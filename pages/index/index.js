/**
 * 首页总览（PRD 模块 01 + 验收 A3）
 *
 * 首页要回答一个问题：「你这小程序是干嘛的，我怎么用」。用户要在 3 秒内明白。
 *
 * 五个区块（从上到下）：
 *   1. 天空大卡 —— 品牌 + 搜索（macOS 天气 App 的顶部信息卡：大圆角、大号标题、信息分层）
 *   2. 公告栏   —— 垂直滚动播，点开看全文
 *   3. 优质线路 —— 横向卡片流，每卡一个显著数字（有几家公司在跑）
 *   4. 我要发货 —— 通栏入口
 *   5. 底部公示 —— 免责声明入口 + 数据更新时间说明 + 隐私政策入口（合规必需）
 *
 * ★ 2026-09-22 改版（用户明确要求）：
 *   - 删掉「热门专线」「最近更新线路」「我知道公司名看他跑那些线路」三块。
 *     理由：首页该做的是「帮我找到能打电话的公司」，这三块要么和搜索重复
 *     （热门专线 = 搜索的高频结果），要么是运营自嗨（最近更新对用户无决策价值）。
 *   - 换成「公告栏 + 优质线路推广」：前者传递平台状态，后者给不知道查什么的用户一个起点。
 *
 * ★ 视觉融合：macOS 天气 App 的「大圆角 + 大号数字 + 信息分层」融进 Notion 扁平风格。
 *   全站唯一放开低饱和渐变的地方是 .sky（用户确认）。
 *   **字体一律纯色实底，不做毛玻璃（无 backdrop-filter / 无 filter: blur / 无半透明字）**，
 *   由 scripts/check-project.js 第 6 类检查强制校验。
 */

const db = require('../../utils/db');
const common = require('../../utils/common');
const { detectKeywordType } = require('../../utils/search');
const { CITIES } = require('../../data/cities');
const { searchPlaces } = require('../../utils/area');
const { DISCLAIMER_TEXT, CONTACT } = require('../../utils/privacy');

/** 公告栏最多取几条（滚动播，太多也没人看完） */
const ANNOUNCE_LIMIT = 10;
/** 优质线路最多取几条（横向卡片流） */
const FEATURED_LIMIT = 10;

Page({
  data: {
    keyword: '',

    /** 公告：[{ _id, title, content, level, link }] */
    announcements: [],

    /** 优质线路推广：[{ _id, routeKey, fromCity, toCity, tag, reason, companyCount }] */
    featured: [],
    /** 推广位加载中（只有这一块需要 loading：公告有内置兜底，不会空） */
    featLoading: true,
    /** 推广位加载失败（可重试） */
    featError: false,

    /** 数据更新时间说明（底部公示用） */
    dataUpdatedText: '',
    /** 免责声明摘要（首页直接展示一句，无需点进去） */
    disclaimerBrief: '',
    operator: CONTACT.operator
  },

  onLoad() {
    this.setData({
      disclaimerBrief: DISCLAIMER_TEXT.paragraphs[0].desc
    });
    this.loadAll();
  },

  onPullDownRefresh() {
    this.loadAll().then(() => wx.stopPullDownRefresh());
  },

  /**
   * 拉齐首页两块运营内容
   *
   * ★ 两块**独立降级**：公告取不到会用内置内容兜底（utils/db.js 里实现），
   *   所以公告不会失败；推广位取不到才展示失败态。
   *   不要把两块绑成一个「全成功才算成功」——公告永远成功，绑了等于没绑，
   *   反而会让推广位的失败被悄悄吞掉。
   */
  async loadAll() {
    this.setData({ featLoading: true, featError: false });

    /*
     * ★★ 不要写成数组解构 `const [a, f] = await Promise.all([...])`。
     *   开发者工具开了「增强编译」（project.config.json 的 enhance:true）时用 SWC 编译，
     *   数组解构会被编译成对 @swc/runtime 的 require：
     *     module '@swc/runtime/_array_with_holes.js' is not defined
     *   而本环境没装这个包 ⇒ **整个页面直接白屏**。（2026-09-22 真机踩过）
     *   ⇒ 小程序端一律用下标取值，别用数组解构 / 对象展开 / 数组展开 / for...of。
     */
    const res = await Promise.all([
      db.listAnnouncements(ANNOUNCE_LIMIT).catch(() => null),
      db.listFeaturedRoutes(FEATURED_LIMIT).catch(() => null)
    ]);

    const ann = res[0] || { ok: false, data: [] };
    const feat = res[1] || { ok: false, data: [] };

    const announcements = (ann.data || []).filter((x) => !!x.title);
    const rows = feat.data || [];

    /*
     * 推广位指向的线路已被删除时，云库路径下直接跳过 —— 点进去是空页比不显示更糟。
     * 兜底路径不跳：兜底本来就是「云库完全不可用」的场景，
     * 那时候 route 一定是 null，全跳就没东西可看了。
     */
    const featured = rows.filter((x) => {
      if (!x.routeKey) return false;
      if (feat.source === 'cloud' && !x.route) return false;
      return true;
    });

    // 数据更新时间：取推广位里最新的那条线路的时间（它能代表线路库的更新频率）
    let latest = 0;
    featured.forEach((x) => {
      const t = Number(x.route && x.route.updatedAt) || 0;
      if (t > latest) latest = t;
    });

    this.setData({
      announcements: announcements,
      featured: featured,
      featLoading: false,
      /*
       * ★ 只有「真的取不到」且「兜底也没东西」才算失败。
       *   utils/db.js 在云库取不到时会退回内置推广位（ok:false 但 data 非空），
       *   这时候页面有东西可看，弹「加载失败」反而把好数据说成异常。
       */
      featError: !feat.ok && featured.length === 0,
      dataUpdatedText: latest
        ? '数据最近更新于 ' + common.formatDate(latest)
        : '数据持续更新中'
    });
  },

  /** 推广位加载失败重试 */
  onRetryLoad() {
    this.loadAll();
  },

  /* ============================================================
   * 区块 1：搜索框
   * ============================================================ */

  onSearchInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  /**
   * 搜索提交：自动判断关键词类型
   *   company → 跳到查公司
   *   city    → 跳到查专线（把它当出发地）
   *   both    → 跳查专线（城市优先，因为城市搜索的确定性更高）
   *
   * ★ 用 searchPlaces 而不是只搜城市：用户输入「朝阳」时要的是朝阳区，
   *   只搜城市一条都搜不到，用户会以为「没有这个地方」。
   */
  async onSearchConfirm() {
    const kw = String(this.data.keyword || '').trim();
    if (!kw) {
      wx.showToast({ title: '请输入城市或公司名', icon: 'none' });
      return;
    }

    if (detectKeywordType(kw, CITIES) === 'company') {
      this.gotoCompanyTab(kw);
      return;
    }

    const hit = searchPlaces(kw, 1)[0];
    if (hit) {
      /*
       * ★ 命中区县时，查询按它所属的**城市**走（专线数据按城市收录），
       *   区县只是让「发到哪儿」说得更清楚。这就是 utils/area.js 里那句
       *   「区县只影响展示，不影响查询」。
       */
      this.gotoAddressTab(hit.city, '', hit.area, '');
      return;
    }

    // 既不像城市也不是公司：仍给一次公司搜索的机会，避免用户以为没反应
    this.gotoCompanyTab(kw);
  },

  /* ============================================================
   * 区块 2：公告栏
   * ============================================================ */

  /**
   * 点公告：弹全文
   *
   * ★ link 必须是本小程序页面路径（/pages/...）才给「查看详情」，
   *   外链一律不跳 —— 小程序内跳外域要配业务域名，个人主体受限，
   *   写了就是点了没反应的死按钮。
   */
  onNoticeTap(e) {
    const i = Number(e.currentTarget.dataset.index);
    const item = this.data.announcements[i];
    if (!item) return;

    const title = String(item.title || '公告');
    const content = String(item.content || '').trim();
    const link = String(item.link || '');
    const canJump = link.charAt(0) === '/';

    if (!canJump) {
      wx.showModal({
        title: title,
        content: content || title,
        showCancel: false,
        confirmText: '知道了'
      });
      return;
    }

    wx.showModal({
      title: title,
      content: content || title,
      confirmText: '查看详情',
      cancelText: '关闭',
      success: (r) => {
        if (!r.confirm) return;
        wx.navigateTo({
          url: link,
          fail: () => {
            wx.showToast({ title: '页面打开失败，请重试', icon: 'none' });
          }
        });
      }
    });
  },

  /* ============================================================
   * 区块 3：优质线路推广
   * ============================================================ */

  onFeatTap(e) {
    const routeKey = e.currentTarget.dataset.key;
    if (!routeKey) return;
    wx.navigateTo({
      url: '/pages/route-detail/index?key=' + encodeURIComponent(routeKey),
      fail: () => {
        wx.showToast({ title: '页面打开失败，请重试', icon: 'none' });
      }
    });
  },

  /* ============================================================
   * 区块 4：我要发货
   * ============================================================ */

  goShip() {
    wx.switchTab({ url: '/pages/search-by-address/index' });
  },

  /* ============================================================
   * 区块 5：底部公示
   * ============================================================ */

  goDisclaimer() {
    wx.navigateTo({ url: '/pages/disclaimer/index' });
  },

  goPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/index' });
  },

  /* ============================================================
   * 跨 Tab 传参
   * ============================================================ */

  /**
   * 跳「查专线」并带上出发地/目的地（含区县）
   *
   * @param {string} from      出发城市
   * @param {string} to        到达城市
   * @param {string} fromArea  出发区县（可空）
   * @param {string} toArea    到达区县（可空）
   */
  gotoAddressTab(from, to, fromArea, toArea) {
    const app = getApp();
    if (app && app.setPendingAddressQuery) {
      app.setPendingAddressQuery(from, to, fromArea, toArea);
    }
    wx.switchTab({ url: '/pages/search-by-address/index' });
  },

  /** 跳「查公司」并带上关键词 */
  gotoCompanyTab(kw) {
    const app = getApp();
    if (app && app.setPendingCompanyKeyword) app.setPendingCompanyKeyword(kw);
    wx.switchTab({ url: '/pages/search-by-company/index' });
  }
});
