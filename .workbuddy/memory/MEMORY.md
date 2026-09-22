# 物流专线查询 · 项目长期备忘

> **本文是唯一有效的项目规范。** 日常日志（`YYYY-MM-DD.md`）只是流水，若与本文冲突以本文为准。
> 历史原文归档在 `archive/*.full.md`（旧 v4~v6.4 架构，**代码已全部删除，仅供追溯，不要照它开发**）。

## 目录
1. [当前架构](#一当前架构新-prd-版)
2. [管理后台](#二管理后台-admin)
3. [覆盖写护栏](#三-覆盖写事故护栏最严重的坑)
4. [测试体系](#四测试体系)
5. [编辑护栏与环境限制](#五编辑护栏--环境限制)
5b. [组件与页面硬约定](#五之二组件与页面的硬约定-2026-09-22-踩坑)
6. [跨端口径](#六跨端口径必须一致)
7. [搜索匹配护栏](#七搜索匹配护栏)
8. [部署与上线](#八部署与上线)
9. [用户偏好](#九用户偏好)
10. [待办](#十待办)

---

## 一、当前架构（新 PRD 版）

> ⚠️ **2026-09-21 重大变更**：按 `G:\workbuddy\wuliuzhaunxianchaxun\PRD.md` **从零重写整个项目**。
> 用户原话：「按照这个重新设计，之前的全部删除，一点不留。」
> **旧 v6.x 架构（region-picker / searchCompany / reportFeedback 云函数 / tabBar 三 tab / 收藏与我的页 /
> utils/outlets.js / utils/lineKey.js / utils/contact.js / 根目录 PRD.md）已整体删除。**

### 数据模型：6 张表
`companies` / `routes` / `route_companies` / `cities` / `corrections` / `admins`
- 集合名与字段定义的**唯一来源**：`shared/schema.js`（小程序 / 云函数 / 后台都引它）
- **★ 核心取舍**：**时效 `transitDays`、是否直达 `isDirect`、发车频率 `frequency` 挂 `route_companies`**，
  **不挂 `routes`**。理由：同一家公司跑济南→广州 2 天、跑济南→乌鲁木齐 5 天，
  塞进 `companies` 或 `routes` 任一张表都是错的。
- 唯一数据源：`data/seed-data.js`（样板 **40 公司 / 55 线路 / 72 关联**）+ `data/cities.js`（344 城）+ `data/districts.js`

### 端
| 端 | 内容 |
|---|---|
| 小程序 8 页 | `pages/`: index / search-by-address / search-by-company / route-detail / company-detail / correction / privacy / disclaimer |
| 组件 | `components/`: city-picker / privacy-modal |
| utils（6 个） | common / search / db / params / privacy / correction（**无 contact.js**） |
| 云函数 | `submitCorrection` / `trackCompanyView` |
| **网页后台** | `admin/` —— **PRD 模块 06，唯一的 Web 端 / 唯一写入口 / 唯一需登录** |

### 视觉：Notion 浅色四条铁律
1. **无渐变**（主按钮纯色 `--brand` #0B6E99）
2. **无光斑**（全局无 `radial-gradient`）
3. **无半透明染色**（所有 `--tint-*` 全实色）
4. **无高光内阴影**（无 `inset 0 0 0 1rpx`）
- 页面底 `#F7F6F3`，卡片纯白，文字暖灰阶 `#37352F` / `#6B6B6B` / `#9B9A97`，细边框 `rgba(55,53,47,0.09)`
- **JS/app.json 不支持 CSS 变量**：改背景/主色须同步 `app.json` 的
  `navigationBarBackgroundColor` / `backgroundColor` / tabBar `selectedColor`·`color`·`backgroundColor`
- 后台共用同一套令牌（`admin/public/admin.css`），差异仅是基准 13px + 表格优先 + 系统字体栈

---

## 二、管理后台（admin/）

### 分层
```
server.js          HTTP 层：路由、静态文件、multipart 请求体读取
lib/store.js       纯内存业务逻辑：增删改查、级联维护、质量统计（不碰磁盘）
lib/db.js          只读写 JSON 文件（无业务判断）
lib/repository.js  写穿透：调 store 改内存 → 落盘
lib/auth.js        登录：scrypt 派生 + timingSafeEqual 定长比较 + HttpOnly Cookie
lib/importer.js    手写 xlsx/csv 解析、字段映射、值归一
lib/api.js         JSON 接口层（单入口 route(ctx)）
lib/views.js       服务端渲染 HTML（零依赖模板）
```

### 关键约定
- **零依赖**：只用 Node 内置模块（http/fs/crypto/zlib）。**无 package.json、无 node_modules**。
  刻意的：引入 express + better-sqlite3 就带进 node_modules 与编译工具链，「换台电脑就能跑起来」就失效了。
- **只绑 127.0.0.1**，端口 8787。后台是唯一写入口，必须关门。
- 启动 `node admin/server.js`，默认账号 `admin / admin12345`（登录后尽快改）。
- **零依赖 xlsx 解析**：xlsx 是 zip，用**中央目录**定位（不用本地头 —— data descriptor 长度可能为 0）
  + `zlib.inflateRawSync` 解 deflate。
- **multipart 二进制保真**：`readBody` 同时返回 `raw`(utf8) 与 `rawBinary`(latin1)；
  文件内容走 latin1 无损往返（utf8 会把 zip 字节变成 U+FFFD）。
- **`admin/data/` 是工作副本，不入版本库**（`.gitignore` 已排除）。
  它是「云端之前的待发布数据」，初值由 `scripts/export-seed.js` 从 `data/seed-data.js` 生成。
  被改乱后重建：**`node scripts/export-seed.js --admin-only`**（`admins.json` 不动）。
- 导入模板是**公开资源**（无需登录）：`/api/import/template`，内容是空表头+一行示例，带 BOM。
  路由**位于鉴权之前**，别再挪回去。
- 导入**先预览后确认**：预览阶段绝不写任何数据；错误行带 Excel 行号，跳过不影响其他行。
- 只做「登录 + 增删改 + 批量导入 + 质量看板」，**不做注册入口**（PRD 明确要求）。

---

## 三、★★ 覆盖写事故护栏（最严重的坑）

- `repository.flush()` 是**全量覆盖写**（把内存快照整个写进文件，不是增量追加）。
- **若内存未装载（未调 `loadAll()`）就执行写操作**，内存是空表 →
  **整个数据文件被抹成 `[]`，而且不报任何错**。2026-09-21 真实发生过一次，`admin/data` 四张表全被清空。
- **护栏**：`repository` 有 `loaded` 标志，**未装载调用 `flush()` 直接抛错**；
  `server.js` 的 `loadAll()` 不吞错（进程起不来也比数据没了强）。
- **任何新写的脚本，只要碰 `repository` 的写操作，必须先 `repo.loadAll()`。**
- 固化在 `test/suites/admin.test.js` 的「覆盖写事故护栏」describe + `scripts/smoke-admin.js`。
  **不要顺手简化掉。**

---

## 四、测试体系（改代码后按顺序跑）

| 层 | 命令 | 规模 |
|---|---|---|
| 单元 | `node test/run-all.js` | 6 套件 **341 断言** |
| 体检 | `node scripts/check-project.js` | **10 类**静态检查（含相对 require 有效性） |
| **模块基础能力** | `node .workbuddy/scripts/check-module-basics.js` | **8 个页面**（改页面后必跑） |
| 部署前 | `node scripts/check-deploy.js` | 云函数 **17 项**（前后端字段对齐 / 集合合法性 / 导入数据合规） |
| 验收 | `node scripts/check-acceptance.js` | A1~A12 **59 断言** + 12 项人工清单 |
| 冒烟 | `node scripts/smoke-admin.js` | 后台 HTTP 层 **72 断言**（临时用端口 8791） |
| BOM | `node .workbuddy/scripts/check-bom.js` | **提交审核前必跑** |

> **自检脚本报错时，先确认是代码错还是检查逻辑错**（同「修测试而不是修功能」）。
> 写静态检查的两个已知坑：
> ① `collection()` 的参数常是**常量引用**（`.collection(COLLECTION)`），只匹配字符串字面量会误报「未发现调用」；
> ② 已知例外要用**显式白名单**豁免（如 `view_dedup` 是内部表），**别只在注释里说明**。

- `run-all.js` 用**子进程逐个跑**：套件内部会 `process.exit()`，且 `submitCorrection` 会替换模块解析
  （`Module._load`），同进程混跑会互相污染。**别改成同进程串跑。**
- 套件分工：`admin.test.js` 测**逻辑**（纯内存、秒级）；`smoke-admin.js` 测**HTTP 层**
  （登录跳转、Cookie、状态码、目录穿越）—— 「逻辑对」不等于「线上能用」。
- 冒烟测试把 `admin/data` 当临时工作区（备份→跑→还原），**开跑前先体检数据目录**，
  坏数据直接拒绝运行。否则「还原」只会把坏数据还原回来，问题被永远掩盖。
- 测试自身的坑：`/logout` 会下发**清空型 Cookie**（`name=; ...; Max-Age=0`），
  若无脑用 `set-cookie.split(';')[0]` 覆盖测试的 cookie 变量，会得到一个空 token，
  之后所有请求静默 401 —— 会伪装成「接口坏了」。只在「下发了非空值」时才覆盖。

### 写静态扫描工具的铁律（`check-requires.js` 踩坑）
用正则扫源码时，**必须先剥注释、且必须保留字符串**，两者缺一不可：

- **不剥注释** → 注释里的用法示例被当成真实依赖（如
  `* 在套件里：const {...} = require('../framework')`）。相对路径是相对**注释所在文件**解析的，
  往往不存在 → **假警报淹没真问题**。假失败比不检查更糟，会让人直接忽略整个检查。
- **连字符串一起剥** → `require('./x')` 的路径**就在字符串里**，抹掉字符串后扫描结果变成 **0 处**
  → 检查形同虚设。（第一版就这么错过了。）
- **剥注释要用等长空白替换**（换行保留），这样**行号不变**，报错信息才能定位。
- 状态机式逐字符扫描：字符串内不判注释；单双引号不跨行、反引号可跨行；`\` 转义跳 2 位。

`.workbuddy/scripts/` 现在**只保留 6 个架构无关的通用工具**：
`check-bom.js` / `check-requires.js` / `scan-toast-length.js` /
`apply-design-tokens.js` / `audit-company-phones.js` / `fix-import-json.js`。
已失效的 20 个脚本归档在 `.workbuddy/memory/archive/dead-scripts/`
（**归档目录里的东西不要当代码引用**）。新增脚本请写在 `scripts/`（工程脚本）下，
`.workbuddy/scripts/` 只放跨项目可复用的工具。

---

## 五、编辑护栏 & 环境限制

### Windows 写文件禁止带 BOM（踩过坑）
- 微信 WXSS/WXML 编译器**不跳过 BOM**，文件头 `EF BB BF` 直接报 `unexpected '\uFEFF' at pos 1`。
- **规则：改本项目 `.wxss` / `.wxml` / `.js` / `.json` 一律用 Write/Edit 工具。**
- **绝不要用 PowerShell 的 `Out-File` / `Set-Content` / `>` 重定向**（Windows PowerShell 5.1 默认带 BOM）。
- 必须走 PowerShell 时用
  `[System.IO.File]::WriteAllText($p,$t,(New-Object System.Text.UTF8Encoding($false)))`。
- 批量改动后跑 `node scripts/check-project.js`，里面有 BOM 自检。

### 本机 Bash 环境残缺
- Bash PATH 损坏：`dirname` / `ls` / `grep` / `tail` / `head` / `cat` 均 `command not found`。
- **改用 Read/Write/Edit/Glob/Grep 工具**，或调 Node 绝对路径：
  `C:/Users/怀瑾/.workbuddy/binaries/node/versions/22.22.2-3/node.exe`
- Node 脚本参数须用 Windows 风格路径（`G:/...`）；`/g/...` 会被解析成 `g:\g\...`。
- **Node 的 `execSync` 在 Windows 上走 `cmd.exe`，不是 bash** ——
  `cmd 2>/dev/null || true` 这类 POSIX 兜底会报「'true' 不是内部或外部命令」并**整脚本崩掉**。
  探测型调用一律 `try/catch`。**别写 POSIX 兜底语法。**
- PATH 损坏 ⇒ **没法用 `export https_proxy=...` 传环境变量**；
  要给单条命令设代理，用工具自身配置（如 `git config http.proxy`）。

### 网络：GitHub 需要绕代理（别误判「推不了」）
| 通道 | 结果 |
|---|---|
| 默认（沙箱代理 `127.0.0.1:59788`） | ❌ github:443 `CONNECT tunnel failed, response 502` |
| **仓库级 `git config http.proxy http://127.0.0.1:7897`** | ✅ **通** |
| Gitee（走默认通道） | ✅ 通 |
- **遇到「GitHub 连不上」先试 7897 代理，再下结论。**
- 一键备份：`.workbuddy/scripts/push-backup.js <仓库地址>`（含敏感数据自检，推送前强制过三关）。

### 工作方式
- **坚持「修测试而不是修功能」**：断言失败时先查清是代码错还是断言写错，并在注释里写明原因防复发。
- 长任务收尾必跑四层测试，不信「应该没问题」。

---

## 五之二、组件与页面的硬约定（★ 2026-09-22 踩坑）

### 组件内遮罩/弹层样式必须自备
`components/privacy-modal` 与 `components/city-picker` 都是
`styleIsolation: "isolated"` ⇒ **`app.wxss` 的全局 `.mask` 进不来**。
两者都漏写了自己的 `.mask`，导致遮罩**零尺寸、零背景——肉眼完全看不见**，
但 `position:fixed; inset:0` 的父容器**仍是整屏块，照吃点击**。
叠加 `onReject()` 忘了 `setData({visible:false})`，弹窗永久残留
⇒ **首页所有按钮点击没反应**（用户根本看不见有个弹窗挡着）。

- **规则：组件内凡遮罩、弹层，样式一律写在该组件自己的 `.wxss` 里，不要依赖全局类。**
- 弹窗关闭路径必须全覆盖：同意 / 拒绝 / 点遮罩，三条都要 `setData({visible:false})`。
  遮罩建议直接绑「不同意」，保证任何情况下都关得掉、不会把用户卡死。

### 「按钮点了没反应」的排查顺序
1. **透明遮罩层残留**（`position:fixed; inset:0`）—— 本次真实命中，最易忽略
2. `bindtap` 拼写 / 方法名在 JS 里没实现
3. 跳转目标未在 `app.json` 注册，或 `switchTab` 去了非 tab 页
4. 元素被覆盖（z-index / 尺寸为 0）
5. 事件被 `catchtap` 截断

### 页面必须「符合自身场景的基础功能」
`.workbuddy/scripts/check-module-basics.js` 会量化检查（**改页面后必跑**）：

| 场景 | 必需能力 |
|---|---|
| 列表 / 检索页 | 下拉刷新、触底加载、加载态、空态、**失败态（可重试）** |
| 表单页 | 提交防重、必填校验、成功反馈 |
| 静态文本页 | 无额外要求 |

- ★★ **空态 ≠ 失败态**：「没有这条线路」是空态（重试无用，应引导换条件/反馈）；
  「网络或服务异常」是失败态（**必须给「重新加载」按钮**）。
  混为一谈会让用户把故障误认为"没数据"。
- 多区块页面（如首页）要**独立降级**：一块失败只显示那一块的重试，不整页白屏。
- 空态/失败态按钮统一用 `app.wxss` 的 `.empty-btn`（2026-09-22 新增）。
  旧的 `.empty-action` 只在两个页面有局部定义，**不要在别的页面复用**（曾出现
  `route-detail` 用了却没定义样式）。
- **客户端筛选 + 分页的坑**：查专线页筛选在客户端做，触底时若「这一页全被筛掉」
  会误判为没有直达公司。故触底要**循环补页**直到攒够可展示条数或后端确实无下一页。

---

## 六、跨端口径（必须一致，别各写一套）

| 能力 | 唯一来源 |
|---|---|
| 集合名与字段定义 | `shared/schema.js` |
| `routeKey` 派生 | `utils/common.js` 的 `buildRouteKey` |
| 城市归一 `normCity` | `utils/common.js`（去「市/区/县/省」后缀） |
| 公司搜索打分 | `utils/search.js` 的 `searchCompanies` |
| 电话校验 | `utils/common.js` 的 `isPhoneLike` |
| 客服联系方式 | `utils/privacy.js` 的 `CONTACT` |

`test/suites/admin.test.js` 有断言守着（如「两端首条搜索结果必须相同」）。

### `routeKey` 与 `companyCount`
- `routeKey = 出发城市-到达城市`，两侧都要过 `normCity`。
- 后台 `normalizeRoute` **一律重新派生 routeKey**，不采信传入值；
  `_id = 'route_' + routeKey.replace(/-/g,'_')`。
- 改线路城市必须**同步所有关联的 routeId / routeKey**，否则悬空外键、页面死链。
- `companyCount` 是冗余计数，任何关联增删后**重算**（`recountRoutes()`），**不要 `+=1/-=1`**。
- 删公司 / 删线路必须**级联删关联**，删完重算。

---

## 七、搜索匹配护栏

- **单字关键词只做「前缀」，一律不做「包含」** —— 否则「南」会命中几百家公司。
- 打分优先级：全称相等 100 / 简称相等 95 / 全称前缀 90 / 简称前缀 85 /
  全称包含 80 / 简称包含 75 / 拼音前缀 70 / 拼音包含 65 / 首字母 60。
- `detectKeywordType` 命中城市即优先返回 `'both'`。

---

## 八、部署与上线

### ⚠️ 两个工作区，别改错目录

| 目录 | 状态 |
|---|---|
| **`G:\workbuddy\logistics-line-query`** | **活跃项目**（已上线，GitHub remote，云环境 `cloud1-d0ge42roj61603242`，主体陈镇，v5.x 磨砂视觉） |
| `G:\workbuddy\wuliuzhaunxianchaxun` | **废弃的早期尝试**（扁平 Notion 主题 `#0B6E99`，云环境从未配置，`master` 分支无 remote，待办仍挂着「配云环境 ID」） |

两边 `pages/` **目录同名但代码不同**。`PRD.md` 一度只存在于废弃目录 ——
**改代码、查文档前先确认自己在哪个目录。**

### PRD 的当前状态（2026-09-22）
- 记忆中提到的 **v4.3 PRD**（含 `F-xx`/`R-xx` 编号、护栏 R-10~R-15）**已丢失**，
  从未进入本仓库（`git ls-files "*.md"` 查无）。
- 现 `PRD.md` 是从废弃目录找回的 **v1.0 基线副本**，文件头已标注
  「与代码冲突时以代码为准」，末尾有「变更补记」章节（C-01 模块基础能力 /
  C-02 公司线路合并 / C-03 列表分页）。
- ⇒ **定位需求编号时，PRD 可能没有；以代码实现为准，并回头补 PRD。**

### 上线纪律
- 主体**个人**（陈镇），服务类目「工具 → 信息查询」。**个人主体不能选需企业资质的类目**。
- 客服电话/微信 `15165018553` / `A15165018553`（`utils/privacy.js` 的 `CONTACT`）。
- **上线后变更纪律**：任何代码改动都需重新提交审核；不得在生产配置上做「顺手优化」
  （如 `libVersion` 保持 `trial` 不动）。
- 云函数改动后**必须重新上传部署**（阻断项）。
- **部署前检查清单**见 `docs/验收自检报告.md`：
  建 6 集合 → 导入 `.data/*.jsonl` → `corrections` 加索引 `openid+day`、`openid+targetId+day`
  → 上传云函数 → 12 项人工验证 → 提审。

---

## 九、用户偏好
- 简洁中文输出；文件级变更摘要 + 按优先级行动清单；UI 问题用截图沟通。
- 批次推进（P0/P1/P2），完成一项自动衔接下一项。
- 上线前检查类任务：**一次只问一个问题**，用普通人语言复述需求。
- 习惯上传截图传达视觉问题（而非文字描述）。

---

## 十、待办

1. ✅ **远程备份（已完成 2026-09-22）** —— `https://github.com/ztwl82518294/-`（私有）
   远程 `main` = 本地 = `615a68d`（139 文件，已对服务端核验，零数据泄漏）。
   **以后推送**：沙箱内跑 `node .workbuddy/scripts/push-backup.js <仓库地址>`
   （脚本自动写 `http.proxy=127.0.0.1:7897` 并跑三项敏感数据自检）；
   正常 shell 直连即可。
   ⚠️ **仍需用户确认该仓库是 Private** —— 里面含客服电话与公司信息。
2. ⬜ **云函数上传部署**（阻断项）—— 本地检查已全绿（`node scripts/check-deploy.js` 17/17），
   只剩手动上传：右键 `submitCorrection` / `trackCompanyView` → **上传并部署：云端安装依赖**
   （本地无 `node_modules`，不能选「所有文件」）。
3. ⬜ 云控制台建 6 集合 + 导入 `.data/*.jsonl`（companies 40 / routes 55 / route_companies 72 / cities 344，
   已核验行数与字段合规）
4. ⬜ `corrections` 加索引 `openid+day`、`openid+targetId+day`（云函数频控靠它计数）
5. ⬜ **12 项人工验证**（清单在 `docs/验收自检报告.md`）
6. ⬜ `admin/data/` 与云数据库的衔接：`/api/correction/merge` 已预留「拉线上纠错回本地」，
   但还缺「从云数据库导出纠错」的脚本

### 本机 git 的怪毛病：远程跟踪引用存不住
`git update-ref refs/remotes/origin/main <SHA>` **返回 0 却什么也不写**，
`.git/refs/remotes` 始终为空 ⇒ `git status` 显示 `[origin/main: gone]`、
`git log origin/main` 报 `Not a valid object name`。**是沙箱对 `.git` 写入的限制，不是仓库坏了。**
- **判断「有没有推上去」只看 `git ls-remote origin`**（问服务端），别信本地 `[gone]`。
- 要比对远程内容：`git fetch --no-tags origin <SHA>` 后对 `FETCH_HEAD` 操作。
- 推送被 `! [rejected] (fetch first)` 拒（远程已有 README）：合并要加
  `--allow-unrelated-histories`；README 冲突取 ours（远程通常是占位文件）。
