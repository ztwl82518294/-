# 物流专线查询 · 项目长期备忘

> **唯一有效的项目规范。** 日常日志 `YYYY-MM-DD.md` 只是流水，冲突时以本文为准。
> 历史原文归档在 `archive/*.full.md`（旧 v4~v6.4 架构，代码已删，**仅供追溯，不要照它开发**）。

## 目录
1. [架构](#一架构) 2. [后台](#二管理后台-admin) 3. [覆盖写护栏](#三-覆盖写事故护栏最严重的坑)
4. [测试体系](#四测试体系) 5. [编辑与环境](#五编辑护栏--环境限制)
5b. [组件与页面硬约定](#五之二组件与页面的硬约定) 6. [跨端口径](#六跨端口径必须一致)
7. [搜索护栏](#七搜索匹配护栏) 8. [部署上线](#八部署与上线) 9. [用户偏好](#九用户偏好) 10. [待办](#十待办)

---

## 一、架构

> ⚠️ 2026-09-21 按用户要求**从零重写**（「之前的全部删除，一点不留」）。旧 v6.x 已整体删除。

**数据模型 8 表**：`companies` / `routes` / `route_companies` / `cities` / `corrections` / `admins`
/ `announcements` / `featured_routes`
- 集合名与字段定义**唯一来源** `shared/schema.js`（小程序 / 云函数 / 后台 / 导出脚本都引它）
- ★ 核心取舍：**`transitDays` / `isDirect` / `frequency` 挂 `route_companies`**，不挂 `routes`
  （同一家公司跑济南→广州 2 天、跑济南→乌鲁木齐 5 天，塞 `companies` 或 `routes` 都是错的）
- 数据源：`data/seed-data.js`（40 公司 / 55 线路 / 72 关联）+ `data/cities.js`（344 城）
  + `data/districts.js`（**2980 区县，344 城 0 缺失**）+ `data/announcements.js`（公告/推广默认内容）

| 端 | 内容 |
|---|---|
| 小程序 8 页 | index / search-by-address / search-by-company / route-detail / company-detail / correction / privacy / disclaimer |
| 组件 | city-picker / privacy-modal |
| utils | common / search / db / params / privacy / correction（**无 contact.js**） |
| 云函数 | `submitCorrection` / `trackCompanyView` |
| 后台 | `admin/` —— 唯一 Web 端 / 唯一写入口 / 唯一需登录 |

### 首页（2026-09-22 改版）
三个旧入口已删：热门专线 / 最近更新线路 / 我知道公司名看他跑那些线路。
现为：`.sky` 天气式头部 + **公告栏**（swiper 滚动）+ **优质线路推广**（横向卡片流）+ 两个查询入口。
- 公告 / 推广位由**后台 admin 维护**，云库取不到时退回 `data/announcements.js`（首页不开天窗）
- **公告 `link` 只允许本小程序页面路径或空串** —— 跳外域要配业务域名，个人主体受限，写了就是死按钮
- **推广位不复制线路数据**，只存 `routeKey` + 包装文案，公司数按 routeKey 现场回 `routes` 查
  （防「推广位写 8 家、点进去只剩 3 家」）

### ★ 区县只影响展示，不影响查询
`data/districts.js` 全量字典早已存在（此前没代码引用）。专线按城市收录（`routeKey='济南-广州'`），
不存在「济南-朝阳区」这种线路 ⇒ **选区县后仍按所属城市查询**，`routes` 一条不改、
routeKey 口径完全不变。区县有重名（市中区 / 鼓楼区）⇒ 反查是「区县 → 城市数组」，由 `cityHint` 消歧。

### 视觉五条铁律
1. 无渐变（**唯一例外**：首页 `.sky`，见下）
2. 无光斑（全局无 `radial-gradient`）
3. 无半透明染色（`--tint-*` 全实色）
4. 无高光内阴影（无 `inset 0 0 0 1rpx`）
5. **字体无毛玻璃**（禁 `backdrop-filter`、禁 `filter:blur()`、禁半透明文字色）—— 用户明说要

主色 `#0B6E99`，页底 `#F7F6F3`，卡片纯白，文字 `#37352F`/`#6B6B6B`/`#9B9A97`，边框 `rgba(55,53,47,0.09)`。
**渐变白名单制**：`check-project.js` 的 `GRADIENT_ALLOW` 精确到「文件 + 选择器」，
当前唯一放行 `pages/index/index.wxss` 的 `.sky`。放行新渐变 = 改这个白名单，不要全局放开。
**JS/app.json 不支持 CSS 变量**：改主色须同步 `app.json` 的 navigationBar / tabBar 配色。

---

## 二、管理后台（admin/）

```
server.js HTTP层  lib/store.js 纯内存业务  lib/db.js 只读写JSON
lib/repository.js 写穿透  lib/auth.js 登录  lib/importer.js xlsx/csv
lib/api.js JSON接口  lib/views.js 服务端渲染HTML
```
- **零依赖**（只 Node 内置 http/fs/crypto/zlib，无 package.json、无 node_modules）—— 刻意如此，为了「换台电脑就能跑」
- **只绑 127.0.0.1:8787**；默认 `admin / admin12345`

### 进入后台（运营视角）
**双击项目根目录 `start-admin.bat`** —— 自动起服务 → TCP 探活 → 开浏览器。
关掉那个黑窗口 = 关掉后台。等价命令 `node scripts/start-admin.js`（`--no-open` 只起服务）。
完整说明见 `docs/管理后台使用说明.md`。启动入口已在 `check-project.js` 的「工程脚本」清单里，
删了会报警。

> ★★ **`bootstrap()` 的 P0 事故（2026-09-22 修复）**：曾用 `store.FILE_COMPANIES`
> （**集合名** `companies`）去 `fs.existsSync`，而真实文件是 `companies.json`
> （`db.fileOf()` 加后缀）⇒ 永远判定「缺失」⇒ **每次启动都用 seed 覆盖四张表，
> 运营改的数据重启即丢**。现在一律走 `db.fileOf()`，且**只补缺失的表**，
> 不再「缺一个就全部重建」。护栏在 `smoke-admin.js`：起来后逐字节比对磁盘与备份。
> 教训：**判断文件存在性永远用负责命名的那个模块的 API，别自己拼文件名。**
- xlsx 是 zip：用**中央目录**定位 + `zlib.inflateRawSync`（不用本地头，data descriptor 长度可能为 0）
- multipart 二进制保真：`readBody` 同时给 `raw`(utf8) 与 `rawBinary`(latin1)，文件走 latin1
- **`admin/data/` 是工作副本，不入版本库**；改乱了用 `node scripts/export-seed.js --admin-only` 重建（`admins.json` 不动）
- 导入模板 `/api/import/template` 是**公开资源**，路由**必须在鉴权之前**，别挪回去
- 导入**先预览后确认**，预览阶段绝不写数据；错误行带 Excel 行号
- 只做「登录 + 增删改 + 批量导入 + 质量看板 + 运营位（公告/推广）」，**不做注册入口**
- 运营位校验要点：公告**正文不能空**、level 在枚举内、**link 必须以 `/` 开头**、时间窗不倒挂；
  推广位 **routeKey 必须真实存在**、**同一线路只能一个推广位**、角标必填 ≤8 字
- `parseTimeInput()`：把 `2026-10-01` 转时间戳（直接 `Number()` 得 NaN 会静默变 0）
- store 的 `T` **键名必须等于集合名**，否则 flush 取不到行

---

## 三、★★ 覆盖写事故护栏（最严重的坑）

- `repository.flush()` 是**全量覆盖写**。若内存未装载（未调 `loadAll()`）就写，
  内存是空表 ⇒ **整个数据文件被抹成 `[]`，且不报错**。2026-09-21 真发生过，`admin/data` 四表全清。
- **护栏**：`loaded` 标志，未装载调 `flush()` 直接抛错；`server.js` 的 `loadAll()` 不吞错。
- **任何新脚本只要碰写操作，必须先 `repo.loadAll()`。**
- 固化在 `admin.test.js` 的「覆盖写事故护栏」+ `smoke-admin.js`，**不要简化掉**。

---

## 四、测试体系（改代码后按顺序跑）

| 层 | 命令 | 规模 |
|---|---|---|
| 单元 | `node test/run-all.js` | **7 套件 373 断言** |
| 体检 | `node scripts/check-project.js` | **12 类**静态检查 |
| 模块基础能力 | `node .workbuddy/scripts/check-module-basics.js` | **8 个页面**（改页面必跑） |
| 部署前 | `node scripts/check-deploy.js` | **19 项** |
| 验收 | `node scripts/check-acceptance.js` | **61 断言** + 12 项人工 |
| 冒烟 | `node scripts/smoke-admin.js` | 后台 HTTP **105 断言**（临时端口 8791） |
| BOM | `node .workbuddy/scripts/check-bom.js` | **141 文件，提审前必跑** |

> **自检报错先分清「代码错」还是「检查逻辑错」**（同「修测试而不是修功能」）。
> 已多次遇到「检查器关键词落后于实现」—— 一律改检查器并注释说明，
> **绝不为过检查而给页面加无用代码**（如给首页加整页 loading）。

- `run-all.js` 用**子进程逐个跑**（套件内会 `process.exit()`，`submitCorrection` 会替换 `Module._load`，同进程会污染）。别改同进程串跑。
- `admin.test.js` 测逻辑（秒级）；`smoke-admin.js` 测 HTTP 层（Cookie、状态码、目录穿越）——「逻辑对」≠「线上能用」。
- 冒烟把 `admin/data` 当临时工作区（备份→跑→还原），**开跑前先体检数据目录**，坏数据直接拒跑。
  **新增集合必须同步进 `FILES`**，否则冒烟改动会真留在磁盘。
- 测试自身坑：`/logout` 下发**清空型 Cookie**，别无脑 `split(';')[0]` 覆盖 token，否则后续全静默 401。
- **集合清单要同源**：`check-acceptance.js` 的 A2 用 `Object.values(COLLECTIONS)` 取，别手抄（防漂移）。

### 写静态扫描工具的铁律（check-requires.js 踩坑）
正则扫源码：① **必须剥注释**（否则注释里的示例变假警报，假失败比不检查更糟）；
② **必须保留字符串**（`require('./x')` 的路径就在字符串里，抹掉会变成 0 处、检查形同虚设）；
③ **剥注释用等长空白替换**，保行号才能定位；④ 状态机逐字符扫描，字符串内不判注释。
⑤ 匹配 CSS 属性用**后行否定** `(?<![-\w])color`（否则 `background-color` 被误判）。

`.workbuddy/scripts/` **只放跨项目通用工具**（现 6 个：check-bom / check-requires / scan-toast-length /
apply-design-tokens / audit-company-phones / fix-import-json）。失效脚本已归档到
`.workbuddy/memory/archive/dead-scripts/`（**别当代码引用**）。新脚本写 `scripts/`。

---

## 五、编辑护栏 & 环境限制

### Windows 写文件禁止带 BOM
- 微信 WXSS/WXML 编译器**不跳过 BOM**，会报 `unexpected '\uFEFF' at pos 1`。
- **改 `.wxss`/`.wxml`/`.js`/`.json` 一律用 Write/Edit 工具**；
  禁用 PowerShell `Out-File`/`Set-Content`/`>`（5.1 默认带 BOM）。
- 必须走 PS 时用 `[System.IO.File]::WriteAllText($p,$t,(New-Object System.Text.UTF8Encoding($false)))`。

### ★★ 小程序端禁用「需要 @swc/runtime 的语法」（白屏事故）

`project.config.json` 开了 **增强编译 `enhance:true`** ⇒ 用 **SWC** 编译；下列语法会生成
`require('@swc/runtime/_xxx.js')`，而项目**零依赖** ⇒ **页面加载即抛错、整页白屏**。

```
module '@swc/runtime/_array_with_holes.js' is not defined  ← 根因
Component is not found in path "wx://not-found".            ← 结果不是原因
```
栈里的**行号是编译产物行号**，别按源码行号找 —— 直接跑静态体检更快。

| 不要写 | 改写成 |
|---|---|
| `const [a,b] = x`（数组解构） | `x[0]` / `x[1]` |
| `{ ...x }`（对象展开） | `Object.assign({}, x)` |
| `[...a, ...b]` / `f(...args)` | `concat` / `apply` / 循环 `push` |
| `for (const x of arr)` | 下标 `for` |

**`admin/` 与 `test/` 跑在 Node，不受此限。** 护栏：check-project.js 第 11 类检查（已反向验证）。

### 本机 Bash 环境残缺
- PATH 损坏：`dirname`/`ls`/`grep`/`tail`/`head`/`cat`/`rm`/`wc` 均 `command not found`。
  改用 Read/Write/Edit/Glob/Grep，或 Node 绝对路径
  `C:/Users/怀瑾/.workbuddy/binaries/node/versions/22.22.2-3/node.exe`
- 脚本参数用 Windows 风格路径（`G:/...`）；`/g/...` 会被解析成 `g:\g\...`
- **Node `execSync` 在 Windows 走 `cmd.exe`**：`cmd 2>/dev/null || true` 会整脚本崩掉。探测一律 `try/catch`
- PATH 坏 ⇒ 没法 `export https_proxy`；给单条命令设代理用工具自身配置（如 `git config http.proxy`）
- `rm` 不可用 ⇒ 用 Node `fs.unlinkSync()`

### 网络 / git
- **先试直连 `git push origin main`**（实测直连即通）；不通再跑
  `.workbuddy/scripts/push-backup.js`（自动写 `http.proxy=127.0.0.1:7897` + 敏感数据自检）
- **本机 git 怪毛病**：远程跟踪引用存不住，`update-ref` 返回 0 却不写 ⇒ `git status` 显示
  `[origin/main: gone]`。**判断有没有推上去只看 `git ls-remote origin`**（问服务端）
- 推送被 `! [rejected] (fetch first)`：合并加 `--allow-unrelated-histories`，README 取 ours

### 工作方式
- **坚持「修测试而不是修功能」**：断言失败先查清是代码错还是断言错，并在注释里写明原因防复发
- 长任务收尾必跑全套测试，不信「应该没问题」

---

## 五之二、组件与页面的硬约定

### ★★ 遮罩 / 弹层三条铁律（同一天连踩两次）
1. **样式自备**：组件是 `styleIsolation:"isolated"` ⇒ `app.wxss` 全局 `.mask` 进不来。
   漏写 `.mask` ⇒ 遮罩零尺寸看不见，但 `position:fixed` 的父容器**仍是整屏块，照吃点击**
   ⇒ 表现为「页面所有按钮点了没反应」。
2. **z-index 写死**：遮罩与面板都写 `position:absolute` 却不写 `z-index` 时靠 DOM 顺序决胜；
   面板若再用 `transform` 做垂直居中，**transform 会创建独立层叠上下文**，
   命中区域可能和肉眼所见不一致 ⇒ 「弹窗看着好好的，按钮就是点不动」。
   ⇒ **遮罩 `z-index:0`、面板 `z-index:1`，写死**。居中改用**父级 flex**，别用 `top:50%+translateY(-50%)`。
3. **不用 `inset: 0` 简写**：低版本内核不认，整块塌成 0 尺寸。四边写开 `top/right/bottom/left`。

**护栏**：check-project.js 第 12 类「弹层层叠检查」（禁 inset / 定位必写 z-index /
isolated 组件须自备 `.mask`），三个分支均已反向验证。

**关闭路径必须全覆盖**：同意 / 拒绝 / 点遮罩 / 右上 ×，每条都要 `setData({visible:false})`。
遮罩建议直接绑「不同意」，保证任何情况下关得掉、不把用户卡死。
**副作用顺序**：`setData` 先跑，落存储等副作用后跑 —— 副作用挂了也不会关不掉窗。

### 「按钮点了没反应」排查顺序
1. **透明遮罩层残留**（`position:fixed; inset:0`）—— 已两次命中，最易忽略
2. 层叠：遮罩/面板没写死 z-index、或面板用 transform 居中
3. `bindtap` 拼写 / 方法名在 JS 里没实现
4. 跳转目标未在 `app.json` 注册，或 `switchTab` 去了非 tab 页
5. 元素被覆盖（z-index / 尺寸为 0 / 被 `overflow:hidden` 挤出可视区）
6. 事件被 `catchtap` 截断

### 页面必须「符合自身场景的基础功能」
`.workbuddy/scripts/check-module-basics.js` 量化检查（**改页面后必跑**）：

| 场景 | 必需能力 |
|---|---|
| 列表 / 检索页 | 下拉刷新、触底加载、加载态、空态、**失败态（可重试）** |
| 表单页 | 提交防重、必填校验、成功反馈 |
| 静态文本页 | 无额外要求 |

- ★★ **空态 ≠ 失败态**：空态重试无用（引导换条件/反馈）；失败态**必须给「重新加载」按钮**。
  混为一谈会让用户把故障当成"没数据"。
- 多区块页面（首页）要**独立降级**：一块失败只显示那一块重试，不整页白屏。
  首页用区块级 `featLoading` / `featError`，空态可只写在模板里。
- 统一用 `app.wxss` 的 `.empty-btn`；旧 `.empty-action` 只在两个页面有局部定义，**别复用**。
- **客户端筛选 + 分页的坑**：查专线页触底要**循环补页**直到攒够可展示条数，
  否则「这一页全被筛掉」会误判为没有直达公司。

---

## 六、跨端口径（必须一致，别各写一套）

| 能力 | 唯一来源 |
|---|---|
| 集合名与字段定义 | `shared/schema.js` |
| `routeKey` 派生 | `utils/common.js` 的 `buildRouteKey`（两侧都过 `normCity`） |
| 城市归一 `normCity` | `utils/common.js`（去「市/区/县/省」后缀） |
| 区县字典与反查 | `data/districts.js` + `utils/search.js` 的 `resolvePlace` / `searchPlaces` |
| 公司搜索打分 | `utils/search.js` 的 `searchCompanies` |
| 电话校验 | `utils/common.js` 的 `isPhoneLike` |
| 客服联系方式 | `utils/privacy.js` 的 `CONTACT` |

- 后台 `normalizeRoute` **一律重新派生 routeKey**，不采信传入值；`_id = 'route_' + routeKey.replace(/-/g,'_')`
- 改线路城市必须**同步所有关联 routeId/routeKey**，否则悬空外键、页面死链
- `companyCount` 是冗余计数，增删关联后**重算**（`recountRoutes()`），不要 `+=1/-=1`
- 删公司 / 删线路必须**级联删关联**，删完重算

---

## 七、搜索匹配护栏
- **单字关键词只做「前缀」，一律不做「包含」**（否则「南」命中几百家）
- 打分：全称相等 100 / 简称相等 95 / 全称前缀 90 / 简称前缀 85 / 全称包含 80 /
  简称包含 75 / 拼音前缀 70 / 拼音包含 65 / 首字母 60
- `detectKeywordType` 命中城市即优先返回 `'both'`
- 混合搜（城市 + 区县）：城市结果排前，区县命中时 `resolvePlace` 返回的 `city` **必是已知城市**

---

## 八、部署与上线

### ⚠️ 两个工作区，别改错目录
| 目录 | 状态 |
|---|---|
| **`G:\workbuddy\logistics-line-query`** | **活跃项目**（已上线，有 GitHub remote，云环境 `cloud1-d0ge42roj61603242`，主体陈镇） |
| `G:\workbuddy\wuliuzhaunxianchaxun` | **废弃的早期尝试**（云环境从未配置，无 remote） |

两边 `pages/` **同名但代码不同**。改代码/查文档前先确认在哪个目录。

### PRD 当前状态
v4.3（含 `F-xx`/`R-xx` 编号、护栏 R-10~R-15）**已丢失**，从未进本仓库。
现 `PRD.md` 是从废弃目录找回的 **v1.0 基线副本**，文件头标注「与代码冲突时以代码为准」，
末尾有「变更补记」（C-01 模块基础能力 / C-02 公司线路合并 / C-03 列表分页）。
⇒ **定位需求编号时 PRD 可能没有，以代码为准并回头补 PRD**。

### 上线纪律
- 主体**个人**（陈镇），类目「工具 → 信息查询」。**个人主体不能选需企业资质的类目**
- 客服 `15165018553` / `A15165018553`
- **上线后任何代码改动都需重新提审**；不得在生产配置上「顺手优化」（`libVersion` 保持 `trial`）
- 云函数改动后**必须重新上传部署**（阻断项）
- 部署清单见 `docs/验收自检报告.md`：建 **8 集合** → 导入 `.data/*.jsonl` →
  `corrections` 加索引 `openid+day`、`openid+targetId+day` → 上传云函数 → 12 项人工 → 提审

---

## 九、用户偏好
- 简洁中文；文件级变更摘要 + 按优先级行动清单；**UI 问题用截图沟通**
- 批次推进（P0/P1/P2），完成一项自动衔接下一项
- 上线前检查类任务：**一次只问一个问题**，用普通人语言复述需求

---

## 十、待办

1. ✅ **远程备份** —— `https://github.com/ztwl82518294/-`（最新 `5ef7d1c`）
   ⚠️ **仍需用户确认该仓库是 Private**（含客服电话与公司信息）
2. ⬜ **云函数上传部署**（阻断项）—— 本地 `check-deploy.js` 19/19 全绿，只剩手动上传：
   右键 `submitCorrection` / `trackCompanyView` → **上传并部署：云端安装依赖**
   （本地无 node_modules，不能选「所有文件」）
3. ⬜ 云控制台建 **8** 集合 + 导入 `.data/*.jsonl`：
   companies 40 / routes 55 / route_companies 72 / cities 344 /
   **announcements 4** / **featured_routes 6**
4. ⬜ `corrections` 加索引 `openid+day`、`openid+targetId+day`
5. ⬜ **12 项人工验证**（清单在 `docs/验收自检报告.md`）
6. ⬜ `admin/data/` 与云数据库衔接：缺「从云数据库导出纠错」脚本
7. ⬜ **PRD v4.3 已丢失** —— 若手上有请放回，否则需求编号无从定位
8. ⬜ 确认 `G:\workbuddy\wuliuzhaunxianchaxun` 可否整个删除（废弃目录，留着易改错）
9. ⬜ （可选）关掉 `enhance` 改 Babel，从根上避免 SWC 问题 —— 属生产配置改动，需用户确认
