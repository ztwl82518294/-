# 物流专线查询

微信小程序 + 网页版管理后台。帮货主按**地址**或**公司**查到可用的物流专线，并拿到联系方式。

数据模型为 8 张表（公司 / 线路 / 线路-公司关联 / 城市 / 纠错 / 管理员 / 公告 / 优质线路推广），
核心取舍是：**时效、是否直达、发车频率这些属性挂在「线路-公司关联」上，不挂在线路上** ——
同一家公司跑济南→广州是 2 天、跑济南→乌鲁木齐是 5 天，属性必须按「谁跑哪条线」分开存。

---

## 一、目录结构

```
logistics-line-query/
├── pages/                 小程序 8 个页面
│   ├── index/             首页总览
│   ├── search-by-address/ 按地址查专线
│   ├── search-by-company/ 按公司查线路
│   ├── company-detail/    公司详情
│   ├── route-detail/      线路详情
│   ├── correction/        数据纠错提交
│   ├── disclaimer/        免责声明
│   └── privacy/           隐私政策
├── components/            城市选择器 / 隐私授权弹窗
├── utils/                 小程序端工具（搜索、常见工具、参数、隐私、纠错）
├── cloudfunctions/        云函数（submitCorrection / trackCompanyView）
├── shared/schema.js       ★ 跨端共享的集合名与字段定义（小程序 / 云函数 / 后台都引它）
├── data/                  ★ 唯一数据源：seed-data.js + cities.js + districts.js
├── admin/                 ★ 网页版管理后台（零依赖 Node，详见第三节）
├── start-admin.bat        ★ 双击进入管理后台
├── test/                  测试（框架 + 7 个套件 + 统一入口）
├── scripts/               工程脚本（体检 / 导出种子 / 后台冒烟 / 一键进后台）
└── docs/                  文档（后台使用说明 / 云函数部署 / 验收自检）
```

---

## 二、小程序端

用微信开发者工具打开本目录即可。

- 数据来源是**云数据库**（微信云开发），集合名定义在 `shared/schema.js`。
- `data/seed-data.js` 是样板数据（40 家公司 / 55 条线路 / 72 条关联），
  通过 `scripts/export-seed.js` 导出成 JSONL 后在云开发控制台导入。
- 云函数改动后**必须重新上传部署**，否则线上还是旧版本。

### 云函数

| 云函数 | 作用 |
|---|---|
| `submitCorrection` | 接收纠错提交。六道护栏：openid 必带 / action 白名单 / typeLabel 反查 / 字段截断 / 图片归一 / 限频（单目标 3 次、单日 20 次） |
| `trackCompanyView` | 公司浏览量上报 |

`corrections` 集合建议加两个索引：`openid + day`、`openid + targetId + day`（限频查询用）。

---

## 三、网页版管理后台

### ★ 怎么进后台（三种方式，挑一个）

**1. 双击 `start-admin.bat`**（推荐）

自动起服务 → 等服务真的能连上 → 打开浏览器。**别关那个黑窗口，关掉就是关掉后台。**

**2. 命令行**

```bash
node scripts/start-admin.js            # 同上，会自动开浏览器
node scripts/start-admin.js --no-open  # 只起服务，不开浏览器
```

**3. 手动**

```bash
node admin/server.js
```

然后自己打开 **http://127.0.0.1:8787**。

> 后台是**本机运维后台**，不在小程序里，也不是线上网站 —— 只监听 127.0.0.1，只有你本机能开。
> 完整操作说明见 **`docs/管理后台使用说明.md`**。

默认账号 `admin` / `admin12345`。**登录后到右上角「改密码」立刻换掉** ——
启动横幅会一直提醒，因为它确实是默认密码。

> 后台**只监听 127.0.0.1**，不对外网暴露。这是有意的 —— 它是整个系统唯一的写操作入口。

### 为什么是零依赖

后台只用 Node 内置模块（`http` / `fs` / `crypto` / `zlib`），**没有 package.json，没有 node_modules**。
理由很实际：引入 express + better-sqlite3 就会带来 node_modules 与编译工具链，
「换台电脑就能把项目跑起来」这件事就失效了。用 `http` + `fs` 手写完全够用。

连 Excel 解析都是手写的：xlsx 本质是个 zip，用中央目录定位 + `zlib.inflateRawSync` 解 deflate 即可，
不用引入几百 KB 的解析库。

### 分层

