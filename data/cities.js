/**
 * 城市字典（PRD 附录 cities 表）
 * 第一版覆盖：山东省 16 地市 + 华东主要城市 + 全国主要物流枢纽
 *
 * 字段：name / province / pinyin / initial / isHot / sortOrder
 * sortOrder 越小越靠前
 */

const CITIES = [
  // ============ 山东省（核心区域，sortOrder 优先） ============
  { name: '济南', province: '山东省', pinyin: 'jinan', initial: 'jn', isHot: true, sortOrder: 1 },
  { name: '青岛', province: '山东省', pinyin: 'qingdao', initial: 'qd', isHot: true, sortOrder: 2 },
  { name: '临沂', province: '山东省', pinyin: 'linyi', initial: 'ly', isHot: true, sortOrder: 3 },
  { name: '潍坊', province: '山东省', pinyin: 'weifang', initial: 'wf', isHot: true, sortOrder: 4 },
  { name: '烟台', province: '山东省', pinyin: 'yantai', initial: 'yt', isHot: true, sortOrder: 5 },
  { name: '淄博', province: '山东省', pinyin: 'zibo', initial: 'zb', isHot: true, sortOrder: 6 },
  { name: '济宁', province: '山东省', pinyin: 'jining', initial: 'jn', isHot: false, sortOrder: 7 },
  { name: '泰安', province: '山东省', pinyin: 'taian', initial: 'ta', isHot: false, sortOrder: 8 },
  { name: '聊城', province: '山东省', pinyin: 'liaocheng', initial: 'lc', isHot: false, sortOrder: 9 },
  { name: '德州', province: '山东省', pinyin: 'dezhou', initial: 'dz', isHot: false, sortOrder: 10 },
  { name: '菏泽', province: '山东省', pinyin: 'heze', initial: 'hz', isHot: false, sortOrder: 11 },
  { name: '威海', province: '山东省', pinyin: 'weihai', initial: 'wh', isHot: false, sortOrder: 12 },
  { name: '枣庄', province: '山东省', pinyin: 'zaozhuang', initial: 'zz', isHot: false, sortOrder: 13 },
  { name: '日照', province: '山东省', pinyin: 'rizhao', initial: 'rz', isHot: false, sortOrder: 14 },
  { name: '东营', province: '山东省', pinyin: 'dongying', initial: 'dy', isHot: false, sortOrder: 15 },
  { name: '滨州', province: '山东省', pinyin: 'binzhou', initial: 'bz', isHot: false, sortOrder: 16 },

  // ============ 江苏省 ============
  { name: '南京', province: '江苏省', pinyin: 'nanjing', initial: 'nj', isHot: true, sortOrder: 20 },
  { name: '苏州', province: '江苏省', pinyin: 'suzhou', initial: 'sz', isHot: true, sortOrder: 21 },
  { name: '无锡', province: '江苏省', pinyin: 'wuxi', initial: 'wx', isHot: true, sortOrder: 22 },
  { name: '常州', province: '江苏省', pinyin: 'changzhou', initial: 'cz', isHot: false, sortOrder: 23 },
  { name: '南通', province: '江苏省', pinyin: 'nantong', initial: 'nt', isHot: false, sortOrder: 24 },
  { name: '徐州', province: '江苏省', pinyin: 'xuzhou', initial: 'xz', isHot: true, sortOrder: 25 },
  { name: '扬州', province: '江苏省', pinyin: 'yangzhou', initial: 'yz', isHot: false, sortOrder: 26 },
  { name: '盐城', province: '江苏省', pinyin: 'yancheng', initial: 'yc', isHot: false, sortOrder: 27 },
  { name: '泰州', province: '江苏省', pinyin: 'taizhou', initial: 'tz', isHot: false, sortOrder: 28 },
  { name: '镇江', province: '江苏省', pinyin: 'zhenjiang', initial: 'zj', isHot: false, sortOrder: 29 },
  { name: '连云港', province: '江苏省', pinyin: 'lianyungang', initial: 'lyg', isHot: false, sortOrder: 30 },
  { name: '宿迁', province: '江苏省', pinyin: 'suqian', initial: 'sq', isHot: false, sortOrder: 31 },
  { name: '淮安', province: '江苏省', pinyin: 'huaian', initial: 'ha', isHot: false, sortOrder: 32 },

  // ============ 浙江省 ============
  { name: '杭州', province: '浙江省', pinyin: 'hangzhou', initial: 'hz', isHot: true, sortOrder: 40 },
  { name: '宁波', province: '浙江省', pinyin: 'ningbo', initial: 'nb', isHot: true, sortOrder: 41 },
  { name: '温州', province: '浙江省', pinyin: 'wenzhou', initial: 'wz', isHot: true, sortOrder: 42 },
  { name: '嘉兴', province: '浙江省', pinyin: 'jiaxing', initial: 'jx', isHot: false, sortOrder: 43 },
  { name: '绍兴', province: '浙江省', pinyin: 'shaoxing', initial: 'sx', isHot: false, sortOrder: 44 },
  { name: '台州', province: '浙江省', pinyin: 'taizhou', initial: 'tz', isHot: false, sortOrder: 45 },
  { name: '金华', province: '浙江省', pinyin: 'jinhua', initial: 'jh', isHot: true, sortOrder: 46 },
  { name: '义乌', province: '浙江省', pinyin: 'yiwu', initial: 'yw', isHot: true, sortOrder: 47 },
  { name: '湖州', province: '浙江省', pinyin: 'huzhou', initial: 'hz', isHot: false, sortOrder: 48 },
  { name: '丽水', province: '浙江省', pinyin: 'lishui', initial: 'ls', isHot: false, sortOrder: 49 },
  { name: '衢州', province: '浙江省', pinyin: 'quzhou', initial: 'qz', isHot: false, sortOrder: 50 },
  { name: '舟山', province: '浙江省', pinyin: 'zhoushan', initial: 'zs', isHot: false, sortOrder: 51 },

  // ============ 上海市 ============
  { name: '上海', province: '上海市', pinyin: 'shanghai', initial: 'sh', isHot: true, sortOrder: 60 },

  // ============ 安徽省 ============
  { name: '合肥', province: '安徽省', pinyin: 'hefei', initial: 'hf', isHot: true, sortOrder: 70 },
  { name: '芜湖', province: '安徽省', pinyin: 'wuhu', initial: 'wh', isHot: false, sortOrder: 71 },
  { name: '蚌埠', province: '安徽省', pinyin: 'bengbu', initial: 'bb', isHot: false, sortOrder: 72 },
  { name: '阜阳', province: '安徽省', pinyin: 'fuyang', initial: 'fy', isHot: false, sortOrder: 73 },
  { name: '安庆', province: '安徽省', pinyin: 'anqing', initial: 'aq', isHot: false, sortOrder: 74 },

  // ============ 福建省 ============
  { name: '福州', province: '福建省', pinyin: 'fuzhou', initial: 'fz', isHot: true, sortOrder: 80 },
  { name: '厦门', province: '福建省', pinyin: 'xiamen', initial: 'xm', isHot: true, sortOrder: 81 },
  { name: '泉州', province: '福建省', pinyin: 'quanzhou', initial: 'qz', isHot: false, sortOrder: 82 },

  // ============ 江西省 ============
  { name: '南昌', province: '江西省', pinyin: 'nanchang', initial: 'nc', isHot: false, sortOrder: 90 },
  { name: '赣州', province: '江西省', pinyin: 'ganzhou', initial: 'gz', isHot: false, sortOrder: 91 },

  // ============ 河南省 ============
  { name: '郑州', province: '河南省', pinyin: 'zhengzhou', initial: 'zz', isHot: true, sortOrder: 100 },
  { name: '洛阳', province: '河南省', pinyin: 'luoyang', initial: 'ly', isHot: false, sortOrder: 101 },
  { name: '新乡', province: '河南省', pinyin: 'xinxiang', initial: 'xx', isHot: false, sortOrder: 102 },
  { name: '南阳', province: '河南省', pinyin: 'nanyang', initial: 'ny', isHot: false, sortOrder: 103 },

  // ============ 河北省 ============
  { name: '石家庄', province: '河北省', pinyin: 'shijiazhuang', initial: 'sjz', isHot: true, sortOrder: 110 },
  { name: '唐山', province: '河北省', pinyin: 'tangshan', initial: 'ts', isHot: false, sortOrder: 111 },
  { name: '保定', province: '河北省', pinyin: 'baoding', initial: 'bd', isHot: false, sortOrder: 112 },
  { name: '廊坊', province: '河北省', pinyin: 'langfang', initial: 'lf', isHot: false, sortOrder: 113 },

  // ============ 广东省 ============
  { name: '广州', province: '广东省', pinyin: 'guangzhou', initial: 'gz', isHot: true, sortOrder: 120 },
  { name: '深圳', province: '广东省', pinyin: 'shenzhen', initial: 'sz', isHot: true, sortOrder: 121 },
  { name: '东莞', province: '广东省', pinyin: 'dongguan', initial: 'dg', isHot: true, sortOrder: 122 },
  { name: '佛山', province: '广东省', pinyin: 'foshan', initial: 'fs', isHot: true, sortOrder: 123 },
  { name: '中山', province: '广东省', pinyin: 'zhongshan', initial: 'zs', isHot: false, sortOrder: 124 },
  { name: '汕头', province: '广东省', pinyin: 'shantou', initial: 'st', isHot: false, sortOrder: 125 },
  { name: '珠海', province: '广东省', pinyin: 'zhuhai', initial: 'zh', isHot: false, sortOrder: 126 },

  // ============ 京津 ============
  { name: '北京', province: '北京市', pinyin: 'beijing', initial: 'bj', isHot: true, sortOrder: 130 },
  { name: '天津', province: '天津市', pinyin: 'tianjin', initial: 'tj', isHot: true, sortOrder: 131 },

  // ============ 其他主要枢纽 ============
  { name: '武汉', province: '湖北省', pinyin: 'wuhan', initial: 'wh', isHot: true, sortOrder: 140 },
  { name: '长沙', province: '湖南省', pinyin: 'changsha', initial: 'cs', isHot: true, sortOrder: 141 },
  { name: '重庆', province: '重庆市', pinyin: 'chongqing', initial: 'cq', isHot: true, sortOrder: 143 },
  { name: '西安', province: '陕西省', pinyin: 'xian', initial: 'xa', isHot: true, sortOrder: 144 },
  { name: '太原', province: '山西省', pinyin: 'taiyuan', initial: 'ty', isHot: false, sortOrder: 145 },
  { name: '沈阳', province: '辽宁省', pinyin: 'shenyang', initial: 'sy', isHot: false, sortOrder: 146 },
  { name: '大连', province: '辽宁省', pinyin: 'dalian', initial: 'dl', isHot: false, sortOrder: 147 },
  { name: '长春', province: '吉林省', pinyin: 'changchun', initial: 'cc', isHot: false, sortOrder: 148 },
  { name: '哈尔滨', province: '黑龙江省', pinyin: 'haerbin', initial: 'heb', isHot: false, sortOrder: 149 },
  { name: '昆明', province: '云南省', pinyin: 'kunming', initial: 'km', isHot: false, sortOrder: 150 },
  { name: '贵阳', province: '贵州省', pinyin: 'guiyang', initial: 'gy', isHot: false, sortOrder: 151 },
  { name: '南宁', province: '广西壮族自治区', pinyin: 'nanning', initial: 'nn', isHot: false, sortOrder: 152 },
  { name: '兰州', province: '甘肃省', pinyin: 'lanzhou', initial: 'lz', isHot: false, sortOrder: 153 },
  { name: '乌鲁木齐', province: '新疆维吾尔自治区', pinyin: 'wulumuqi', initial: 'wlmq', isHot: false, sortOrder: 154 },
  { name: '呼和浩特', province: '内蒙古自治区', pinyin: 'huhehaote', initial: 'hhht', isHot: false, sortOrder: 155 },
  { name: '银川', province: '宁夏回族自治区', pinyin: 'yinchuan', initial: 'yc', isHot: false, sortOrder: 156 },
  { name: '西宁', province: '青海省', pinyin: 'xining', initial: 'xn', isHot: false, sortOrder: 157 },
  { name: '海口', province: '海南省', pinyin: 'haikou', initial: 'hk', isHot: false, sortOrder: 158 },
  { name: '拉萨', province: '西藏自治区', pinyin: 'lasa', initial: 'ls', isHot: false, sortOrder: 159 },

  // ============ 四川省（全量 21 个地级行政区） ============
  // 目的：选中四川省时能看到省内全部城市，而不是只有省会
  { name: '成都', province: '四川省', pinyin: 'chengdu', initial: 'cd', isHot: true, sortOrder: 142 },
  { name: '自贡', province: '四川省', pinyin: 'zigong', initial: 'zg', isHot: false, sortOrder: 160 },
  { name: '攀枝花', province: '四川省', pinyin: 'panzhihua', initial: 'pzh', isHot: false, sortOrder: 161 },
  { name: '泸州', province: '四川省', pinyin: 'luzhou', initial: 'lz', isHot: false, sortOrder: 162 },
  { name: '德阳', province: '四川省', pinyin: 'deyang', initial: 'dy', isHot: false, sortOrder: 163 },
  { name: '绵阳', province: '四川省', pinyin: 'mianyang', initial: 'my', isHot: false, sortOrder: 164 },
  { name: '广元', province: '四川省', pinyin: 'guangyuan', initial: 'gy', isHot: false, sortOrder: 165 },
  { name: '遂宁', province: '四川省', pinyin: 'suining', initial: 'sn', isHot: false, sortOrder: 166 },
  { name: '内江', province: '四川省', pinyin: 'neijiang', initial: 'nj', isHot: false, sortOrder: 167 },
  { name: '乐山', province: '四川省', pinyin: 'leshan', initial: 'ls', isHot: false, sortOrder: 168 },
  { name: '南充', province: '四川省', pinyin: 'nanchong', initial: 'nc', isHot: false, sortOrder: 169 },
  { name: '眉山', province: '四川省', pinyin: 'meishan', initial: 'ms', isHot: false, sortOrder: 170 },
  { name: '宜宾', province: '四川省', pinyin: 'yibin', initial: 'yb', isHot: false, sortOrder: 171 },
  { name: '广安', province: '四川省', pinyin: 'guangan', initial: 'ga', isHot: false, sortOrder: 172 },
  { name: '达州', province: '四川省', pinyin: 'dazhou', initial: 'dz', isHot: false, sortOrder: 173 },
  { name: '雅安', province: '四川省', pinyin: 'yaan', initial: 'ya', isHot: false, sortOrder: 174 },
  { name: '巴中', province: '四川省', pinyin: 'bazhong', initial: 'bz', isHot: false, sortOrder: 175 },
  { name: '资阳', province: '四川省', pinyin: 'ziyang', initial: 'zy', isHot: false, sortOrder: 176 },
  { name: '阿坝州', province: '四川省', pinyin: 'aba', initial: 'ab', isHot: false, sortOrder: 177 },
  { name: '甘孜州', province: '四川省', pinyin: 'ganzi', initial: 'gz', isHot: false, sortOrder: 178 },
  { name: '凉山州', province: '四川省', pinyin: 'liangshan', initial: 'lsz', isHot: false, sortOrder: 179 },

  // ============ 补齐：其他省份缺失的地级市 ============
  // 河南省
  { name: '开封', province: '河南省', pinyin: 'kaifeng', initial: 'kf', isHot: false, sortOrder: 180 },
  { name: '平顶山', province: '河南省', pinyin: 'pingdingshan', initial: 'pds', isHot: false, sortOrder: 181 },
  { name: '安阳', province: '河南省', pinyin: 'anyang', initial: 'ay', isHot: false, sortOrder: 182 },
  { name: '焦作', province: '河南省', pinyin: 'jiaozuo', initial: 'jz', isHot: false, sortOrder: 183 },
  { name: '许昌', province: '河南省', pinyin: 'xuchang', initial: 'xc', isHot: false, sortOrder: 184 },
  { name: '漯河', province: '河南省', pinyin: 'luohe', initial: 'lh', isHot: false, sortOrder: 185 },
  { name: '商丘', province: '河南省', pinyin: 'shangqiu', initial: 'sq', isHot: false, sortOrder: 186 },
  { name: '信阳', province: '河南省', pinyin: 'xinyang', initial: 'xy', isHot: false, sortOrder: 187 },
  { name: '周口', province: '河南省', pinyin: 'zhoukou', initial: 'zk', isHot: false, sortOrder: 188 },
  { name: '驻马店', province: '河南省', pinyin: 'zhumadian', initial: 'zmd', isHot: false, sortOrder: 189 },

  // 河北省
  { name: '秦皇岛', province: '河北省', pinyin: 'qinhuangdao', initial: 'qhd', isHot: false, sortOrder: 190 },
  { name: '邯郸', province: '河北省', pinyin: 'handan', initial: 'hd', isHot: false, sortOrder: 191 },
  { name: '邢台', province: '河北省', pinyin: 'xingtai', initial: 'xt', isHot: false, sortOrder: 192 },
  { name: '张家口', province: '河北省', pinyin: 'zhangjiakou', initial: 'zjk', isHot: false, sortOrder: 193 },
  { name: '承德', province: '河北省', pinyin: 'chengde', initial: 'cd', isHot: false, sortOrder: 194 },
  { name: '沧州', province: '河北省', pinyin: 'cangzhou', initial: 'cz', isHot: false, sortOrder: 195 },
  { name: '衡水', province: '河北省', pinyin: 'hengshui', initial: 'hs', isHot: false, sortOrder: 196 },

  // 广东省
  { name: '韶关', province: '广东省', pinyin: 'shaoguan', initial: 'sg', isHot: false, sortOrder: 197 },
  { name: '江门', province: '广东省', pinyin: 'jiangmen', initial: 'jm', isHot: false, sortOrder: 198 },
  { name: '湛江', province: '广东省', pinyin: 'zhanjiang', initial: 'zj', isHot: false, sortOrder: 199 },
  { name: '茂名', province: '广东省', pinyin: 'maoming', initial: 'mm', isHot: false, sortOrder: 200 },
  { name: '肇庆', province: '广东省', pinyin: 'zhaoqing', initial: 'zq', isHot: false, sortOrder: 201 },
  { name: '惠州', province: '广东省', pinyin: 'huizhou', initial: 'hz', isHot: false, sortOrder: 202 },
  { name: '梅州', province: '广东省', pinyin: 'meizhou', initial: 'mz', isHot: false, sortOrder: 203 },
  { name: '汕尾', province: '广东省', pinyin: 'shanwei', initial: 'sw', isHot: false, sortOrder: 204 },
  { name: '河源', province: '广东省', pinyin: 'heyuan', initial: 'hy', isHot: false, sortOrder: 205 },
  { name: '阳江', province: '广东省', pinyin: 'yangjiang', initial: 'yj', isHot: false, sortOrder: 206 },
  { name: '清远', province: '广东省', pinyin: 'qingyuan', initial: 'qy', isHot: false, sortOrder: 207 },
  { name: '潮州', province: '广东省', pinyin: 'chaozhou', initial: 'cz', isHot: false, sortOrder: 208 },
  { name: '揭阳', province: '广东省', pinyin: 'jieyang', initial: 'jy', isHot: false, sortOrder: 209 },
  { name: '云浮', province: '广东省', pinyin: 'yunfu', initial: 'yf', isHot: false, sortOrder: 210 },

  // 江苏省（补宿迁以外的缺口）
  { name: '昆山', province: '江苏省', pinyin: 'kunshan', initial: 'ks', isHot: false, sortOrder: 211 },
  { name: '江阴', province: '江苏省', pinyin: 'jiangyin', initial: 'jy', isHot: false, sortOrder: 212 },
  { name: '常熟', province: '江苏省', pinyin: 'changshu', initial: 'cs', isHot: false, sortOrder: 213 },

  // 浙江省（补物流强县市）
  { name: '慈溪', province: '浙江省', pinyin: 'cixi', initial: 'cx', isHot: false, sortOrder: 214 },
  { name: '余姚', province: '浙江省', pinyin: 'yuyao', initial: 'yy', isHot: false, sortOrder: 215 },
  { name: '诸暨', province: '浙江省', pinyin: 'zhuji', initial: 'zj', isHot: false, sortOrder: 216 },
  { name: '温岭', province: '浙江省', pinyin: 'wenling', initial: 'wl', isHot: false, sortOrder: 217 },

  // 安徽省（补主要地级市）
  { name: '淮南', province: '安徽省', pinyin: 'huainan', initial: 'hn', isHot: false, sortOrder: 219 },
  { name: '马鞍山', province: '安徽省', pinyin: 'maanshan', initial: 'mas', isHot: false, sortOrder: 220 },
  { name: '淮北', province: '安徽省', pinyin: 'huaibei', initial: 'hb', isHot: false, sortOrder: 221 },
  { name: '铜陵', province: '安徽省', pinyin: 'tongling', initial: 'tl', isHot: false, sortOrder: 222 },
  { name: '黄山', province: '安徽省', pinyin: 'huangshan', initial: 'hs', isHot: false, sortOrder: 223 },
  { name: '滁州', province: '安徽省', pinyin: 'chuzhou', initial: 'cz', isHot: false, sortOrder: 224 },
  { name: '宿州', province: '安徽省', pinyin: 'suzhou', initial: 'sz', isHot: false, sortOrder: 225 },
  { name: '六安', province: '安徽省', pinyin: 'luan', initial: 'la', isHot: false, sortOrder: 226 },
  { name: '亳州', province: '安徽省', pinyin: 'bozhou', initial: 'bz', isHot: false, sortOrder: 227 },
  { name: '池州', province: '安徽省', pinyin: 'chizhou', initial: 'cz', isHot: false, sortOrder: 228 },
  { name: '宣城', province: '安徽省', pinyin: 'xuancheng', initial: 'xc', isHot: false, sortOrder: 229 },

  // 福建省（补主要地级市）
  { name: '莆田', province: '福建省', pinyin: 'putian', initial: 'pt', isHot: false, sortOrder: 230 },
  { name: '三明', province: '福建省', pinyin: 'sanming', initial: 'sm', isHot: false, sortOrder: 231 },
  { name: '漳州', province: '福建省', pinyin: 'zhangzhou', initial: 'zz', isHot: false, sortOrder: 232 },
  { name: '南平', province: '福建省', pinyin: 'nanping', initial: 'np', isHot: false, sortOrder: 233 },
  { name: '龙岩', province: '福建省', pinyin: 'longyan', initial: 'ly', isHot: false, sortOrder: 234 },
  { name: '宁德', province: '福建省', pinyin: 'ningde', initial: 'nd', isHot: false, sortOrder: 235 },

  // 江西省（补主要地级市）
  { name: '景德镇', province: '江西省', pinyin: 'jingdezhen', initial: 'jdz', isHot: false, sortOrder: 236 },
  { name: '萍乡', province: '江西省', pinyin: 'pingxiang', initial: 'px', isHot: false, sortOrder: 237 },
  { name: '九江', province: '江西省', pinyin: 'jiujiang', initial: 'jj', isHot: false, sortOrder: 238 },
  { name: '新余', province: '江西省', pinyin: 'xinyu', initial: 'xy', isHot: false, sortOrder: 239 },
  { name: '鹰潭', province: '江西省', pinyin: 'yingtan', initial: 'yt', isHot: false, sortOrder: 240 },
  { name: '吉安', province: '江西省', pinyin: 'jian', initial: 'ja', isHot: false, sortOrder: 241 },
  { name: '宜春', province: '江西省', pinyin: 'yichun', initial: 'yc', isHot: false, sortOrder: 242 },
  { name: '抚州', province: '江西省', pinyin: 'fuzhou', initial: 'fz', isHot: false, sortOrder: 243 },
  { name: '上饶', province: '江西省', pinyin: 'shangrao', initial: 'sr', isHot: false, sortOrder: 244 },

  // 河南省（补主要地级市）
  { name: '濮阳', province: '河南省', pinyin: 'puyang', initial: 'py', isHot: false, sortOrder: 245 },
  { name: '三门峡', province: '河南省', pinyin: 'sanmenxia', initial: 'smx', isHot: false, sortOrder: 246 },

  // 湖北省（补主要地级市）
  { name: '黄石', province: '湖北省', pinyin: 'huangshi', initial: 'hs', isHot: false, sortOrder: 247 },
  { name: '十堰', province: '湖北省', pinyin: 'shiyan', initial: 'sy', isHot: false, sortOrder: 248 },
  { name: '宜昌', province: '湖北省', pinyin: 'yichang', initial: 'yc', isHot: false, sortOrder: 249 },
  { name: '襄阳', province: '湖北省', pinyin: 'xiangyang', initial: 'xy', isHot: false, sortOrder: 250 },
  { name: '鄂州', province: '湖北省', pinyin: 'ezhou', initial: 'ez', isHot: false, sortOrder: 251 },
  { name: '荆门', province: '湖北省', pinyin: 'jingmen', initial: 'jm', isHot: false, sortOrder: 252 },
  { name: '孝感', province: '湖北省', pinyin: 'xiaogan', initial: 'xg', isHot: false, sortOrder: 253 },
  { name: '荆州', province: '湖北省', pinyin: 'jingzhou', initial: 'jz', isHot: false, sortOrder: 254 },
  { name: '黄冈', province: '湖北省', pinyin: 'huanggang', initial: 'hg', isHot: false, sortOrder: 255 },
  { name: '咸宁', province: '湖北省', pinyin: 'xianning', initial: 'xn', isHot: false, sortOrder: 256 },
  { name: '随州', province: '湖北省', pinyin: 'suizhou', initial: 'sz', isHot: false, sortOrder: 257 },
  { name: '恩施州', province: '湖北省', pinyin: 'enshizhou', initial: 'esz', isHot: false, sortOrder: 258 },

  // 湖南省（补主要地级市）
  { name: '株洲', province: '湖南省', pinyin: 'zhuzhou', initial: 'zz', isHot: false, sortOrder: 259 },
  { name: '湘潭', province: '湖南省', pinyin: 'xiangtan', initial: 'xt', isHot: false, sortOrder: 260 },
  { name: '衡阳', province: '湖南省', pinyin: 'hengyang', initial: 'hy', isHot: false, sortOrder: 261 },
  { name: '邵阳', province: '湖南省', pinyin: 'shaoyang', initial: 'sy', isHot: false, sortOrder: 262 },
  { name: '岳阳', province: '湖南省', pinyin: 'yueyang', initial: 'yy', isHot: false, sortOrder: 263 },
  { name: '常德', province: '湖南省', pinyin: 'changde', initial: 'cd', isHot: false, sortOrder: 264 },
  { name: '张家界', province: '湖南省', pinyin: 'zhangjiajie', initial: 'zjj', isHot: false, sortOrder: 265 },
  { name: '益阳', province: '湖南省', pinyin: 'yiyang', initial: 'yy', isHot: false, sortOrder: 266 },
  { name: '郴州', province: '湖南省', pinyin: 'chenzhou', initial: 'cz', isHot: false, sortOrder: 267 },
  { name: '永州', province: '湖南省', pinyin: 'yongzhou', initial: 'yz', isHot: false, sortOrder: 268 },
  { name: '怀化', province: '湖南省', pinyin: 'huaihua', initial: 'hh', isHot: false, sortOrder: 269 },
  { name: '娄底', province: '湖南省', pinyin: 'loudi', initial: 'ld', isHot: false, sortOrder: 270 },
  { name: '湘西州', province: '湖南省', pinyin: 'xiangxizhou', initial: 'xxz', isHot: false, sortOrder: 271 },

  // ============ 补充：为「仅有省会」的省份补全全部地级行政区 ============
  { name: '铜川', province: '陕西省', pinyin: 'tongchuan', initial: 'tc', isHot: false, sortOrder: 272 },
  { name: '宝鸡', province: '陕西省', pinyin: 'baoji', initial: 'bj', isHot: false, sortOrder: 273 },
  { name: '咸阳', province: '陕西省', pinyin: 'xianyang', initial: 'xy', isHot: false, sortOrder: 274 },
  { name: '渭南', province: '陕西省', pinyin: 'weinan', initial: 'wn', isHot: false, sortOrder: 275 },
  { name: '延安', province: '陕西省', pinyin: 'yanan', initial: 'ya', isHot: false, sortOrder: 276 },
  { name: '汉中', province: '陕西省', pinyin: 'hanzhong', initial: 'hz', isHot: false, sortOrder: 277 },
  { name: '榆林', province: '陕西省', pinyin: 'yulin', initial: 'yl', isHot: false, sortOrder: 278 },
  { name: '安康', province: '陕西省', pinyin: 'ankang', initial: 'ak', isHot: false, sortOrder: 279 },
  { name: '商洛', province: '陕西省', pinyin: 'shangluo', initial: 'sl', isHot: false, sortOrder: 280 },
  { name: '大同', province: '山西省', pinyin: 'datong', initial: 'dt', isHot: false, sortOrder: 281 },
  { name: '阳泉', province: '山西省', pinyin: 'yangquan', initial: 'yq', isHot: false, sortOrder: 282 },
  { name: '长治', province: '山西省', pinyin: 'changzhi', initial: 'cz', isHot: false, sortOrder: 283 },
  { name: '晋城', province: '山西省', pinyin: 'jincheng', initial: 'jc', isHot: false, sortOrder: 284 },
  { name: '朔州', province: '山西省', pinyin: 'shuozhou', initial: 'sz', isHot: false, sortOrder: 285 },
  { name: '晋中', province: '山西省', pinyin: 'jinzhong', initial: 'jz', isHot: false, sortOrder: 286 },
  { name: '运城', province: '山西省', pinyin: 'yuncheng', initial: 'yc', isHot: false, sortOrder: 287 },
  { name: '忻州', province: '山西省', pinyin: 'xinzhou', initial: 'xz', isHot: false, sortOrder: 288 },
  { name: '临汾', province: '山西省', pinyin: 'linfen', initial: 'lf', isHot: false, sortOrder: 289 },
  { name: '吕梁', province: '山西省', pinyin: 'lvliang', initial: 'll', isHot: false, sortOrder: 290 },
  { name: '鞍山', province: '辽宁省', pinyin: 'anshan', initial: 'as', isHot: false, sortOrder: 291 },
  { name: '抚顺', province: '辽宁省', pinyin: 'fushun', initial: 'fs', isHot: false, sortOrder: 292 },
  { name: '本溪', province: '辽宁省', pinyin: 'benxi', initial: 'bx', isHot: false, sortOrder: 293 },
  { name: '丹东', province: '辽宁省', pinyin: 'dandong', initial: 'dd', isHot: false, sortOrder: 294 },
  { name: '锦州', province: '辽宁省', pinyin: 'jinzhou', initial: 'jz', isHot: false, sortOrder: 295 },
  { name: '营口', province: '辽宁省', pinyin: 'yingkou', initial: 'yk', isHot: false, sortOrder: 296 },
  { name: '阜新', province: '辽宁省', pinyin: 'fuxin', initial: 'fx', isHot: false, sortOrder: 297 },
  { name: '辽阳', province: '辽宁省', pinyin: 'liaoyang', initial: 'ly', isHot: false, sortOrder: 298 },
  { name: '盘锦', province: '辽宁省', pinyin: 'panjin', initial: 'pj', isHot: false, sortOrder: 299 },
  { name: '铁岭', province: '辽宁省', pinyin: 'tieling', initial: 'tl', isHot: false, sortOrder: 300 },
  { name: '朝阳', province: '辽宁省', pinyin: 'chaoyang', initial: 'cy', isHot: false, sortOrder: 301 },
  { name: '葫芦岛', province: '辽宁省', pinyin: 'huludao', initial: 'hld', isHot: false, sortOrder: 302 },
  { name: '吉林', province: '吉林省', pinyin: 'jilin', initial: 'jl', isHot: false, sortOrder: 303 },
  { name: '四平', province: '吉林省', pinyin: 'siping', initial: 'sp', isHot: false, sortOrder: 304 },
  { name: '辽源', province: '吉林省', pinyin: 'liaoyuan', initial: 'ly', isHot: false, sortOrder: 305 },
  { name: '通化', province: '吉林省', pinyin: 'tonghua', initial: 'th', isHot: false, sortOrder: 306 },
  { name: '白山', province: '吉林省', pinyin: 'baishan', initial: 'bs', isHot: false, sortOrder: 307 },
  { name: '松原', province: '吉林省', pinyin: 'songyuan', initial: 'sy', isHot: false, sortOrder: 308 },
  { name: '白城', province: '吉林省', pinyin: 'baicheng', initial: 'bc', isHot: false, sortOrder: 309 },
  { name: '延边州', province: '吉林省', pinyin: 'yanbianzhou', initial: 'ybz', isHot: false, sortOrder: 310 },
  { name: '齐齐哈尔', province: '黑龙江省', pinyin: 'qiqihaer', initial: 'qqhe', isHot: false, sortOrder: 311 },
  { name: '鸡西', province: '黑龙江省', pinyin: 'jixi', initial: 'jx', isHot: false, sortOrder: 312 },
  { name: '鹤岗', province: '黑龙江省', pinyin: 'hegang', initial: 'hg', isHot: false, sortOrder: 313 },
  { name: '双鸭山', province: '黑龙江省', pinyin: 'shuangyashan', initial: 'sys', isHot: false, sortOrder: 314 },
  { name: '大庆', province: '黑龙江省', pinyin: 'daqing', initial: 'dq', isHot: false, sortOrder: 315 },
  { name: '伊春', province: '黑龙江省', pinyin: 'yichun', initial: 'yc', isHot: false, sortOrder: 316 },
  { name: '佳木斯', province: '黑龙江省', pinyin: 'jiamusi', initial: 'jms', isHot: false, sortOrder: 317 },
  { name: '七台河', province: '黑龙江省', pinyin: 'qitaihe', initial: 'qth', isHot: false, sortOrder: 318 },
  { name: '牡丹江', province: '黑龙江省', pinyin: 'mudanjiang', initial: 'mdj', isHot: false, sortOrder: 319 },
  { name: '黑河', province: '黑龙江省', pinyin: 'heihe', initial: 'hh', isHot: false, sortOrder: 320 },
  { name: '绥化', province: '黑龙江省', pinyin: 'suihua', initial: 'sh', isHot: false, sortOrder: 321 },
  { name: '大兴安岭', province: '黑龙江省', pinyin: 'daxinganling', initial: 'dxal', isHot: false, sortOrder: 322 },
  { name: '曲靖', province: '云南省', pinyin: 'qujing', initial: 'qj', isHot: false, sortOrder: 323 },
  { name: '玉溪', province: '云南省', pinyin: 'yuxi', initial: 'yx', isHot: false, sortOrder: 324 },
  { name: '保山', province: '云南省', pinyin: 'baoshan', initial: 'bs', isHot: false, sortOrder: 325 },
  { name: '昭通', province: '云南省', pinyin: 'zhaotong', initial: 'zt', isHot: false, sortOrder: 326 },
  { name: '丽江', province: '云南省', pinyin: 'lijiang', initial: 'lj', isHot: false, sortOrder: 327 },
  { name: '普洱', province: '云南省', pinyin: 'puer', initial: 'pe', isHot: false, sortOrder: 328 },
  { name: '临沧', province: '云南省', pinyin: 'lincang', initial: 'lc', isHot: false, sortOrder: 329 },
  { name: '楚雄州', province: '云南省', pinyin: 'chuxiongzhou', initial: 'cxz', isHot: false, sortOrder: 330 },
  { name: '红河州', province: '云南省', pinyin: 'honghezhou', initial: 'hhz', isHot: false, sortOrder: 331 },
  { name: '文山州', province: '云南省', pinyin: 'wenshanzhou', initial: 'wsz', isHot: false, sortOrder: 332 },
  { name: '西双版纳州', province: '云南省', pinyin: 'xishuangbannazhou', initial: 'xsbnz', isHot: false, sortOrder: 333 },
  { name: '大理州', province: '云南省', pinyin: 'dalizhou', initial: 'dlz', isHot: false, sortOrder: 334 },
  { name: '德宏州', province: '云南省', pinyin: 'dehongzhou', initial: 'dhz', isHot: false, sortOrder: 335 },
  { name: '怒江州', province: '云南省', pinyin: 'nujiangzhou', initial: 'njz', isHot: false, sortOrder: 336 },
  { name: '迪庆州', province: '云南省', pinyin: 'diqingzhou', initial: 'dqz', isHot: false, sortOrder: 337 },
  { name: '六盘水', province: '贵州省', pinyin: 'liupanshui', initial: 'lps', isHot: false, sortOrder: 338 },
  { name: '遵义', province: '贵州省', pinyin: 'zunyi', initial: 'zy', isHot: false, sortOrder: 339 },
  { name: '安顺', province: '贵州省', pinyin: 'anshun', initial: 'as', isHot: false, sortOrder: 340 },
  { name: '毕节', province: '贵州省', pinyin: 'bijie', initial: 'bj', isHot: false, sortOrder: 341 },
  { name: '铜仁', province: '贵州省', pinyin: 'tongren', initial: 'tr', isHot: false, sortOrder: 342 },
  { name: '黔西南州', province: '贵州省', pinyin: 'qianxinan', initial: 'qxnz', isHot: false, sortOrder: 343 },
  { name: '黔东南州', province: '贵州省', pinyin: 'qiandongnan', initial: 'qdnz', isHot: false, sortOrder: 344 },
  { name: '黔南州', province: '贵州省', pinyin: 'qiannan', initial: 'qnz', isHot: false, sortOrder: 345 },
  { name: '柳州', province: '广西壮族自治区', pinyin: 'liuzhou', initial: 'lz', isHot: false, sortOrder: 346 },
  { name: '桂林', province: '广西壮族自治区', pinyin: 'guilin', initial: 'gl', isHot: false, sortOrder: 347 },
  { name: '梧州', province: '广西壮族自治区', pinyin: 'wuzhou', initial: 'wz', isHot: false, sortOrder: 348 },
  { name: '北海', province: '广西壮族自治区', pinyin: 'beihai', initial: 'bh', isHot: false, sortOrder: 349 },
  { name: '防城港', province: '广西壮族自治区', pinyin: 'fangchenggang', initial: 'fcg', isHot: false, sortOrder: 350 },
  { name: '钦州', province: '广西壮族自治区', pinyin: 'qinzhou', initial: 'qz', isHot: false, sortOrder: 351 },
  { name: '贵港', province: '广西壮族自治区', pinyin: 'guigang', initial: 'gg', isHot: false, sortOrder: 352 },
  { name: '玉林', province: '广西壮族自治区', pinyin: 'yulin', initial: 'yl', isHot: false, sortOrder: 353 },
  { name: '百色', province: '广西壮族自治区', pinyin: 'baise', initial: 'bs', isHot: false, sortOrder: 354 },
  { name: '贺州', province: '广西壮族自治区', pinyin: 'hezhou', initial: 'hz', isHot: false, sortOrder: 355 },
  { name: '河池', province: '广西壮族自治区', pinyin: 'hechi', initial: 'hc', isHot: false, sortOrder: 356 },
  { name: '来宾', province: '广西壮族自治区', pinyin: 'laibin', initial: 'lb', isHot: false, sortOrder: 357 },
  { name: '崇左', province: '广西壮族自治区', pinyin: 'chongzuo', initial: 'cz', isHot: false, sortOrder: 358 },
  { name: '嘉峪关', province: '甘肃省', pinyin: 'jiayuguan', initial: 'jyg', isHot: false, sortOrder: 359 },
  { name: '金昌', province: '甘肃省', pinyin: 'jinchang', initial: 'jc', isHot: false, sortOrder: 360 },
  { name: '白银', province: '甘肃省', pinyin: 'baiyin', initial: 'by', isHot: false, sortOrder: 361 },
  { name: '天水', province: '甘肃省', pinyin: 'tianshui', initial: 'ts', isHot: false, sortOrder: 362 },
  { name: '武威', province: '甘肃省', pinyin: 'wuwei', initial: 'ww', isHot: false, sortOrder: 363 },
  { name: '张掖', province: '甘肃省', pinyin: 'zhangye', initial: 'zy', isHot: false, sortOrder: 364 },
  { name: '平凉', province: '甘肃省', pinyin: 'pingliang', initial: 'pl', isHot: false, sortOrder: 365 },
  { name: '酒泉', province: '甘肃省', pinyin: 'jiuquan', initial: 'jq', isHot: false, sortOrder: 366 },
  { name: '庆阳', province: '甘肃省', pinyin: 'qingyang', initial: 'qy', isHot: false, sortOrder: 367 },
  { name: '定西', province: '甘肃省', pinyin: 'dingxi', initial: 'dx', isHot: false, sortOrder: 368 },
  { name: '陇南', province: '甘肃省', pinyin: 'longnan', initial: 'ln', isHot: false, sortOrder: 369 },
  { name: '临夏州', province: '甘肃省', pinyin: 'linxiazf', initial: 'lxz', isHot: false, sortOrder: 370 },
  { name: '甘南州', province: '甘肃省', pinyin: 'gannanzf', initial: 'gnz', isHot: false, sortOrder: 371 },
  { name: '克拉玛依', province: '新疆维吾尔自治区', pinyin: 'kelamayi', initial: 'klmy', isHot: false, sortOrder: 372 },
  { name: '吐鲁番', province: '新疆维吾尔自治区', pinyin: 'turpan', initial: 'tlf', isHot: false, sortOrder: 373 },
  { name: '哈密', province: '新疆维吾尔自治区', pinyin: 'hami', initial: 'hm', isHot: false, sortOrder: 374 },
  { name: '昌吉州', province: '新疆维吾尔自治区', pinyin: 'changjizf', initial: 'cjz', isHot: false, sortOrder: 375 },
  { name: '博尔塔拉州', province: '新疆维吾尔自治区', pinyin: 'boertalazf', initial: 'betlz', isHot: false, sortOrder: 376 },
  { name: '巴音郭楞州', province: '新疆维吾尔自治区', pinyin: 'bayinguoleng', initial: 'byglz', isHot: false, sortOrder: 377 },
  { name: '阿克苏', province: '新疆维吾尔自治区', pinyin: 'akesu', initial: 'aks', isHot: false, sortOrder: 378 },
  { name: '克孜勒苏州', province: '新疆维吾尔自治区', pinyin: 'kezilesu', initial: 'kzls', isHot: false, sortOrder: 379 },
  { name: '喀什', province: '新疆维吾尔自治区', pinyin: 'kashi', initial: 'ks', isHot: false, sortOrder: 380 },
  { name: '和田', province: '新疆维吾尔自治区', pinyin: 'hetian', initial: 'ht', isHot: false, sortOrder: 381 },
  { name: '伊犁州', province: '新疆维吾尔自治区', pinyin: 'yilizf', initial: 'ylz', isHot: false, sortOrder: 382 },
  { name: '塔城', province: '新疆维吾尔自治区', pinyin: 'tacheng', initial: 'tc', isHot: false, sortOrder: 383 },
  { name: '阿勒泰', province: '新疆维吾尔自治区', pinyin: 'aletai', initial: 'alt', isHot: false, sortOrder: 384 },
  { name: '包头', province: '内蒙古自治区', pinyin: 'baotou', initial: 'bt', isHot: false, sortOrder: 385 },
  { name: '乌海', province: '内蒙古自治区', pinyin: 'wuhai', initial: 'wh', isHot: false, sortOrder: 386 },
  { name: '赤峰', province: '内蒙古自治区', pinyin: 'chifeng', initial: 'cf', isHot: false, sortOrder: 387 },
  { name: '通辽', province: '内蒙古自治区', pinyin: 'tongliao', initial: 'tl', isHot: false, sortOrder: 388 },
  { name: '鄂尔多斯', province: '内蒙古自治区', pinyin: 'eerduosi', initial: 'eeds', isHot: false, sortOrder: 389 },
  { name: '呼伦贝尔', province: '内蒙古自治区', pinyin: 'hulunbeier', initial: 'hlbe', isHot: false, sortOrder: 390 },
  { name: '巴彦淖尔', province: '内蒙古自治区', pinyin: 'bayannaoer', initial: 'bynr', isHot: false, sortOrder: 391 },
  { name: '乌兰察布', province: '内蒙古自治区', pinyin: 'wulanchabu', initial: 'wlcb', isHot: false, sortOrder: 392 },
  { name: '兴安盟', province: '内蒙古自治区', pinyin: 'xinganmeng', initial: 'xam', isHot: false, sortOrder: 393 },
  { name: '锡林郭勒盟', province: '内蒙古自治区', pinyin: 'xilinguolemeng', initial: 'xlglm', isHot: false, sortOrder: 394 },
  { name: '阿拉善盟', province: '内蒙古自治区', pinyin: 'alashanmeng', initial: 'alsm', isHot: false, sortOrder: 395 },
  { name: '石嘴山', province: '宁夏回族自治区', pinyin: 'shizuishan', initial: 'szs', isHot: false, sortOrder: 396 },
  { name: '吴忠', province: '宁夏回族自治区', pinyin: 'wuzhong', initial: 'wz', isHot: false, sortOrder: 397 },
  { name: '固原', province: '宁夏回族自治区', pinyin: 'guyuan', initial: 'gy', isHot: false, sortOrder: 398 },
  { name: '中卫', province: '宁夏回族自治区', pinyin: 'zhongwei', initial: 'zw', isHot: false, sortOrder: 399 },
  { name: '海东', province: '青海省', pinyin: 'haidong', initial: 'hd', isHot: false, sortOrder: 400 },
  { name: '海北州', province: '青海省', pinyin: 'haibeizf', initial: 'hbz', isHot: false, sortOrder: 401 },
  { name: '黄南州', province: '青海省', pinyin: 'huangnanzf', initial: 'hnz', isHot: false, sortOrder: 402 },
  { name: '海南州', province: '青海省', pinyin: 'hainanzf', initial: 'hnz', isHot: false, sortOrder: 403 },
  { name: '果洛州', province: '青海省', pinyin: 'guoluozf', initial: 'glz', isHot: false, sortOrder: 404 },
  { name: '玉树州', province: '青海省', pinyin: 'yushuzf', initial: 'ysz', isHot: false, sortOrder: 405 },
  { name: '海西州', province: '青海省', pinyin: 'haixizf', initial: 'hxz', isHot: false, sortOrder: 406 },
  { name: '三亚', province: '海南省', pinyin: 'sanya', initial: 'sy', isHot: false, sortOrder: 407 },
  { name: '三沙', province: '海南省', pinyin: 'sansha', initial: 'ss', isHot: false, sortOrder: 408 },
  { name: '儋州', province: '海南省', pinyin: 'danzhou', initial: 'dz', isHot: false, sortOrder: 409 },
  { name: '日喀则', province: '西藏自治区', pinyin: 'rikaze', initial: 'rkz', isHot: false, sortOrder: 410 },
  { name: '昌都', province: '西藏自治区', pinyin: 'changdu', initial: 'cd', isHot: false, sortOrder: 411 },
  { name: '林芝', province: '西藏自治区', pinyin: 'linzhi', initial: 'lz', isHot: false, sortOrder: 412 },
  { name: '山南', province: '西藏自治区', pinyin: 'shannan', initial: 'sn', isHot: false, sortOrder: 413 },
  { name: '那曲', province: '西藏自治区', pinyin: 'naqu', initial: 'nq', isHot: false, sortOrder: 414 },
  { name: '阿里', province: '西藏自治区', pinyin: 'ali', initial: 'al', isHot: false, sortOrder: 415 },
];

