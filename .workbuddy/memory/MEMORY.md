# 物流专线查询 - 项目长期备忘

## 🎉 上线状态（2026-09-21）
- **小程序已通过微信审核并正式上线**。生产环境，代码即生产资产。
- **上线后变更纪律**：任何代码改动都需重新提交审核；不得在生产配置上做"顺手优化"（如 `libVersion` 保持 `trial` 不动）；改动前先在 PRD 定位需求编号，改后同步更新条目。
- 主体为**个人**（陈镇），服务类目「工具 → 信息查询」，客服电话/微信 15165018553。
- **⚠️ 远程备份仍缺失**（git 仅本地 `main` 分支，无 remote）。已上线，丢失代价高，优先级最高。

## ★ 信息架构 v6.0（2026-09-21 全站重设计，最重要）
> 依据 8 张参考图重构，用户全权委托。**后续开发必须遵循这套结构**。

- **tabBar 三 tab**：首页 / **查专线** / **查公司**（`app.json`）。收藏与我的已**移出 tabBar**：
  - 收藏 → 「查专线」页头图右上角（`pages/line-query` 的 `.fav-btn` → `navigateTo`，**不是 switchTab**）
  - 我的 → 「查公司」页头图右上角（`pages/company-list` 的 `.me-btn`）
- **首页只做分流**（`pages/index`）：大标题「找专线 · 找物流公司」+ 搜索框 + 两个入口卡（橙"我要发货"→ 查专线 tab / 蓝"找物流公司"→ 查公司 tab）+ 页脚「免责声明 | 隐私政策」。
  - 首页搜索框语义 = **按公司名查线路**，统一进查公司 tab。因目标是 tabBar 页 → 用 `switchTab` + `app.globalData.pendingCompanyKeyword` 交接关键词（**tabBar 页不能带 URL 参数**），`company-list.onShow` 读取后**立即清空**防重复触发。
- **查专线**（`pages/line-query`）：地址双卡（出发蓝/目的橙）+ ⇄ + 筛选 chip（只看直达/天天发车/时效）+ 空态 + 返回首页。
  - 筛选参数透传：`direct=1` / `daily=1` / `maxDays=N`，**在 line-list 客户端过滤**（不加云函数负担）。
  - 「只看直达」时整段隐藏中转方案；**时效缺失不排除**（aging 填写率仅 42.5%，硬排会误杀大半线路）。
- **查公司**（`pages/company-list` + `pages/company-detail`）：公司搜索（简称可命中全称）+ 公司详情（发站/到站卡、公司简介、三统计、覆盖线路按出发城市分组、纠错入口）。
- **新增 `searchCompany` 云函数**（**必须上传，否则查公司整页不可用**）：`action:'search'` 出公司卡片列表；`action:'detail'` 出完整聚合。

### ★ 地区选择：`components/region-picker`（首个自定义组件）
- 半屏弹层 + 面包屑下钻 + **「不选区县 = 全市」**语义（参考图原文）。取代原 `picker mode="region"` 三列滚轮。
- **数据单一源机制（关键）**：`cloudfunctions/searchLine/regionData.js` 是**唯一数据源**（已补导出 `MUNICIPALITIES`/`PROVINCE_CITIES`/`CITY_COUNTIES`）→ 跑 `node .workbuddy/scripts/sync-region-data.js` 生成 `utils/region-data.js` 前端副本 → 脚本内置自检（南充样本必须解析出「高坪区」）。
  - **改地区数据必须：改云函数那份 → 重跑同步脚本。** 不要直接编辑 `utils/region-data.js`（文件头已标【自动生成 · 请勿手动编辑】）。
  - **展示名 vs 查询名分离**：区划表存规范短名（"顺庆"），展示补后缀（"顺庆区"）。`displayName()` 用**显式映射表 `DISPLAY_SUFFIX`**，**不能用正则推断**——「县」在「乌鲁木齐县」里是名称的一部分。
  - 同名多地（市中/城区/东区/西区/海南/朝阳/吉林）靠逐级下钻的父级上下文天然消歧。
  - 模型注意：**直辖市没有中间"市"层**，区县直接挂在直辖市下。

