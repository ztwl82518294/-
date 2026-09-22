/**
 * 数据表字段定义 —— 小程序端与后台端共用同一份定义
 *
 * 目的：避免两端字段名不一致导致的数据写入异常。
 * 本文件是六表模型的唯一契约来源，任何一侧新增字段都必须先改这里。
 *
 * 六张表（PRD 附录「数据表结构」）：
 *   companies        公司表
 *   routes           线路表（枢纽）
 *   route_companies  关联表（多对多，承载线路属性）
 *   cities           城市字典
 *   corrections      纠错表
 *   admins           管理员
 *
 * ★ 关键设计取舍：时效（transitDays）/ 是否直达（isDirect）/ 发车频率（frequency）
 *   必须放在 route_companies 而非 companies 或 routes。
 *   同一家公司跑济南→广州 2 天、跑济南→乌鲁木齐 5 天，塞进任何一端都是错的。
 */

const COLLECTIONS = {
  COMPANIES: 'companies',
  ROUTES: 'routes',
  ROUTE_COMPANIES: 'route_companies',
  CITIES: 'cities',
  CORRECTIONS: 'corrections',
  ADMINS: 'admins'
};

const COMPANY_FIELDS = {
  _id: '_id',
  name: 'name',                 // 全称
  shortName: 'shortName',       // 简称
  initial: 'initial',           // 首字母（搜索用）
  pinyin: 'pinyin',             // 全拼（搜索用）
  phone: 'phone',               // 主电话
  backupPhone: 'backupPhone',   // 备用电话
  address: 'address',           // 总部地址
  city: 'city',                 // 所在城市
  province: 'province',         // 所在省
  scale: 'scale',               // 规模 small/medium/large
  intro: 'intro',               // 简介
  verified: 'verified',         // 是否已核实
  // 发站 / 到站：一个公司可有多个站点，每个站点「地址 + 电话」一一对应
  // 结构：[{ address: '济南市…', phone: '0531-…' }]
  departureStations: 'departureStations',
  arrivalStations: 'arrivalStations',
  viewCount: 'viewCount',       // 浏览量，详情页每打开一次 +1
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

/** 站点字段（发站 / 到站）—— 地址与电话一一对应 */
const STATION_FIELDS = {
  address: 'address',
  phone: 'phone'
};

const ROUTE_FIELDS = {
  _id: '_id',
  fromCity: 'fromCity',
  fromProvince: 'fromProvince',
  toCity: 'toCity',
  toProvince: 'toProvince',
  fromCityId: 'fromCityId',
  toCityId: 'toCityId',
  routeKey: 'routeKey',         // 用于去重，如 '济南-广州'
  companyCount: 'companyCount', // 冗余计数（写关联时维护）
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

const ROUTE_COMPANY_FIELDS = {
  _id: '_id',
  routeId: 'routeId',
  companyId: 'companyId',
  routeKey: 'routeKey',       // 冗余，便于按线路批量查
  transitDays: 'transitDays', // 时效（天）
  isDirect: 'isDirect',       // 是否直达
  frequency: 'frequency',     // 发车频率 daily/weekday/weekly/irregular
  priceNote: 'priceNote',     // 价格备注
  remark: 'remark',           // 备注
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

const CITY_FIELDS = {
  _id: '_id',
  name: 'name',
  province: 'province',
  pinyin: 'pinyin',
  initial: 'initial',
  isHot: 'isHot',
  sortOrder: 'sortOrder'
};

const CORRECTION_FIELDS = {
  _id: '_id',
  targetType: 'targetType',       // company / route_company
  targetId: 'targetId',
  targetSummary: 'targetSummary', // 上下文快照，便于后台不查库就能看懂
  type: 'type',                   // phone_wrong / company_closed / ...
  content: 'content',
  images: 'images',
  contact: 'contact',
  openid: 'openid',
  status: 'status',               // pending / accepted / rejected / hold
  rejectReason: 'rejectReason',
  handledBy: 'handledBy',
  handledAt: 'handledAt',
  createdAt: 'createdAt'
};

const ADMIN_FIELDS = {
  _id: '_id',
  username: 'username',
  passwordHash: 'passwordHash',
  salt: 'salt',
  role: 'role',
  lastLoginAt: 'lastLoginAt',
  createdAt: 'createdAt'
};

/** 公司规模枚举 */
const SCALE_OPTIONS = [
  { value: 'small', label: '小型' },
  { value: 'medium', label: '中型' },
  { value: 'large', label: '大型' }
];

/** 发车频率枚举 */
const FREQUENCY_OPTIONS = [
  { value: 'daily', label: '天天发车' },
  { value: 'weekday', label: '工作日发车' },
  { value: 'weekly', label: '每周发车' },
  { value: 'irregular', label: '不固定' }
];

/** 纠错类型枚举（PRD 模块 05） */
const CORRECTION_TYPES = [
  { value: 'phone_wrong', label: '电话有误' },
  { value: 'company_closed', label: '公司已停业' },
  { value: 'route_gone', label: '线路已取消' },
  { value: 'incomplete', label: '信息不完整' },
  { value: 'other', label: '其他' }
];

/** 纠错目标类型 */
const CORRECTION_TARGET_TYPES = {
  COMPANY: 'company',
  ROUTE_COMPANY: 'route_company'
};

/** 纠错状态 */
const CORRECTION_STATUS = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  HOLD: 'hold'
};

const CORRECTION_STATUS_LABELS = {
  pending: '待审核',
  accepted: '已采纳',
  rejected: '已驳回',
  hold: '待定'
};

module.exports = {
  COLLECTIONS,
  COMPANY_FIELDS,
  STATION_FIELDS,
  ROUTE_FIELDS,
  ROUTE_COMPANY_FIELDS,
  CITY_FIELDS,
  CORRECTION_FIELDS,
  ADMIN_FIELDS,
  SCALE_OPTIONS,
  FREQUENCY_OPTIONS,
  CORRECTION_TYPES,
  CORRECTION_TARGET_TYPES,
  CORRECTION_STATUS,
  CORRECTION_STATUS_LABELS
};
