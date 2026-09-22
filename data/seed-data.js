/**
 * 首批样板数据（PRD 五-1 第 3 条：「手工整理的 20~50 家公司，用于验证产品形态」）
 *
 * ★ 数据原则（硬约束，来自 PRD 与项目记忆）：
 *   1. **不使用真实企业信息**。公司名、电话、地址均为虚构，避免误用真实主体。
 *   2. **字段必须齐全**。与旧项目「真实数据字段大量缺失」不同，本批数据每条都带
 *      时效 / 是否直达 / 发车频率 / 价格备注，保证三个筛选条件都能真实演示。
 *   3. **确定性**。所有时间基于固定 BASE_TIME 按天偏移，不取 Date.now()，
 *      这样测试可以断言精确的相对时间文案。
 *   4. **电话格式多样**。含座机（区号-号码）、手机、400 号，覆盖前端的号码形态展示。
 *
 * 数据关系：companies ←→ route_companies ←→ routes
 * 三家表由 scripts/import.js 从本文件构建，本文件是唯一数据源。
 */

const { buildRouteKey } = require('../utils/common');
const { findCityByName } = require('../data/cities');

/** 时间基准：2026-09-19 12:00（与 PRD 定稿日一致） */
const BASE_TIME = Date.parse('2026-09-19T12:00:00+08:00');
/** D(3) = 3 天前 */
const D = (daysAgo) => BASE_TIME - daysAgo * 24 * 60 * 60 * 1000;

/* ============================================================
 * 公司（40 家）
 *
 * 字段：name 全称 / shortName 简称 / pinyin 全拼 / initial 首字母
 *       phone 主电话 / backupPhone 备用 / address 总部地址
 *       city 城市 / province 省 / scale 规模 / intro 简介 / verified 已核实
 *       departureStations / arrivalStations 发站到站（地址与电话一一对应）
 * ============================================================ */