```
admin/
├── server.js        HTTP 层：路由、静态文件、multipart 请求体读取
├── lib/
│   ├── store.js         纯内存业务逻辑：增删改查、级联维护、质量统计（不碰磁盘）
│   ├── db.js            只负责读写 JSON 文件（无业务判断）
│   ├── repository.js    写穿透：调 store 改内存 → 落盘
│   ├── auth.js          登录（scrypt 派生 + 定长比较 + HttpOnly Cookie）
│   ├── importer.js      Excel/CSV 解析、字段映射、值归一
│   ├── api.js           JSON 接口层（单入口 route(ctx)）
│   └── views.js         服务端渲染 HTML（零依赖模板）
├── public/         静态资源（CSS 与少量原生 JS）
└── data/           ★ 工作副本，务必阅读下面一段
```

### ★ 关于 `admin/data/`

`admin/data/*.json` 是后台**运行时读写的工作副本**，初值由 `scripts/export-seed.js`
从 `data/seed-data.js`（唯一数据源）生成：

```
data/seed-data.js  ──导出──▶  admin/data/*.json  ──导入──▶  云数据库
        ▲                          ▲
        │                          │（后台在这里增删改）
   （唯一数据源）               （后台工作副本）
```

后台的职责是「把数据弄进云数据库」，它天然在云端之前，所以必须有一份本地可直接编辑的副本。

**这个目录不入版本库**（已在 `.gitignore` 里排除），因为它会被后台随时改写，
入库只会制造无意义的 diff；而且一旦接入真实运营，里面就是真实的公司电话与地址。

被改乱或写坏了怎么恢复：

```bash
node scripts/export-seed.js --admin-only
```

`admins.json`（管理员账号）不受影响。

### 数据安全护栏：未装载禁止落盘

`repository.flush()` 是**全量覆盖写** —— 把内存表的快照整个写进文件。
这意味着：**如果内存还没从磁盘装载就执行写操作，内存里是空数组，覆盖写下去就是把数据文件抹成 `[]`。**

这个坑的真实形态是：写个脚本调 `repo.createCompany({...})` 想插一条数据，
忘了先 `loadAll()`，结果**整个公司的数据都没了，而且不报任何错**。

所以 `repository` 加了一道硬护栏：**未装载就调用落盘，直接抛错**。

```js
repo.createCompany({...})   // ← 未 loadAll() 时抛错：
// 拒绝落盘：数据尚未装载。请先调用 repository.loadAll()（或 bootstrapFrom）。
```

宁可开发时报错，也不能让运营数据静默消失。这个约束有测试固化（见 `test/suites/admin.test.js`
的「覆盖写事故护栏」一节），别顺手简化掉。

### 功能（PRD 模块 06）

| 页面 | 路径 | 说明 |
|---|---|---|
| 总览 | `/` | 数据规模 + 待审核纠错 |
| 公司 | `/companies` | 分页浏览 + 搜索 + 增删改 |
| 线路 | `/routes` | 同上 |
| 线路公司 | `/links` | 关联维护（时效、直达、频率挂在这一层） |
| 纠错审核 | `/corrections` | 采纳 / 驳回 / 待定，带目标上下文 |
| 公告栏 | `/announcements` | 首页滚动播放的公告（正文必填、链接只允许 `/pages/...`） |
| 优质线路推广 | `/featured` | 只存 routeKey，公司数按线路现场回查 |
| 批量导入 | `/import` | 三步向导：选文件 → 字段映射 → 错误预览与确认 |
| 数据质量 | `/quality` | 缺电话条数、超 90 天未更新条数、一致性问题 |
| 修改密码 | `/password` | 右上角入口。改完强制重新登录 |

### 批量导入

支持 `.xlsx` 与 `.csv`。流程是**先预览、后确认**：

1. 上传文件 → 自动识别表头并给出字段映射建议
2. 映射可手工调整，重新校验
3. 逐行列出错误（**带 Excel 行号**，方便定位）与原因
4. 确认后才真正写入

**预览阶段绝不写任何数据**（有无副作用断言守着）。错误行会被跳过，不会污染数据库。

`.xls` 老格式不支持，会提示「请在 Excel 里另存为 .xlsx 或 .csv」。

### 导入模板

**公开资源，无需登录**：http://127.0.0.1:8787/api/import/template

内容是空表头 + 一行示例，不含任何业务数据。带 UTF-8 BOM，Excel 打开中文不乱码。