### 公司维度：**不建新表，实时聚合 lines**
- `companyName_1` 索引已存在，`companyName` 是导入必填字段。公司所有展示字段（认证/VIP/覆盖城市/规模）均由在营线路实时算出 → **不建 companies 集合，避免双份数据不一致**。
- 口径必须对齐：VIP 用 `isVip===1 && (无到期 || 到期>now)`；城市用 `normCity` 去后缀；线路 `ref` 用 `_id` 优先。`status===0` 必须排除。
- **中转语义在 `lineType`（"直达"/"中转"）里，没有独立 `transfer` 布尔字段**。判中转要同时认 `transfer` 与 `lineType`（`searchCompany.isTransfer`）。
- **网点三形态**（对象数组 / 整段字符串 `"地址 | 电话1,电话2"` / 字符串数组）必须在服务端都归一，口径对齐 `utils/outlets.js` 的 `parseOutlets`。
- **★ 网点分组的"单地址多电话 = 1 组"规则必须读端也遵守**（v6.3 修复，详见下「网点分组四规则」）。

### 其他新增
- **信息纠错 = 站内表单**（v6.4，`pages/report` + 云函数 `reportFeedback` → `feedback` 集合）：
  - 旧实现（弹框 → 引导打电话/加微信）**已被证明无效**——用户要跳出小程序切 App，摩擦太大、几乎无人反馈，
    且反馈内容只存在客服口头记录里，**无结构化留存**。**不要再改回"引导客服"那种模式。**
  - 入口 3 处：专线详情 / 公司详情（带参标明被反馈对象）+「我的」菜单「信息纠错」（不带参）。
  - **传参纪律**：`kind/key/name` 只用于提示条展示与写入定位，**不参与任何权限判断**；缺参不影响可用性。
  - **服务端必须再验一次**（前端校验只为体验）：类型白名单反查（不信任前端 label）、全部字段长度截断、
    同 openid 单日 10 条频控、无 openid 直接拒、异常不抛穿。
  - `month`/`day` 按东八区，与 `stat_events` 同口径。
- **免责声明**成为独立文档：`pages/agreement/index.js` 的 `AGREEMENTS.disclaimer`，`onLoad` 改为查表容错（原三元只认 privacy/service）。入口在首页页脚 + 「我的」菜单。
- **纠错入口**：专线详情 + 公司详情均有「信息有误？点这里报错」→ 跳 `pages/report` 站内表单（v6.4 起；旧的"引导打客服电话"模式已废弃）。
- **tabBar 图标**：`assets/tabbar/` 现 5 对（home/star/user/route/company）。route 与 company 由 `.workbuddy/scripts/gen-tabbar-icons.js` 生成（纯 Node 手写 PNG 编码，规格 81×81/8bit/RGBA）。**是示意级线稿，有设计稿直接替换 PNG 即可，不用动 app.json。**