const RAW_COMPANIES = [
  {
    id: 'comp_001', name: '济南鲁通物流有限公司', shortName: '鲁通物流', pinyin: 'lutongwuliu', initial: 'ltwl',
    phone: '0531-88110001', backupPhone: '13805310001',
    address: '济南市天桥区泺口物流园 A 区 12 号', city: '济南', province: '山东省',
    scale: 'large', verified: true, updatedAt: D(3),
    intro: '专注山东至华南专线运输，自有车辆 30 余台，济南发广州天天发车。',
    departureStations: [
      { address: '济南市天桥区泺口物流园 A 区 12 号（总部发站）', phone: '0531-88110001' },
      { address: '济南市槐荫区经十西路物流园 3 号库（西站发站）', phone: '0531-88110088' }
    ],
    arrivalStations: [
      { address: '广州市白云区太和镇物流园 C 区 8 号（广州到站）', phone: '020-88110001' }
    ]
  },
  {
    id: 'comp_002', name: '济南泉城货运代理有限公司', shortName: '泉城货运', pinyin: 'quanchenghuoyun', initial: 'qchy',
    phone: '0531-88110002', backupPhone: '13905310002',
    address: '济南市槐荫区经十西路物流园区 8 号库', city: '济南', province: '山东省',
    scale: 'medium', verified: true, updatedAt: D(12),
    intro: '主营山东至长三角地区零担与整车运输，支持上门提货。',
    departureStations: [
      { address: '济南市槐荫区经十西路物流园区 8 号库', phone: '0531-88110002' }
    ],
    arrivalStations: [
      { address: '上海市青浦区华新镇物流园 A 区', phone: '021-88110003' }
    ]
  },
  {
    id: 'comp_003', name: '山东齐鲁快运有限公司', shortName: '齐鲁快运', pinyin: 'qilukuaiyun', initial: 'qlky',
    phone: '0531-88110003', backupPhone: '',
    address: '济南市历城区工业北路物流中心 3 栋', city: '济南', province: '山东省',
    scale: 'large', verified: true, updatedAt: D(1),
    intro: '省内及华东专线网络覆盖广，主打次日达与隔日达产品。',
    departureStations: [
      { address: '济南市历城区工业北路物流中心 3 栋', phone: '0531-88110003' }
    ],
    arrivalStations: [
      { address: '青岛市黄岛区前湾港路物流园 5 号库', phone: '0532-88110005' }
    ]
  },
  {
    id: 'comp_004', name: '济南鸿运通物流有限公司', shortName: '鸿运通', pinyin: 'hongyuntong', initial: 'hyt',
    phone: '0531-88110004', backupPhone: '13705310004',
    address: '济南市天桥区北园大街物流集散中心', city: '济南', province: '山东省',
    scale: 'small', verified: false, updatedAt: D(45),
    intro: '济南至河南、河北方向专线，价格实惠。',
    departureStations: [
      { address: '济南市天桥区北园大街物流集散中心 B 排 5 号', phone: '0531-88110004' }
    ],
    arrivalStations: [
      { address: '郑州市管城区南三环物流园 2 号库', phone: '0371-88110006' }
    ]
  },
  {
    id: 'comp_005', name: '青岛海陆通物流有限公司', shortName: '海陆通', pinyin: 'hailutong', initial: 'hlt',
    phone: '0532-88110005', backupPhone: '13605320005',
    address: '青岛市黄岛区前湾港路物流园 B 区', city: '青岛', province: '山东省',
    scale: 'large', verified: true, updatedAt: D(5),
    intro: '依托青岛港优势，主营山东至华南、西南方向集装箱与专线运输。',
    departureStations: [
      { address: '青岛市黄岛区前湾港路物流园 B 区', phone: '0532-88110005' },
      { address: '青岛市城阳区正阳路货运市场 6 号库', phone: '0532-88110066' }
    ],
    arrivalStations: [
      { address: '深圳市龙岗区平湖物流基地 6 号库', phone: '0755-88110002' }
    ]
  },
  {
    id: 'comp_006', name: '临沂商城物流有限公司', shortName: '商城物流', pinyin: 'shangchengwuliu', initial: 'scwl',
    phone: '0539-88110006', backupPhone: '13505390006',
    address: '临沂市兰山区临沂商城物流园区', city: '临沂', province: '山东省',
    scale: 'large', verified: true, updatedAt: D(2),
    intro: '依托临沂批发市场，全国专线覆盖，以价格低、发车频著称。',
    departureStations: [
      { address: '临沂市兰山区临沂商城物流园区 3 号馆', phone: '0539-88110006' }
    ],
    arrivalStations: [
      { address: '杭州市余杭区物流中心 A 区', phone: '0571-88110007' }
    ]
  },
  {
    id: 'comp_007', name: '潍坊顺达运输有限公司', shortName: '顺达运输', pinyin: 'shundayunshu', initial: 'sdys',
    phone: '0536-88110007', backupPhone: '',
    address: '潍坊市奎文区潍州路物流园区', city: '潍坊', province: '山东省',
    scale: 'medium', verified: true, updatedAt: D(20),
    intro: '潍坊本地老牌货运，主营省内短线与京津冀方向。',
    departureStations: [
      { address: '潍坊市奎文区潍州路物流园区 12 号', phone: '0536-88110007' }
    ],
    arrivalStations: [
      { address: '北京市大兴区亦庄物流基地 4 号库', phone: '010-88110008' }
    ]
  },
  {
    id: 'comp_008', name: '烟台黄海物流有限公司', shortName: '黄海物流', pinyin: 'huanghaiwuliu', initial: 'hhwl',
    phone: '0535-88110008', backupPhone: '13905350008',
    address: '烟台市芝罘区幸福南路物流园', city: '烟台', province: '山东省',
    scale: 'medium', verified: false, updatedAt: D(60),
    intro: '胶东半岛至华东方向专线，海运联运能力强。',
    departureStations: [
      { address: '烟台市芝罘区幸福南路物流园 8 号库', phone: '0535-88110008' }
    ],
    arrivalStations: [
      { address: '南京市江宁区科学园物流中心 2 号库', phone: '025-88110004' }
    ]
  },
  {
    id: 'comp_009', name: '淄博齐星货运有限公司', shortName: '齐星货运', pinyin: 'qixinghuoyun', initial: 'qxhy',
    phone: '0533-88110009', backupPhone: '13805330009',
    address: '淄博市张店区南定镇物流园区', city: '淄博', province: '山东省',
    scale: 'small', verified: true, updatedAt: D(8),
    intro: '化工品与普货运输，淄博至江浙沪专线。',
    departureStations: [
      { address: '淄博市张店区南定镇物流园区 5 号', phone: '0533-88110009' }
    ],
    arrivalStations: [
      { address: '苏州市相城区物流园 B 区', phone: '0512-88110010' }
    ]
  },
  {
    id: 'comp_010', name: '济宁运河物流有限公司', shortName: '运河物流', pinyin: 'yunhewuliu', initial: 'yhwl',
    phone: '0537-88110010', backupPhone: '',
    address: '济宁市任城区运河经济开发区物流园', city: '济宁', province: '山东省',
    scale: 'medium', verified: true, updatedAt: D(15),
    intro: '鲁西南至华中、西南方向专线，煤炭与建材运输经验丰富。',
    departureStations: [
      { address: '济宁市任城区运河经济开发区物流园 A 栋', phone: '0537-88110010' }
    ],
    arrivalStations: [
      { address: '武汉市东西湖区吴家山物流园 9 号库', phone: '027-88110011' }
    ]
  },
  {
    id: 'comp_011', name: '泰安泰山物流有限公司', shortName: '泰山物流', pinyin: 'taishanwuliu', initial: 'tswl',
    phone: '0538-88110011', backupPhone: '13605380011',
    address: '泰安市泰山区东部新区物流园', city: '泰安', province: '山东省',
    scale: 'small', verified: false, updatedAt: D(75),
    intro: '泰安至西北方向专线，钢材运输为主。',
    departureStations: [
      { address: '泰安市泰山区东部新区物流园 3 号', phone: '0538-88110011' }
    ],
    arrivalStations: [
      { address: '西安市未央区三桥物流园 C 区', phone: '029-88110012' }
    ]
  },
  {
    id: 'comp_012', name: '聊城鲁西货运有限公司', shortName: '鲁西货运', pinyin: 'luxihuoyun', initial: 'lxhy',
    phone: '0635-88110012', backupPhone: '13506350012',
    address: '聊城市东昌府区经济开发区物流园', city: '聊城', province: '山东省',
    scale: 'medium', verified: true, updatedAt: D(9),
    intro: '聊城至华中方向专线，承接整车与零担。',
    departureStations: [
      { address: '聊城市东昌府区经济开发区物流园 6 号', phone: '0635-88110012' }
    ],
    arrivalStations: [
      { address: '长沙市雨花区高桥物流园 4 号库', phone: '0731-88110013' }
    ]
  },
  {
    id: 'comp_013', name: '山东九州通速运有限公司', shortName: '九州通速运', pinyin: 'jiuzhoutongsuyun', initial: 'jztsy',
    phone: '400-881-1013', backupPhone: '13805310013',
    address: '济南市历下区经十路总部中心', city: '济南', province: '山东省',
    scale: 'large', verified: true, updatedAt: D(1),
    intro: '全国干线网络，山东全境上门提货，主打时效产品。',
    departureStations: [
      { address: '济南市历下区经十路总部中心 1 层收货区', phone: '400-881-1013' },
      { address: '济南市历城区董家镇分拨中心', phone: '0531-88110133' }
    ],
    arrivalStations: [
      { address: '成都市双流区物流大道分拨中心', phone: '028-88110014' },
      { address: '重庆市九龙坡区西彭物流园', phone: '023-88110015' }
    ]
  },
  {
    id: 'comp_014', name: '德州鑫盛物流有限公司', shortName: '鑫盛物流', pinyin: 'xinshengwuliu', initial: 'xswl',
    phone: '0534-88110014', backupPhone: '',
    address: '德州市德城区天衢工业园物流中心', city: '德州', province: '山东省',
    scale: 'small', verified: true, updatedAt: D(30),
    intro: '德州至京津方向专线，冷链普货皆可。',
    departureStations: [
      { address: '德州市德城区天衢工业园物流中心 2 号', phone: '0534-88110014' }
    ],
    arrivalStations: [
      { address: '天津市西青区王顶堤物流园 A 区', phone: '022-88110016' }
    ]
  },
  {
    id: 'comp_015', name: '菏泽牡丹物流有限公司', shortName: '牡丹物流', pinyin: 'mudanwuliu', initial: 'mdwl',
    phone: '0530-88110015', backupPhone: '13705300015',
    address: '菏泽市牡丹区经济开发区物流园', city: '菏泽', province: '山东省',
    scale: 'small', verified: false, updatedAt: D(100),
    intro: '菏泽至江浙方向专线，农产品运输为主。',
    departureStations: [
      { address: '菏泽市牡丹区经济开发区物流园 8 号', phone: '0530-88110015' }
    ],
    arrivalStations: [
      { address: '义乌市国际商贸城物流园 3 号库', phone: '0579-88110017' }
    ]
  },
  {
    id: 'comp_016', name: '威海远洋货运代理有限公司', shortName: '远洋货运', pinyin: 'yuanyanghuoyun', initial: 'yyhy',
    phone: '0631-88110016', backupPhone: '13806310016',
    address: '威海市环翠区海埠路物流园', city: '威海', province: '山东省',
    scale: 'medium', verified: true, updatedAt: D(18),
    intro: '威海至东北、日韩方向货运代理，海陆联运。',
    departureStations: [
      { address: '威海市环翠区海埠路物流园 5 号库', phone: '0631-88110016' }
    ],
    arrivalStations: [
      { address: '沈阳市于洪区沙岭物流园 7 号', phone: '024-88110018' }
    ]
  },
  {
    id: 'comp_017', name: '东营胜利物流有限公司', shortName: '胜利物流', pinyin: 'shengliwuliu', initial: 'slwl',
    phone: '0546-88110017', backupPhone: '',
    address: '东营市东营区胜利工业园物流中心', city: '东营', province: '山东省',
    scale: 'medium', verified: true, updatedAt: D(25),
    intro: '油田物资与普货运输，东营至西北专线。',
    departureStations: [
      { address: '东营市东营区胜利工业园物流中心 4 号', phone: '0546-88110017' }
    ],
    arrivalStations: [
      { address: '兰州市安宁区物流园 6 号库', phone: '0931-88110019' }
    ]
  },
  {
    id: 'comp_018', name: '日照港通物流有限公司', shortName: '港通物流', pinyin: 'gangtongwuliu', initial: 'gtwl',
    phone: '0633-88110018', backupPhone: '13906330018',
    address: '日照市东港区海滨五路物流园', city: '日照', province: '山东省',
    scale: 'medium', verified: true, updatedAt: D(7),
    intro: '依托日照港，主营至华南、西南方向集装箱专线。',
    departureStations: [
      { address: '日照市东港区海滨五路物流园 9 号库', phone: '0633-88110018' }
    ],
    arrivalStations: [
      { address: '昆明市官渡区物流园 2 号', phone: '0871-88110020' }
    ]
  },
  {
    id: 'comp_019', name: '枣庄运河航运物流有限公司', shortName: '运河航运', pinyin: 'yunhehangyun', initial: 'yhhy',
    phone: '0632-88110019', backupPhone: '',
    address: '枣庄市薛城区运河物流园', city: '枣庄', province: '山东省',
    scale: 'small', verified: false, updatedAt: D(120),
    intro: '枣庄至苏北、皖北方向短途专线。',
    departureStations: [
      { address: '枣庄市薛城区运河物流园 2 号', phone: '0632-88110019' }
    ],
    arrivalStations: [
      { address: '徐州市云龙区物流园 5 号库', phone: '0516-88110021' }
    ]
  },
  {
    id: 'comp_020', name: '滨州渤海货运有限公司', shortName: '渤海货运', pinyin: 'bohaihuoyun', initial: 'bhhy',
    phone: '0543-88110020', backupPhone: '13505430020',
    address: '滨州市滨城区渤海五路物流园', city: '滨州', province: '山东省',
    scale: 'small', verified: true, updatedAt: D(40),
    intro: '滨州至华北方向专线，棉纺与家纺货物为主。',
    departureStations: [
      { address: '滨州市滨城区渤海五路物流园 3 号', phone: '0543-88110020' }
    ],
    arrivalStations: [
      { address: '石家庄市桥西区物流园 8 号库', phone: '0311-88110022' }
    ]
  },
  /* ---------- 上述 20 家为山东省内主体。以下 20 家补充跨省对开与枢纽城市， ----------
     ---------- 让「反向查询」与「跨省线路」有真实数据可演示。          ---------- */
  {
    id: 'comp_021', name: '广州穗运物流有限公司', shortName: '穗运物流', pinyin: 'suiyunwuliu', initial: 'sywl',
    phone: '020-88110021', backupPhone: '13802000021',
    address: '广州市白云区太和镇物流园 C 区', city: '广州', province: '广东省',
    scale: 'large', verified: true, updatedAt: D(4),
    intro: '华南至山东专线，与多家山东公司对开，回程货充足。',
    departureStations: [
      { address: '广州市白云区太和镇物流园 C 区 12 号', phone: '020-88110021' }
    ],
    arrivalStations: [
      { address: '济南市天桥区泺口物流园 B 区 3 号库', phone: '0531-88110221' }
    ]
  },
  {
    id: 'comp_022', name: '上海长江物流有限公司', shortName: '长江物流', pinyin: 'changjiangwuliu', initial: 'cjwl',
    phone: '021-88110022', backupPhone: '13802100022',
    address: '上海市青浦区华新镇物流园 A 区', city: '上海', province: '上海市',
    scale: 'large', verified: true, updatedAt: D(6),
    intro: '长三角至山东、华北干线运输，日日发车。',
    departureStations: [
      { address: '上海市青浦区华新镇物流园 A 区 6 号库', phone: '021-88110022' }
    ],
    arrivalStations: [
      { address: '青岛市黄岛区前湾港路物流园 D 区', phone: '0532-88110222' }
    ]
  },
  {
    id: 'comp_023', name: '南京金陵货运有限公司', shortName: '金陵货运', pinyin: 'jinlinghuoyun', initial: 'jlhy',
    phone: '025-88110023', backupPhone: '13802500023',
    address: '南京市江宁区科学园物流中心', city: '南京', province: '江苏省',
    scale: 'medium', verified: true, updatedAt: D(11),
    intro: '南京至鲁南、胶东方向专线，零担拼车为主。',
    departureStations: [
      { address: '南京市江宁区科学园物流中心 5 号库', phone: '025-88110023' }
    ],
    arrivalStations: [
      { address: '潍坊市奎文区潍州路物流园区 20 号', phone: '0536-88110223' }
    ]
  },
  {
    id: 'comp_024', name: '郑州中原物流有限公司', shortName: '中原物流', pinyin: 'zhongyuanwuliu', initial: 'zywl',
    phone: '0371-88110024', backupPhone: '13803710024',
    address: '郑州市管城区南三环物流园', city: '郑州', province: '河南省',
    scale: 'large', verified: true, updatedAt: D(9),
    intro: '中原枢纽，全国中转能力强，郑州至山东各地市全覆盖。',
    departureStations: [
      { address: '郑州市管城区南三环物流园 8 号库', phone: '0371-88110024' }
    ],
    arrivalStations: [
      { address: '临沂市兰山区临沂商城物流园区 9 号馆', phone: '0539-88110224' }
    ]
  },
  {
    id: 'comp_025', name: '杭州钱塘物流有限公司', shortName: '钱塘物流', pinyin: 'qiantangwuliu', initial: 'qtwl',
    phone: '0571-88110025', backupPhone: '13805710025',
    address: '杭州市余杭区物流中心 A 区', city: '杭州', province: '浙江省',
    scale: 'medium', verified: true, updatedAt: D(14),
    intro: '长三角至山东专线，电商小票零担经验丰富。',
    departureStations: [
      { address: '杭州市余杭区物流中心 A 区 10 号库', phone: '0571-88110025' }
    ],
    arrivalStations: [
      { address: '济南市历城区工业北路物流中心 8 栋', phone: '0531-88110225' }
    ]
  },
  {
    id: 'comp_026', name: '义乌商城货运有限公司', shortName: '义乌货运', pinyin: 'yiwuhuoyun', initial: 'ywhy',
    phone: '0579-88110026', backupPhone: '',
    address: '义乌市国际商贸城物流园', city: '义乌', province: '浙江省',
    scale: 'medium', verified: false, updatedAt: D(55),
    intro: '小商品集散地直发山东，价格有优势。',
    departureStations: [
      { address: '义乌市国际商贸城物流园 6 号库', phone: '0579-88110026' }
    ],
    arrivalStations: [
      { address: '菏泽市牡丹区经济开发区物流园 12 号', phone: '0530-88110226' }
    ]
  },
  {
    id: 'comp_027', name: '天津渤海湾物流有限公司', shortName: '渤海湾物流', pinyin: 'bohaiwanwuliu', initial: 'bhwwl',
    phone: '022-88110027', backupPhone: '13802200027',
    address: '天津市西青区王顶堤物流园', city: '天津', province: '天津市',
    scale: 'medium', verified: true, updatedAt: D(16),
    intro: '天津港集疏运，至山东各地市专线。',
    departureStations: [
      { address: '天津市西青区王顶堤物流园 B 区 5 号库', phone: '022-88110027' }
    ],
    arrivalStations: [
      { address: '德州市德城区天衢工业园物流中心 9 号', phone: '0534-88110227' }
    ]
  },
  {
    id: 'comp_028', name: '北京京鲁物流有限公司', shortName: '京鲁物流', pinyin: 'jingluwuliu', initial: 'jlwl',
    phone: '010-88110028', backupPhone: '13801000028',
    address: '北京市大兴区亦庄物流基地', city: '北京', province: '北京市',
    scale: 'large', verified: true, updatedAt: D(2),
    intro: '京鲁专线直达，天天发车，承接整车零担。',
    departureStations: [
      { address: '北京市大兴区亦庄物流基地 3 号库', phone: '010-88110028' }
    ],
    arrivalStations: [
      { address: '济南市槐荫区经十西路物流园区 15 号库', phone: '0531-88110228' }
    ]
  },
  {
    id: 'comp_029', name: '武汉江城物流有限公司', shortName: '江城物流', pinyin: 'jiangchengwuliu', initial: 'jcwl',
    phone: '027-88110029', backupPhone: '13802700029',
    address: '武汉市东西湖区吴家山物流园', city: '武汉', province: '湖北省',
    scale: 'medium', verified: true, updatedAt: D(22),
    intro: '华中至山东专线，冷链普货均可。',
    departureStations: [
      { address: '武汉市东西湖区吴家山物流园 12 号库', phone: '027-88110029' }
    ],
    arrivalStations: [
      { address: '济宁市任城区运河经济开发区物流园 C 栋', phone: '0537-88110229' }
    ]
  },
  {
    id: 'comp_030', name: '西安丝路物流有限公司', shortName: '丝路物流', pinyin: 'siluwuliu', initial: 'slwl',
    phone: '029-88110030', backupPhone: '',
    address: '西安市未央区三桥物流园', city: '西安', province: '陕西省',
    scale: 'medium', verified: false, updatedAt: D(80),
    intro: '西北至山东专线，大件运输为主。',
    departureStations: [
      { address: '西安市未央区三桥物流园 C 区 6 号', phone: '029-88110030' }
    ],
    arrivalStations: [
      { address: '泰安市泰山区东部新区物流园 10 号', phone: '0538-88110230' }
    ]
  },
  {
    id: 'comp_031', name: '济南中铁快运有限公司', shortName: '中铁快运', pinyin: 'zhongtiekuaiyun', initial: 'ztky',
    phone: '0531-88110031', backupPhone: '13805310031',
    address: '济南市市中区二环南路物流中心', city: '济南', province: '山东省',
    scale: 'large', verified: true, updatedAt: D(1),
    intro: '依托铁路资源，大宗货物与长途干线优势明显。',
    departureStations: [
      { address: '济南市市中区二环南路物流中心 1 号', phone: '0531-88110031' }
    ],
    arrivalStations: [
      { address: '乌鲁木齐市头屯河区物流园 3 号库', phone: '0991-88110031' },
      { address: '成都市双流区物流大道 9 号库', phone: '028-88110031' }
    ]
  },
  {
    id: 'comp_032', name: '济南万邦供应链管理有限公司', shortName: '万邦供应链', pinyin: 'wanbanggongyinglian', initial: 'wbgyl',
    phone: '0531-88110032', backupPhone: '13905310032',
    address: '济南市高新区舜华路供应链产业园', city: '济南', province: '山东省',
    scale: 'large', verified: true, updatedAt: D(3),
    intro: '一站式供应链服务，仓配一体，华东华南双线并进。',
    departureStations: [
      { address: '济南市高新区舜华路供应链产业园 A 座', phone: '0531-88110032' }
    ],
    arrivalStations: [
      { address: '上海市嘉定区外冈物流园 8 号库', phone: '021-88110032' },
      { address: '深圳市宝安区福永物流园 5 号库', phone: '0755-88110032' }
    ]
  },
  {
    id: 'comp_033', name: '青岛中远货运代理有限公司', shortName: '中远货运', pinyin: 'zhongyuanhuoyun', initial: 'zyhy',
    phone: '0532-88110033', backupPhone: '13805320033',
    address: '青岛市市南区香港中路航运中心', city: '青岛', province: '山东省',
    scale: 'large', verified: true, updatedAt: D(4),
    intro: '国际货代与国内干线并行，青岛至华南西南专线。',
    departureStations: [
      { address: '青岛市市南区香港中路航运中心 12 层', phone: '0532-88110033' }
    ],
    arrivalStations: [
      { address: '广州市黄埔区港口物流园 7 号库', phone: '020-88110033' }
    ]
  },
  {
    id: 'comp_034', name: '济南方正快运有限公司', shortName: '方正快运', pinyin: 'fangzhengkuaiyun', initial: 'fzky',
    phone: '0531-88110034', backupPhone: '',
    address: '济南市历城区华山物流园', city: '济南', province: '山东省',
    scale: 'small', verified: false, updatedAt: D(150),
    intro: '省内短途快运，济南至周边地市次日达。',
    departureStations: [
      { address: '济南市历城区华山物流园 4 号', phone: '0531-88110034' }
    ],
    arrivalStations: [
      { address: '淄博市张店区南定镇物流园区 11 号', phone: '0533-88110034' }
    ]
  },
  {
    id: 'comp_035', name: '临沂兰田物流有限公司', shortName: '兰田物流', pinyin: 'lantianwuliu', initial: 'ltwl',
    phone: '0539-88110035', backupPhone: '13705390035',
    address: '临沂市兰山区兰田物流园', city: '临沂', province: '山东省',
    scale: 'medium', verified: true, updatedAt: D(13),
    intro: '临沂至东北方向专线，回程配货能力强。',
    departureStations: [
      { address: '临沂市兰山区兰田物流园 7 号馆', phone: '0539-88110035' }
    ],
    arrivalStations: [
      { address: '沈阳市铁西区物流园 9 号库', phone: '024-88110035' }
    ]
  },
  {
    id: 'comp_036', name: '潍坊鲁中物流有限公司', shortName: '鲁中物流', pinyin: 'luzhongwuliu', initial: 'lzwl',
    phone: '0536-88110036', backupPhone: '',
    address: '潍坊市寒亭区鲁中物流园', city: '潍坊', province: '山东省',
    scale: 'small', verified: true, updatedAt: D(35),
    intro: '鲁中地区至苏浙沪专线，蔬菜生鲜运输有专车。',
    departureStations: [
      { address: '潍坊市寒亭区鲁中物流园 3 号库', phone: '0536-88110036' }
    ],
    arrivalStations: [
      { address: '无锡市锡山区物流园 6 号库', phone: '0510-88110036' }
    ]
  },
  {
    id: 'comp_037', name: '烟台渤海轮渡物流有限公司', shortName: '渤海轮渡', pinyin: 'bohailundu', initial: 'bhld',
    phone: '0535-88110037', backupPhone: '13805350037',
    address: '烟台市芝罘区环海路港区物流中心', city: '烟台', province: '山东省',
    scale: 'large', verified: true, updatedAt: D(10),
    intro: '烟大轮渡联运，胶东至东北方向时效优势明显。',
    departureStations: [
      { address: '烟台市芝罘区环海路港区物流中心 2 号', phone: '0535-88110037' }
    ],
    arrivalStations: [
      { address: '大连市甘井子区物流园 5 号库', phone: '0411-88110037' }
    ]
  },
  {
    id: 'comp_038', name: '山东恒昌物流集团有限公司', shortName: '恒昌物流', pinyin: 'hengchangwuliu', initial: 'hcwl',
    phone: '0531-88110038', backupPhone: '13805310038',
    address: '济南市章丘区明水经济开发区物流园', city: '济南', province: '山东省',
    scale: 'large', verified: true, updatedAt: D(1),
    intro: '集团化运营，干线网覆盖全国 20 余省，山东发全国。',
    departureStations: [
      { address: '济南市章丘区明水经济开发区物流园 A 区', phone: '0531-88110038' },
      { address: '济南市天桥区北园大街分拨中心', phone: '0531-88110388' }
    ],
    arrivalStations: [
      { address: '福州市仓山区物流园 7 号库', phone: '0591-88110038' },
      { address: '厦门市集美区物流园 3 号库', phone: '0592-88110038' }
    ]
  },
  {
    id: 'comp_039', name: '成都天府物流有限公司', shortName: '天府物流', pinyin: 'tianfuwuliu', initial: 'tfwl',
    phone: '028-88110039', backupPhone: '13802800039',
    address: '成都市双流区物流大道', city: '成都', province: '四川省',
    scale: 'medium', verified: true, updatedAt: D(19),
    intro: '西南至山东专线，回程货源稳定。',
    departureStations: [
      { address: '成都市双流区物流大道 15 号库', phone: '028-88110039' }
    ],
    arrivalStations: [
      { address: '济南市历下区经十路收货点', phone: '0531-88110239' }
    ]
  },
  {
    id: 'comp_040', name: '沈阳北方物流有限公司', shortName: '北方物流', pinyin: 'beifangwuliu', initial: 'bfwl',
    phone: '024-88110040', backupPhone: '',
    address: '沈阳市于洪区沙岭物流园', city: '沈阳', province: '辽宁省',
    scale: 'medium', verified: false, updatedAt: D(65),
    intro: '东北至山东专线，钢材与机械设备运输为主。',
    departureStations: [
      { address: '沈阳市于洪区沙岭物流园 11 号库', phone: '024-88110040' }
    ],
    arrivalStations: [
      { address: '潍坊市奎文区潍州路物流园区 30 号', phone: '0536-88110240' }
    ]
  }
];