/**
 * 为城市分配稳定 ID（用于 routeKey 与关联查询）
 * 规则：province 缩写 + 拼音，保证可读且唯一
 */
const PROVINCE_ABBR = {
  山东省: 'sd',
  江苏省: 'js',
  浙江省: 'zj',
  上海市: 'sh',
  安徽省: 'ah',
  福建省: 'fj',
  江西省: 'jx',
  河南省: 'hn',
  河北省: 'hb',
  广东省: 'gd',
  北京市: 'bj',
  天津市: 'tj',
  湖北省: 'hub',
  湖南省: 'hun',
  四川省: 'sc',
  重庆市: 'cq',
  陕西省: 'sn',
  山西省: 'sx',
  辽宁省: 'ln',
  吉林省: 'jl',
  黑龙江省: 'hlj',
  云南省: 'yn',
  贵州省: 'gz',
  广西壮族自治区: 'gx',
  甘肃省: 'gs',
  新疆维吾尔自治区: 'xj',
  内蒙古自治区: 'nmg',
  宁夏回族自治区: 'nx',
  青海省: 'qh',
  海南省: 'hi',
  西藏自治区: 'xz'
};

function buildCityId(city) {
  const abbr = PROVINCE_ABBR[city.province] || 'other';
  return `${abbr}_${city.pinyin}`;
}

const CITY_LIST = CITIES.map((city) => Object.assign({}, city, {
  _id: buildCityId(city)
}));

/** 热门城市（首页展示用） */
const HOT_CITIES = CITY_LIST
  .filter((c) => c.isHot)
  .sort((a, b) => a.sortOrder - b.sortOrder)
  .slice(0, 12);

/** 按名称查找城市 */
function findCityByName(name) {
  if (!name) return null;
  const target = String(name).trim();
  return CITY_LIST.find((c) => c.name === target) || null;
}

/** 按 ID 查找城市 */
function findCityById(id) {
  if (!id) return null;
  return CITY_LIST.find((c) => c._id === id) || null;
}

/** 获取全部省份（按 sortOrder 首次出现顺序） */
function getProvinces() {
  const seen = new Set();
  const result = [];
  CITY_LIST.forEach((c) => {
    if (!seen.has(c.province)) {
      seen.add(c.province);
      result.push(c.province);
    }
  });
  return result;
}

module.exports = {
  CITIES: CITY_LIST,
  HOT_CITIES,
  PROVINCE_ABBR,
  buildCityId,
  findCityByName,
  findCityById,
  getProvinces
};