## ★ 真实数据字段填写率（2026-09-21 实测 475 条线路 · 设计决策的依据）
> 来源：扫描 `E:\微信小程序公司信息\` 全部 JSON（90 文件 / 475 条）。**任何页面设计都应先看这张表**——不要按"字段清单"想当然排布局，要按**实际有值概率**排。

**100% 必填**：`companyName` `title` `fromCityName` `toCityName` `status`

| 高填写率（可放心作主内容） | 中（辅助/条件渲染） | 低（不可作主视觉，须兜底或隐藏） |
|---|---|---|
| fromAddress **79.2%** | lineType 61.7% | toPhone **43.2%** ⚠️ |
| toAddress **78.5%** | fromPhone 61.1% | priceDesc 42.7% |
| tags **77.7%** | certified / isVip 49.7% | aging 42.5% |
| toAreas **74.3%** | | latitude/longitude 30.7% · phone 25.5% |
| | | toLat/toLng 13.5% · fromCity/toCity 7.4% · fromOutlets/toOutlets 3.4% |

**由此得出的两条铁律**：
1. **首屏不要放填写率低于 ~70% 的字段**（如 aging/priceDesc），否则大量线路首屏是 `—`，页面显残缺。低填写率字段一律**条件渲染（有值才显示、全空整卡隐藏）**。
2. **`toPhone` 仅 43.2% 是最大业务隐患**：约四成线路详情页无法直接拨号，与货主"拿到电话直接联系"的核心诉求冲突。相关设计必须处理"无电话"态（如不渲染拨号按钮），并考虑在导入侧提示补齐。

## ★ 两套卡片语言（2026-09-22 v6.1 确立，最重要的视觉分层）
> 依据「齐鲁快运 公司详情」参考图，用户要求专线详情「必须按图片所示设计」，并确认**两个详情页都改**。

| | **浏览型页面** | **档案型页面** |
|---|---|---|
| 页面 | 首页 / 查专线 / 列表 / 查公司 / 收藏 / 我的 | **专线详情 / 公司详情** |
| 类前缀 | 各页自有 + `.card` / `.glass*` | **`pf-*`（profile，全局）** |
| 卡片底 | 半透明白 + 磨砂 → **v6.2 起实心白/近白** | **纯白 `#ffffff` + 细描边 `var(--border)`** |
| 圆角 / 投影 | 24-28rpx / 蓝色调多层柔和投影 | 20rpx / 极浅 `0 1rpx 3rpx` |
| 首屏 | **渐变头图** + 内容负 margin 上叠 | **白底描边头卡**打头，**无渐变块** |

- **为什么档案页当初不用磨砂**：详情页信息密度最高、阅读最久，半透明底会把背景渐变/光斑透到正文下，削弱可读性。档案页要"资料页"的确定感，不要天气页的氛围感。
  - **v6.2 全站移除毛玻璃后**，这条理由已升级为全局决策；两套语言的差异退化为**有无渐变头图 + 圆角/投影强度 + 有无细描边**。
- **`pf-*` 体系全在 `app.wxss`**（`pf-page`/`pf-card`/`pf-head-card`/`pf-station-from|-to`/`pf-st-index`/`pf-st-addr`/`pf-st-phone`/`pf-stats`/`pf-group-*`/`pf-route-row`/`pf-rr-*`/`pf-report-btn`/`pf-fallback`…）。
  - **必须放全局**：两个详情页各写一份必然漂移（本项目已有磨砂值漂移前车之鉴）。**页面 WXSS 不得覆盖 `pf-*` 的色值**，只允许加布局微调（如 `company-detail/index.wxss` 现在只剩 3 行）。
- **「已核实」徽章统一为绿底描边胶囊**（`--sky-green-ink` + `rgba(233,247,236,.9)` 底 + `rgba(63,122,58,.22)` 边）。列表公司卡原为蓝底，v6.1 已统一。
- **VIP 金色分场景**：渐变头上浅金 `#ffe9a8`；**白底上**深金（`pf-vip` 用 `#9a6700`/`#a16207`）。

### ★ 元信息「宁缺毋滥」原则（R-18，v6.1）
- **无可靠数据来源就不显示**，绝不显示占位符、不编造、不用近似值糊弄。
- 前端每项**独立 `wx:if`，无值时连前面 `·` 分隔符一起不渲染**（否则出现孤立分隔符）。
- **「更新时间」的唯一来源是 `_id` 的 ObjectId 时间戳**（前 4 字节 / 前 8 位十六进制 = 创建时间秒）：
  - 因为**线路文档没有任何时间字段**（实测 475 条 0 命中；`adminLine.FIELD_WHITELIST` 也不含 `createTime`/`updateTime`）。
  - 三道校验缺一不可：① `_id` 必须 24 位十六进制；② 时间戳落在 2015~2100；③ **相对时间超 90 天返回空串**（不显示"286天前"）。
- **「浏览量」能算但不划算**：`stat_events` 的 `view` 事件 `key` 存**线路 id**，按公司聚合需 `_.in(ids)`，但该集合**只有 `month_openid`/`day_openid`/`month_type` 三个索引，无 `type+key`**，大数组 `_.in` 会退化为扫描。
  - 处理：① 线路 id 上限 **30 个**（`VIEW_ID_LIMIT`），超出放弃返回 0；② **任何异常 try/catch 吞掉返回 0**，绝不影响主数据。
  - 若日后要真正做，**先加 `type+key` 复合索引**。