/* ============================================================
 * 线路-公司关联（承载时效 / 直达 / 发车频率）
 *
 * 字段：company 公司 id / from 出发城市 / to 到达城市
 *       transitDays 时效（天）/ isDirect 是否直达
 *       frequency 发车频率 / priceNote 价格备注 / remark 备注
 *       updatedAt 更新时间
 *
 * ★ 时效必须在这里，不在公司表 —— 同一家公司跑不同线路时效不同。
 * ============================================================ */

const RAW_LINKS = [
  /* 济南出发 · 华南 */
  { company: 'comp_001', from: '济南', to: '广州', transitDays: 2, isDirect: true, frequency: 'daily', priceNote: '重货 480 元/吨起', remark: '天天发车，下午 6 点前装车', updatedAt: D(3) },
  { company: 'comp_013', from: '济南', to: '广州', transitDays: 2, isDirect: true, frequency: 'daily', priceNote: '重货 460 元/吨起', remark: '', updatedAt: D(1) },
  { company: 'comp_038', from: '济南', to: '广州', transitDays: 3, isDirect: false, frequency: 'daily', priceNote: '重货 420 元/吨起', remark: '需在郑州中转', updatedAt: D(1) },
  { company: 'comp_032', from: '济南', to: '深圳', transitDays: 3, isDirect: true, frequency: 'weekday', priceNote: '重货 520 元/吨起', remark: '工作日发车，周末需预约', updatedAt: D(3) },
  { company: 'comp_033', from: '济南', to: '广州', transitDays: 3, isDirect: false, frequency: 'weekly', priceNote: '电商货 0.8 元/公斤', remark: '每周二、五发车', updatedAt: D(4) },

  /* 济南出发 · 华东 */
  { company: 'comp_002', from: '济南', to: '上海', transitDays: 1, isDirect: true, frequency: 'daily', priceNote: '重货 260 元/吨起', remark: '支持上门提货', updatedAt: D(12) },
  { company: 'comp_032', from: '济南', to: '上海', transitDays: 2, isDirect: true, frequency: 'daily', priceNote: '重货 240 元/吨起', remark: '', updatedAt: D(3) },
  { company: 'comp_025', from: '济南', to: '杭州', transitDays: 2, isDirect: true, frequency: 'daily', priceNote: '重货 280 元/吨起', remark: '', updatedAt: D(14) },
  { company: 'comp_002', from: '济南', to: '南京', transitDays: 1, isDirect: true, frequency: 'daily', priceNote: '重货 200 元/吨起', remark: '', updatedAt: D(12) },
  { company: 'comp_009', from: '济南', to: '苏州', transitDays: 2, isDirect: true, frequency: 'weekday', priceNote: '重货 300 元/吨起', remark: '工作日发车', updatedAt: D(8) },
  { company: 'comp_036', from: '济南', to: '无锡', transitDays: 2, isDirect: false, frequency: 'weekly', priceNote: '重货 290 元/吨起', remark: '经苏州中转', updatedAt: D(35) },

  /* 济南出发 · 华北 */
  { company: 'comp_028', from: '济南', to: '北京', transitDays: 1, isDirect: true, frequency: 'daily', priceNote: '重货 180 元/吨起', remark: '京鲁直达，天天发车', updatedAt: D(2) },
  { company: 'comp_014', from: '济南', to: '天津', transitDays: 1, isDirect: true, frequency: 'daily', priceNote: '重货 160 元/吨起', remark: '', updatedAt: D(30) },
  { company: 'comp_027', from: '济南', to: '天津', transitDays: 1, isDirect: true, frequency: 'daily', priceNote: '重货 150 元/吨起', remark: '', updatedAt: D(16) },
  { company: 'comp_020', from: '济南', to: '石家庄', transitDays: 1, isDirect: true, frequency: 'weekday', priceNote: '重货 170 元/吨起', remark: '', updatedAt: D(40) },

  /* 济南出发 · 华中 */
  { company: 'comp_004', from: '济南', to: '郑州', transitDays: 1, isDirect: true, frequency: 'daily', priceNote: '重货 190 元/吨起', remark: '', updatedAt: D(45) },
  { company: 'comp_024', from: '济南', to: '郑州', transitDays: 1, isDirect: true, frequency: 'daily', priceNote: '重货 185 元/吨起', remark: '', updatedAt: D(9) },
  { company: 'comp_010', from: '济南', to: '武汉', transitDays: 2, isDirect: true, frequency: 'daily', priceNote: '重货 320 元/吨起', remark: '', updatedAt: D(15) },
  { company: 'comp_012', from: '济南', to: '长沙', transitDays: 3, isDirect: false, frequency: 'weekly', priceNote: '重货 400 元/吨起', remark: '经武汉中转', updatedAt: D(9) },

  /* 济南出发 · 西南 · 西北 · 东北 */
  { company: 'comp_013', from: '济南', to: '成都', transitDays: 3, isDirect: true, frequency: 'weekday', priceNote: '重货 560 元/吨起', remark: '', updatedAt: D(1) },
  { company: 'comp_031', from: '济南', to: '成都', transitDays: 4, isDirect: false, frequency: 'weekly', priceNote: '铁路联运 480 元/吨起', remark: '铁路集装箱，需提前 2 天预约', updatedAt: D(1) },
  { company: 'comp_039', from: '济南', to: '成都', transitDays: 3, isDirect: true, frequency: 'daily', priceNote: '重货 540 元/吨起', remark: '', updatedAt: D(19) },
  { company: 'comp_013', from: '济南', to: '重庆', transitDays: 3, isDirect: true, frequency: 'weekday', priceNote: '重货 580 元/吨起', remark: '', updatedAt: D(1) },
  { company: 'comp_011', from: '济南', to: '西安', transitDays: 2, isDirect: true, frequency: 'daily', priceNote: '重货 340 元/吨起', remark: '', updatedAt: D(75) },
  { company: 'comp_017', from: '济南', to: '兰州', transitDays: 3, isDirect: false, frequency: 'weekly', priceNote: '重货 480 元/吨起', remark: '经西安中转', updatedAt: D(25) },
  { company: 'comp_031', from: '济南', to: '乌鲁木齐', transitDays: 5, isDirect: false, frequency: 'weekly', priceNote: '铁路联运 720 元/吨起', remark: '铁路运输，约 5 天到站', updatedAt: D(1) },
  { company: 'comp_035', from: '济南', to: '沈阳', transitDays: 2, isDirect: true, frequency: 'daily', priceNote: '重货 380 元/吨起', remark: '', updatedAt: D(13) },
  { company: 'comp_040', from: '济南', to: '沈阳', transitDays: 2, isDirect: true, frequency: 'weekday', priceNote: '重货 370 元/吨起', remark: '', updatedAt: D(65) },
  { company: 'comp_016', from: '济南', to: '大连', transitDays: 2, isDirect: false, frequency: 'daily', priceNote: '重货 360 元/吨起', remark: '轮渡联运', updatedAt: D(18) },
  { company: 'comp_038', from: '济南', to: '福州', transitDays: 3, isDirect: true, frequency: 'weekday', priceNote: '重货 560 元/吨起', remark: '', updatedAt: D(1) },
  { company: 'comp_038', from: '济南', to: '厦门', transitDays: 3, isDirect: false, frequency: 'weekly', priceNote: '重货 580 元/吨起', remark: '经福州中转', updatedAt: D(1) },

  /* 省内线路 */
  { company: 'comp_003', from: '济南', to: '青岛', transitDays: 1, isDirect: true, frequency: 'daily', priceNote: '重货 120 元/吨起', remark: '省内次日达', updatedAt: D(1) },
  { company: 'comp_022', from: '济南', to: '青岛', transitDays: 1, isDirect: true, frequency: 'daily', priceNote: '重货 110 元/吨起', remark: '', updatedAt: D(6) },
  { company: 'comp_024', from: '济南', to: '临沂', transitDays: 1, isDirect: true, frequency: 'daily', priceNote: '重货 100 元/吨起', remark: '', updatedAt: D(9) },
  { company: 'comp_006', from: '济南', to: '临沂', transitDays: 1, isDirect: true, frequency: 'daily', priceNote: '重货 95 元/吨起', remark: '', updatedAt: D(2) },
  { company: 'comp_023', from: '济南', to: '潍坊', transitDays: 1, isDirect: true, frequency: 'daily', priceNote: '重货 105 元/吨起', remark: '', updatedAt: D(11) },
  { company: 'comp_007', from: '济南', to: '潍坊', transitDays: 1, isDirect: true, frequency: 'daily', priceNote: '重货 100 元/吨起', remark: '', updatedAt: D(20) },
  { company: 'comp_034', from: '济南', to: '淄博', transitDays: 1, isDirect: true, frequency: 'daily', priceNote: '重货 60 元/吨起', remark: '当天可到', updatedAt: D(150) },
  { company: 'comp_010', from: '济南', to: '济宁', transitDays: 1, isDirect: true, frequency: 'daily', priceNote: '重货 90 元/吨起', remark: '', updatedAt: D(15) },
  { company: 'comp_012', from: '济南', to: '聊城', transitDays: 1, isDirect: true, frequency: 'daily', priceNote: '重货 70 元/吨起', remark: '当天可到', updatedAt: D(9) },
  { company: 'comp_014', from: '济南', to: '德州', transitDays: 1, isDirect: true, frequency: 'daily', priceNote: '重货 80 元/吨起', remark: '', updatedAt: D(30) },
  { company: 'comp_008', from: '济南', to: '烟台', transitDays: 1, isDirect: true, frequency: 'daily', priceNote: '重货 140 元/吨起', remark: '', updatedAt: D(60) },
  { company: 'comp_037', from: '济南', to: '烟台', transitDays: 1, isDirect: true, frequency: 'daily', priceNote: '重货 135 元/吨起', remark: '', updatedAt: D(10) },
  { company: 'comp_005', from: '济南', to: '威海', transitDays: 2, isDirect: true, frequency: 'weekday', priceNote: '重货 160 元/吨起', remark: '', updatedAt: D(5) },
  { company: 'comp_018', from: '济南', to: '日照', transitDays: 1, isDirect: true, frequency: 'daily', priceNote: '重货 130 元/吨起', remark: '', updatedAt: D(7) },
  { company: 'comp_019', from: '济南', to: '枣庄', transitDays: 1, isDirect: true, frequency: 'weekly', priceNote: '重货 110 元/吨起', remark: '每周三、六发车', updatedAt: D(120) },
  { company: 'comp_020', from: '济南', to: '滨州', transitDays: 1, isDirect: true, frequency: 'daily', priceNote: '重货 85 元/吨起', remark: '', updatedAt: D(40) },
  { company: 'comp_017', from: '济南', to: '东营', transitDays: 1, isDirect: true, frequency: 'daily', priceNote: '重货 88 元/吨起', remark: '', updatedAt: D(25) },
  { company: 'comp_015', from: '济南', to: '菏泽', transitDays: 1, isDirect: true, frequency: 'weekday', priceNote: '重货 100 元/吨起', remark: '', updatedAt: D(100) },
  { company: 'comp_026', from: '济南', to: '菏泽', transitDays: 2, isDirect: false, frequency: 'weekly', priceNote: '轻货 0.5 元/公斤', remark: '义乌中转，小商品专线', updatedAt: D(55) },
  { company: 'comp_023', from: '济南', to: '泰安', transitDays: 1, isDirect: true, frequency: 'daily', priceNote: '重货 65 元/吨起', remark: '当天可到', updatedAt: D(11) },
  { company: 'comp_029', from: '济南', to: '武汉', transitDays: 2, isDirect: true, frequency: 'daily', priceNote: '重货 330 元/吨起', remark: '华中回程货充足', updatedAt: D(22) },
  { company: 'comp_030', from: '济南', to: '西安', transitDays: 2, isDirect: true, frequency: 'weekday', priceNote: '重货 350 元/吨起', remark: '', updatedAt: D(80) },

  /* 反向线路（支撑「反向查询」演示：非济南出发） */
  { company: 'comp_021', from: '广州', to: '济南', transitDays: 2, isDirect: true, frequency: 'daily', priceNote: '重货 470 元/吨起', remark: '回程货充足，价格优于去程', updatedAt: D(4) },
  { company: 'comp_022', from: '上海', to: '济南', transitDays: 1, isDirect: true, frequency: 'daily', priceNote: '重货 250 元/吨起', remark: '', updatedAt: D(6) },
  { company: 'comp_022', from: '上海', to: '青岛', transitDays: 2, isDirect: true, frequency: 'daily', priceNote: '重货 270 元/吨起', remark: '', updatedAt: D(6) },
  { company: 'comp_023', from: '南京', to: '潍坊', transitDays: 2, isDirect: true, frequency: 'daily', priceNote: '重货 290 元/吨起', remark: '', updatedAt: D(11) },
  { company: 'comp_024', from: '郑州', to: '临沂', transitDays: 1, isDirect: true, frequency: 'daily', priceNote: '重货 180 元/吨起', remark: '', updatedAt: D(9) },
  { company: 'comp_025', from: '杭州', to: '济南', transitDays: 2, isDirect: true, frequency: 'daily', priceNote: '重货 280 元/吨起', remark: '', updatedAt: D(14) },
  { company: 'comp_026', from: '义乌', to: '菏泽', transitDays: 2, isDirect: false, frequency: 'weekly', priceNote: '轻货 0.5 元/公斤', remark: '', updatedAt: D(55) },
  { company: 'comp_027', from: '天津', to: '德州', transitDays: 1, isDirect: true, frequency: 'daily', priceNote: '重货 150 元/吨起', remark: '', updatedAt: D(16) },
  { company: 'comp_028', from: '北京', to: '济南', transitDays: 1, isDirect: true, frequency: 'daily', priceNote: '重货 175 元/吨起', remark: '', updatedAt: D(2) },
  { company: 'comp_029', from: '武汉', to: '济宁', transitDays: 2, isDirect: true, frequency: 'daily', priceNote: '重货 310 元/吨起', remark: '', updatedAt: D(22) },
  { company: 'comp_030', from: '西安', to: '泰安', transitDays: 2, isDirect: true, frequency: 'weekday', priceNote: '重货 340 元/吨起', remark: '', updatedAt: D(80) },
  { company: 'comp_031', from: '成都', to: '济南', transitDays: 4, isDirect: false, frequency: 'weekly', priceNote: '铁路联运 500 元/吨起', remark: '', updatedAt: D(1) },
  { company: 'comp_031', from: '乌鲁木齐', to: '济南', transitDays: 5, isDirect: false, frequency: 'weekly', priceNote: '铁路联运 700 元/吨起', remark: '', updatedAt: D(1) },
  { company: 'comp_033', from: '广州', to: '青岛', transitDays: 3, isDirect: true, frequency: 'weekday', priceNote: '重货 520 元/吨起', remark: '', updatedAt: D(4) },
  { company: 'comp_035', from: '沈阳', to: '临沂', transitDays: 2, isDirect: true, frequency: 'daily', priceNote: '重货 380 元/吨起', remark: '', updatedAt: D(13) },
  { company: 'comp_036', from: '无锡', to: '潍坊', transitDays: 2, isDirect: false, frequency: 'weekly', priceNote: '重货 290 元/吨起', remark: '经苏州中转', updatedAt: D(35) },
  { company: 'comp_037', from: '大连', to: '烟台', transitDays: 1, isDirect: false, frequency: 'daily', priceNote: '轮渡 340 元/吨起', remark: '烟大轮渡联运', updatedAt: D(10) },
  { company: 'comp_039', from: '成都', to: '济南', transitDays: 3, isDirect: true, frequency: 'daily', priceNote: '重货 530 元/吨起', remark: '', updatedAt: D(19) },
  { company: 'comp_040', from: '沈阳', to: '潍坊', transitDays: 2, isDirect: true, frequency: 'weekday', priceNote: '重货 370 元/吨起', remark: '', updatedAt: D(65) }
];

