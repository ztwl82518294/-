/**
 * 公告与优质线路推广位 —— 默认内容（单一来源）
 *
 * ★ 为什么单独一个文件，不写在 data/seed-data.js 里：
 *   这两份内容有**两个消费方**：
 *     1. seed-data.js —— 构建出 .data/*.jsonl 供云库导入、重建 admin/data/
 *     2. 小程序端 utils/db.js —— 云库还没建、或网络取不到时，用它当兜底展示
 *   若放在 seed-data.js，小程序端 require 它会连带把 40 家公司 / 55 条线路 /
 *   72 条关联全部打进小程序包体（这些数据小程序端根本用不上）。
 *   单独成文件，两端各引各的，内容只有一份。
 *
 * 字段定义见 shared/schema.js 的 ANNOUNCEMENT_FIELDS / FEATURED_ROUTE_FIELDS。
 * 这里刻意**不带时间戳**：createdAt / updatedAt 由 seed-data 统一按 BASE_TIME 补，
 * 避免两处各写一套时间口径。
 *
 * ★ 文案原则：
 *   1. 一条公告只讲一件事，一行能读完；
 *   2. 不写「为了更好的服务」这类空话，必须是对用户有实际用处的；
 *   3. link 只允许本小程序页面路径或空串 —— **外链一律不写**，
 *      小程序内跳外域要配业务域名，个人主体受限，写了就是点了没反应的死按钮。
 */

const DEFAULT_ANNOUNCEMENTS = [
  {
    id: 'ann_001', level: 'tip', enabled: true, sortOrder: 10,
    title: '目的地可以选到区县了',
    content: '选出发地或目的地时，先选城市，再选具体区县。例如北京可以选到朝阳区、通州区，' +
      '重庆可以选到渝中区、万州区。专线数据按城市收录，选了区县会按所属城市为你查找。',
    link: ''
  },
  {
    id: 'ann_002', level: 'info', enabled: true, sortOrder: 20,
    title: '信息有误？点「信息纠错」告诉我们',
    content: '如果发现电话打不通、公司已停业、线路已取消，可以在线路详情页或公司详情页' +
      '提交纠错。我们核实后会尽快更新。',
    link: ''
  },
  {
    id: 'ann_003', level: 'warning', enabled: true, sortOrder: 30,
    title: '本平台只做信息查询，不承运货物',
    content: '我们不收货、不承运、不代收货款，也不参与任何运输交易。' +
      '实际运价、时效、发车安排请在发货前电话直接与承运公司确认。',
    link: '/pages/disclaimer/index'
  },
  {
    id: 'ann_004', level: 'info', enabled: true, sortOrder: 40,
    title: '查过的线路会留在本地，方便下次找回',
    content: '本地缓存不会上传服务器，清除小程序缓存即会清空。',
    link: ''
  }
];

/**
 * 优质线路推广位
 *
 * ★ 只存「指向哪条线路 + 怎么包装」，**不复制线路本身的数据**。
 *   公司数、时效这类实时数据仍从 routes 现场读，
 *   否则会出现「推广位写 8 家公司、点进去只剩 3 家」的对不上。
 *
 * ★ routeKey 必须真实存在于 routes 表。test/suites/seed-data.test.js 有断言守着。
 */
const DEFAULT_FEATURED = [
  {
    id: 'feat_001', routeKey: '济南-广州', fromCity: '济南', toCity: '广州',
    tag: '天天发车', reason: '华南主线，多家公司直达，最快 2 天到',
    enabled: true, sortOrder: 10
  },
  {
    id: 'feat_002', routeKey: '济南-上海', fromCity: '济南', toCity: '上海',
    tag: '次日达', reason: '华东热门，隔天到达，支持上门提货',
    enabled: true, sortOrder: 20
  },
  {
    id: 'feat_003', routeKey: '济南-北京', fromCity: '济南', toCity: '北京',
    tag: '直达', reason: '京鲁直达，天天发车，1 天到',
    enabled: true, sortOrder: 30
  },
  {
    id: 'feat_004', routeKey: '济南-天津', fromCity: '济南', toCity: '天津',
    tag: '价格低', reason: '华北短途，重货单价低，当天装车',
    enabled: true, sortOrder: 40
  },
  {
    id: 'feat_005', routeKey: '济南-深圳', fromCity: '济南', toCity: '深圳',
    tag: '工作日发车', reason: '华南直达，3 天到，周末需预约',
    enabled: true, sortOrder: 50
  },
  {
    id: 'feat_006', routeKey: '济南-杭州', fromCity: '济南', toCity: '杭州',
    tag: '直达', reason: '长三角直达，2 天到，零担整车均可',
    enabled: true, sortOrder: 60
  }
];

module.exports = {
  DEFAULT_ANNOUNCEMENTS,
  DEFAULT_FEATURED
};