## 视觉规范（v6.2 · Notion 骨架 + macOS 天气色彩，**全站无毛玻璃**）
> ⚠️ 以下**仅适用于浏览型页面**。档案型页面（两个详情页）见上方 pf-* 体系。

### ★ v6.2：全站已移除毛玻璃（2026-09-22，用户要求「全部字体删除毛玻璃效果」，范围含管理端）
- **删除全部 `backdrop-filter`**：19 文件 / 86 处（执行脚本 `.workbuddy/scripts/remove-glass.js`，幂等、带 `--dry` 与残留自检）。
- **删的原因**：① 模糊在真机开销大，长列表掉帧；② 半透明底把背景渐变透到正文下，削弱可读性。
- **★ 连带必改**：只删模糊、保留 `.88` 半透明 → 卡片变"透着渐变的淡灰块"，**比原来更脏**。必须**同时把半透明白底提纯为实心白/近白**（v6.2 共提纯 148 处）。
- **★★ 踩坑（务必记住）**：提纯**只能作用于底色类属性**（`background*` / `border*` / `box-shadow`），**`color` 一律跳过**。首版脚本无差别替换，把**深色渐变头图上刻意用的白色文字/占位符**也提纯 → 与白底组合成"白字白底"直接消失（首页/查公司/查专线搜索框、管理端广告页统计与徽章，5 处已人工修正）。**任何"白色提纯"脚本都必须先按 CSS 属性名过滤。**
- **刻意保留的白**：渐变头图 `::before` 的白色径向柔光（"天空高光"）、深色渐变上的白色标题/副标题、按钮渐变上的白字。这些语境正确，不是毛玻璃。
- **令牌变化**：`--glass` / `--glass-strong` 由 `.88`/`.95` → **`#ffffff` 实心**；`--glass-soft` `.74` → `.96`；**`--glass-blur` / `--glass-saturate` 废弃**（仅留定义兼容）。`.glass*` 类名保留但不再产生模糊。
- **作废的旧约束**：① 「页面根节点必须 `background: transparent`」（该约束只为 `backdrop-filter` 服务）——**写法仍保留**，因为天空渐变画在 `page` 元素上，根节点透明才看得见；② 「`-webkit-backdrop-filter` 与标准属性成对写」。
- **两套卡片语言的差异退化**：毛玻璃曾是主要区分手段，移除后差异 = **有无渐变头图** + **圆角/投影强度** + **有无细描边**；卡片底**都变实心白**。档案页靠「白卡打头、无渐变、细描边、弱投影」仍保持"资料页"气质。

- **设计令牌唯一来源 `app.wxss` 的 `page{}`**。页面一律 `var(--xxx)`，**禁止写死色值**。
- 核心令牌：`--brand` #2383e2 / `--ink-title` #191918 / `--ink-body` #37352f / `--ink-muted` #73726e / `--border` rgba(60,60,60,.08)。
- **卡片底色**：`--glass` `#ffffff` / `--glass-strong` `#ffffff` / `--glass-soft` rgba(255,255,255,.96) / `--glass-border` `#ffffff`。工具类 `.glass` / `.glass-strong` / `.glass-soft`（**v6.2 起无模糊**）。
- **调参旋钮**：卡片"发灰/发脏" → 检查是否被写成半透明白（应为实心白或 `≥.96`）；**渐变太淡 → 加深页面底色与头图 `linear-gradient`**。用户曾明确否掉 `.72`（太糊）与 `blur(20rpx)`（太糊）。
- **天气色板**：`--sky-blue/teal/amber/violet/rose/green`（浅渐变）+ 对应深色文字 `--sky-*-ink`。工具类 `.sky-*`。
- **页面背景是渐变不是纯色**：`page` 元素挂三层 radial-gradient 天空光斑（`.5~.62` 不透明度），底色 `#e8f0fa`，`background-attachment: fixed`。
- **渐变头图（4 段）**：蓝调 `#3d7fd4 → #5b9ce4 → #8dbcee → #a8cdf2`（首页/查专线/列表/我的/管理端）；紫调 `#6357cf → #7d72dd → #9a91e8 → #b4adf0`（收藏）。**两个详情页已不用渐变头图**。
- **视觉语言**：① 卡片 = 实心白 + 柔和投影 + 大圆角 **20-28rpx**；② 每页一个**渐变头图**（白字 + `::before` 径向柔光）；③ 内容用负 margin **上叠**到渐变上；④ 按钮 = 主色渐变 + 圆角 16-22rpx + 蓝色柔光投影。
- **JS/app.json 不支持 CSS 变量**，改背景/主色须同步 `app.json`：`window.navigationBarBackgroundColor`（现 #4f92dd）/ `navigationBarTextStyle`（white）/ `backgroundColor`（#e8f0fa）/ tabBar `selectedColor`（#2383e2）、`color`（#8a93a3）、`backgroundColor`（#ffffff）。
- **VIP 金色分场景**：渐变头上用浅金 `#ffe9a8` + 柔和光晕；白底上用深金 `#a16207`；徽章 = 浅金渐变胶囊 + 柔和投影。**禁止流光/发光/呼吸/扫光动画**（与整体气质冲突，曾做过闪电电流版被否定）。