/* ============================================================
 * 构建三张表（companies / routes / route_companies）
 *
 * 本函数是确定性的纯函数：同样输入必得同样输出，便于测试断言。
 * ============================================================ */

function buildTables() {
  const companies = RAW_COMPANIES.map((c) => {
    const o = Object.assign({}, c);
    delete o.id;
    const city = findCityByName(c.city);
    return Object.assign(o, {
      _id: c.id,
      province: c.province || (city && city.province) || '',
      viewCount: 0,
      createdAt: BASE_TIME,
      updatedAt: c.updatedAt || BASE_TIME
    });
  });

  const companyById = {};
  companies.forEach((c) => { companyById[c._id] = c; });

  /* --- routes：按 routeKey 去重 --- */
  const routeMap = {};
  const routeOrder = [];
  const links = [];

  RAW_LINKS.forEach((l, idx) => {
    const company = companyById[l.company];
    if (!company) return; // 数据引用错误，跳过（不静默造脏数据）

    const key = buildRouteKey(l.from, l.to);
    if (!key) return;

    if (!routeMap[key]) {
      const fc = findCityByName(l.from);
      const tc = findCityByName(l.to);
      routeMap[key] = {
        _id: 'route_' + key.replace(/[^0-9a-zA-Z\u4e00-\u9fa5]/g, '_'),
        fromCity: l.from,
        fromProvince: (fc && fc.province) || '',
        toCity: l.to,
        toProvince: (tc && tc.province) || '',
        fromCityId: fc ? fc.id : '',
        toCityId: tc ? tc.id : '',
        routeKey: key,
        companyCount: 0,
        createdAt: BASE_TIME,
        updatedAt: BASE_TIME
      };
      routeOrder.push(key);
    }

    const route = routeMap[key];
    route.companyCount += 1;
    if ((l.updatedAt || 0) > route.updatedAt) route.updatedAt = l.updatedAt;

    links.push({
      _id: 'rc_' + String(idx + 1).padStart(3, '0'),
      routeId: route._id,
      companyId: l.company,
      routeKey: key,
      transitDays: l.transitDays,
      isDirect: l.isDirect === true,
      frequency: l.frequency || '',
      priceNote: l.priceNote || '',
      remark: l.remark || '',
      createdAt: BASE_TIME,
      updatedAt: l.updatedAt || BASE_TIME
    });
  });

  const routes = routeOrder.map((k) => routeMap[k]);

  return { companies, routes, routeCompanies: links };
}

module.exports = {
  BASE_TIME,
  D,
  RAW_COMPANIES,
  RAW_LINKS,
  buildTables
};