---

## 四、测试

### 跑全部

```bash
node test/run-all.js           # 7 个套件，373 个断言
node scripts/check-project.js  # 静态体检：绑定 / dataset / 路由 / wx:key / BOM / 测试套件
node scripts/smoke-admin.js    # 后台 HTTP 冒烟，105 个断言（会临时占用 8791 端口）
```

### 套件分工

| 套件 | 断言数 | 覆盖 |
|---|---|---|
| `common.test.js` | 68 | 城市归一、routeKey 派生、电话校验等纯函数 |
| `search.test.js` | 54 | 匹配打分优先级、筛选排序、关键词类型判定 |
| `seed-data.test.js` | 41 | 样板数据质量：零缺失、外键完整、计数一致、确定性 |
| `submitCorrection.test.js` | 34 | 云函数六道护栏（Mock 掉 wx-server-sdk，以攻击者视角测） |
| `homepage-ops.test.js` | 32 | 区县字典与反查、公告 / 推广位的校验规则 |
| `company-detail-merge.test.js` | 6 | 公司详情页的线路合并 |
| `admin.test.js` | 138 | 后台 store / importer / auth / views + 覆盖写护栏 |

`admin.test.js` 与 `smoke-admin.js` 的分工：前者测**逻辑**（纯内存、秒级），
后者测**HTTP 层**（真实请求：登录跳转、Cookie、状态码、目录穿越）。

### smoke-admin 会动 `admin/data/`，但不会污染它

冒烟测试需要真实的读写落盘才能验证，所以它把 `admin/data/` 当临时工作区用：
启动前备份到 `.tmp-smoke-backup/`，结束时还原（连本次新建的 `admins.json` 也一并删掉）。

另外它在开跑前会**先体检数据目录**：如果进入时就发现文件为空或解析不了，直接拒绝运行并提示修复命令 ——
否则「还原」只会把坏数据还原回来，问题被永远掩盖。

---

## 五、约定与坑

### Windows 写文件禁止带 BOM

微信小程序的 WXSS/WXML 编译器**不跳过 BOM**，文件头有 `EF BB BF` 会直接报
`unexpected '\uFEFF' at pos 1`。

- 改本项目的 `.wxss` / `.wxml` / `.js` / `.json`，一律用编辑器工具直接写。
- **绝不要用 PowerShell 的 `Out-File` / `Set-Content` / `>` 重定向** —— Windows PowerShell 5.1 默认写 UTF-8 with BOM。
- 必须走 PowerShell 时用：
  `[System.IO.File]::WriteAllText($p, $t, (New-Object System.Text.UTF8Encoding($false)))`
- 批量改动后跑一遍 `node scripts/check-project.js`，里面有 BOM 自检。

### 跨端口径必须一致

以下能力小程序端与后台**共用同一份实现**，不要各写一套：

| 能力 | 唯一来源 |
|---|---|
| 集合名与字段定义 | `shared/schema.js` |
| `routeKey` 派生 | `utils/common.js` 的 `buildRouteKey` |
| 城市归一 `normCity` | `utils/common.js` |
| 公司搜索打分 | `utils/search.js` 的 `searchCompanies` |
| 电话校验 | `utils/common.js` 的 `isPhoneLike` |

`admin.test.js` 里有断言守着这点（如「两端首条搜索结果必须相同」）。

### 城市字段与 `routeKey`

`routeKey = 出发城市-到达城市`，两侧都要过 `normCity` 去掉「市/区/县/省」后缀。

- 后台 `normalizeRoute` **一律重新派生 routeKey**，不采信传入值。
- 改线路城市时，必须**同步所有关联的 routeId / routeKey**，否则产生悬空外键、页面死链。
- `companyCount` 是冗余计数，任何关联增删后**重算**（`recountRoutes()`），不要 `+=1/-=1`。

### 级联删除

删公司 / 删线路必须**同时删关联**，否则留下悬空外键。

---

## 六、上线相关

- 小程序已通过微信审核并上线。**上线后任何代码改动都需重新提交审核**，
  也不要在生产配置上做「顺手优化」。
- 注册主体是**个人**，服务类目走「工具 → 信息查询」。不能选需要企业资质的类目。
- 云函数改动后必须重新上传部署（`submitCorrection`、`trackCompanyView`）。
- 客服联系方式在 `utils/privacy.js` 的 `CONTACT`。