## 文档基准（重要）
- **`PRD.md`（根目录，v6.2）是后续开发的唯一依据**，按代码实现反向整理，含需求编号 `F-{模块}-{序号}` / `R-{序号}`、数据模型、以及第 6 章「数据一致性护栏 R-10~R-18」。
- `README.md` 是 v3.1 介绍性文档，已明显滞后（未覆盖 VIP 到期模型、月度统计、埋点频控、按公司批量 VIP、双键制/自愈迁移）。**两者冲突时以 PRD 为准。**（兑奖功能已于 v4.1 整体移除）
- 动工前先在 PRD 定位需求编号；新增能力需先补 PRD 条目再写代码。
- 上线合规项归集在 PRD §8.4「上线状态与待办」。

## 数据形态约定（重要）
- 网点数据入库路径有三条，形态不统一：① 新版 adminLine save/batchSave → `[{addr,phone}]` 数组；② 旧版云函数批量导入/控制台直灌 → 字符串 `"地址 | 电话1,电话2"` + 老字段全空；③ 手工编辑 → 老字段有值。
- 读端统一用 `utils/outlets.js` 的 `parseOutlets/deriveLegacy` 归一（详情页、编辑页已接入），口径与 adminLine 服务端 `deriveOutlets` 一致。新增消费网点/地址/电话的页面时必须先过 deriveLegacy。
- 服务端 adminLine `deriveOutlets` 有两道护栏：三者都未提交不动网点字段（防 update 清空）；单地址多电话保持 1 网点挂多号。
- 城市索引字段 fromCity/toCity 由服务端 normCity 派生（去"市/区/县/省"后缀）；searchLine 查询侧同口径归一，两侧必须一致。

## ★ 网点分组四规则（v6.3 修复，读端与写入端曾脱节）
> 用户报障「电话不需要排序…有多个发站地址」，根因是**读端按行逐条成组**：形态②直灌数据「1 个地址行 + N 个纯电话行」被渲染成 N+1 个"网点"，N 个显示「地址未填写」，且电话被 `.sort()` 打乱。
> **写入端早有 R-13 护栏（单地址多电话=1 组），读端从未遵守** → 现两端口径必须一致。

| 输入 | 分组结果 |
|---|---|
| 1 地址行 + N 纯电话行 | **1 组**：该地址挂 N 个号码 |
| M 个地址行（各带电话） | **M 组**：地址与电话严格一一对应 |
| M 个地址 + 尾随纯电话 | **M 组**：尾随号码并入**第一个**地址组 |
| 只有电话、没有地址 | **1 组**：`addr` 为空（前端**不再渲染**「地址未填写」） |

- **实现位置（两处口径必须一致）**：前端 `pages/line-detail/index.js` 的 `buildOutlets`；服务端 `cloudfunctions/searchCompany` 的 `collectStations`。
- **禁止排序**：`splitPhones`/`splitAddrs` 不得有 `.sort()` —— 号码/地址是**按业务重要性录入**的（第 1 个常是主号/主发货点），排序会打乱。
- **合并时必须去重**：`splitPhones` 只做**行内**去重；跨行合并用 `concat` 会重复（同一号码既在地址行内、又单占一行）。合并前先 `new Set(head.phones)` 判重。
- **计数口径**：统计卡「发站地址/到站地址」与公司详情「共 N 个」只数 **`addr` 非空的组**（`fromAddrCount`/`toAddrCount`），不能数 `pairs.length`，否则 1 地址 3 电话显示成 3。
- **`pf-st-phones` 在 `app.wxss`（全局）**：一个地址挂多号时逐号渲染胶囊、点击直拨（`onCallOne`），两页共用，各写一份必然漂移。`.pf-st-addr-empty` 已删除。
- **回归测试**：`.workbuddy/scripts/test-outlet-pairing.js`（9 组 30 断言，独立复刻页面逻辑，因页面文件顶层有 wx API 不能 require）。**改 `buildOutlets` 必须同步改该测试里的副本**。`test-searchcompany.js` 59 断言含同口径回归。

## 地名匹配护栏（searchLine）
- 匹配规则集中在 `cloudfunctions/searchLine/placeMatch.js`，共 5 条（归一化 / 别名表 / 辐射区前缀锚定 / 全境归属 / 乡镇级容错）。
- 城市字段比对必须用 `sameCity()`（含镇/乡/街道后缀容错，羊流镇=羊流），不要退回 `norm()` 严格相等。
- **禁止**给 `norm()` 增加"镇/乡"后缀剥离：会把「景德镇市」削成「景德」，regionData 的 PREFECTURE_KEYS / isParentCity 立刻断链。regionData 归属判定一律走 norm。
- 单字地名只做精确相等，不做包含（防「陵」误命中「乐陵」）。
- 回归测试：`node .workbuddy/scripts/test-searchline.js`（云函数端到端 mock DB）、`test-place-match.js`（匹配规则单测）。改匹配逻辑后必须两个都跑。

## 线路主键约定（重要）
- lines 文档有两个键：`_id`（数据库主键，必有）与 `id`（业务字段，毫秒时间戳）。旧版批量导入/控制台直灌**没有 id 字段**。
- 凡「按线路定位」一律走 `utils/lineKey.js`：`parseLineKey()` 解析路由参数（纯数字→按 id，否则→按 _id）、`lineWhere()` 出查询条件、`lineRef()` 取跳转/分享键（_id 优先）。**不要再写 `where({ id: xxx })`**。
- 收藏以业务 id 为准（`line.id || line._id`），历史收藏数据存的也是 id；改口径会让老收藏消失。
- `searchLine.normalizeLine` 会给返回项补 `id = _id`；`adminLine` 列第一页时跑 `healMissingIds()` 自愈补 id（手动：`action:'healIds'`）。
- 列表 `wx:key` 用 `_id`（id 可能缺失导致 key 冲突）。

## 城市字段写入护栏
- `adminLine.pickFields` 只在**本次提交带了城市名**时才派生 `fromCity/toCity`；否则局部更新会把搜索索引清成 ''，线路从搜索中消失。
- 管理端编辑页城市字段是「手输 input + region picker」双通道（乡镇级目的地如"羊流镇"不在级联数据里，必须能手输）。

## 编辑护栏：Windows 写文件禁止带 BOM（重要，已踩坑）
- **踩坑记录（2026-09-21）**：用 PowerShell `Out-File` 批量改写 12 个 `.wxss`，Windows PowerShell 5.1 默认 **UTF-8 with BOM**，文件头被写入 `EF BB BF` → 小程序编译报 `unexpected '�' at pos 1`。
- **规则：改本项目的 `.wxss` / `.wxml` / `.js` / `.json`，一律用 Write/Edit 工具。**
- 若必须走 PowerShell，用 `[System.IO.File]::WriteAllText($p,$t,(New-Object System.Text.UTF8Encoding($false)))` 或 `WriteAllBytes`。**绝不要用 `Out-File` / `Set-Content` / `>` 重定向**（默认带 BOM）。
- 批量改动后、提交审核前必跑 BOM 自检：逐文件读前 3 字节，命中 `EF BB BF` 即为 BOM。
- 已知备份：`.workbuddy/backup-bom-20260921/`（修复前的带 BOM 副本，勿当作正常代码引用；也不需要删，只是留存）。

## 运维事项
- **git 仓库已建基线**（2026-09-21）：分支 `main`，首次提交 `4edc3dc`（156 文件）。`.workbuddy/memory` 与 `.workbuddy/scripts` **入库**（团队资产），`.workbuddy/reports/` 排除（生成物）。
- **远程推送受阻**：本机沙箱代理（127.0.0.1:59788）拒绝 CONNECT 到 github.com:443（502）；系统另有 127.0.0.1:7897 代理（Clash 类）但沙箱未走。需用户在沙箱外推送。仓库无任何密钥/凭证，可安全推公开或私有远程。
- 云函数改动后需在开发者工具重新上传；adminLine 最近一次修复（2026-09-16）后用户需重传。**⚠️ 待重传 3 个：`searchCompany`（v6.3 改了 `collectStations` 分组逻辑，不上传则公司详情网点分组修复不生效）；`searchLine`（`regionData.js` 增导出）；`reportFeedback`（v6.4 新增，不上传则纠错表单提交报"未部署"）。**
- 导入文件放 `E:\微信小程序公司信息\`；项目自带的 JSON 处理脚本在 `.workbuddy/scripts/`（fix-shandong-json.js 可作为其他公司数据修复的模板）。
- 一键回归：`node .workbuddy/scripts/run-tests.js`；静态体检：`node .workbuddy/scripts/scan-project-health.js`（绑定/dataset/路由/wx:key）。
  - **改详情页 WXML 后必跑体检** —— v6.1 实证有效：删网点拨号按钮后 `onCallGroup` 成了读 `dataset.index` 的孤儿绑定，体检立刻报 P0。
  - **体检只报"WXML 绑定 → JS"方向的孤儿，不报"JS 函数 → WXML"**（v6.3 实证：`onCall` 改 `onCallOne` 后成了反向孤儿，需人工检查）。
  - **写 JS 语法自检脚本时注意 shebang** —— 用 `new Function()` 检查会把文件头 `#!/usr/bin/env node` 判为语法错（Node 认、Function 构造体不认）。用 `vm.Script` 或先剥掉 shebang。
  - 现状（v6.4）：编码 169 源文件 0 BOM；回归 12 个测试（含编码自检 + 11 个测试）全 PASS；体检 **18 页面** / 绑定 126 / data-* 47 / 跳转 42 / wx:for 29 无问题；JS 65 文件 0 语法错误。

## 主体与合规（重要）
- **小程序注册主体：「个人」**（2026-09-21 用户确认）。
- 推论：**不能选需要资质的服务类目**（如「交通服务→物流服务」需企业资质）。必须走「工具」大类下的信息查询类目，个人主体可申请。
- **【已删除】「月度兑奖」活动**（2026-09-21，提交 `02d43d0`）：用户端 `pages/prize`、管理端 `pages/admin/prize`、云函数 `cloudfunctions/prize` 及全部入口/索引/协议表述已清除。**小程序现为 18 个页面（11 用户页 + 7 管理页）+ 1 个组件**（v6.4 起）。保留 `stat_events` 统计（仅供平台自用评估，不再发奖）。
- 客服联系方式为真实有效：`utils/contact.js` → 电话 `15165018553`、微信 `A15165018553`（用户本人）。
- **运营主体姓名：陈镇**（2026-09-21 用户确认）。个人主体，协议中的"平台运营方"应替换为"陈镇"并注明联系方式。
- 协议页（`pages/agreement/index.js`）需补主体信息（姓名陈镇 + 联系方式），隐私政策按法定要求不得只写"运营方"代称。

## 用户偏好
- 简洁中文输出；文件级变更摘要 + 按优先级行动清单；UI 问题用截图沟通。
- 批次推进（P0/P1/P2），完成一项自动衔接下一项。
- 上线前检查类任务：一次只问一个问题，用普通人语言复述需求（用户明确要求）。
