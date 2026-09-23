# 物流专线查询 · 项目长期备忘

> **唯一有效的项目规范。** 日志 `YYYY-MM-DD.md` 是流水；旧架构归档 `archive/*.full.md`（代码已删，仅供追溯）。

## 一、架构

2026-09-21 从零重写（旧 v6.x 用户要求全删）。
**8 表**：companies/routes/route_companies/cities/corrections/admins/announcements/featured_routes；字段唯一来源 `shared/schema.js`。
★ **时效/直达/频率挂 route_companies**（不挂 routes）——同公司不同线路时效不同。
数据源 `data/seed-data.js`(40公司/55线路/72关联)+cities.js(344城)+districts.js(2980区县)+announcements.js。

| 端 | 内容 |
|---|---|
| 小程序 13 页 | 8 业务页 + `pages/admin/*` 五页(index/list/edit/quality/import) |
| 组件 | city-picker / privacy-modal |
| utils | common/search/db/params/privacy/correction/admin |
| 云函数 | submitCorrection / trackCompanyView / **adminApi** |
| 后台 | `admin/`(Web，唯一登录入口) + 小程序后台(直写云端) |

**首页**：.sky + 公告 swiper + 推广横卡 + 双入口。公告/推广后台维护，取不到退回 `data/announcements.js`；公告 link 只许本小程序路径或空（个人主体不能配外链域名）。推广位存 routeKey+文案，公司数现场查。
★ **区县只影响展示不影响查询**（选区县仍按所属城市查）。

**视觉五条铁律**：无渐变（唯一例外 .sky）/ 无光斑 / `--tint-*` 全实色 / 无高光内阴影 / 字体无毛玻璃（禁 blur、半透明**文字**色，描边可用半透明）。主色 #0B6E99，页底 #F7F6F3，文字 #37352F/#6B6B6B/#9B9A97。渐变白名单制（`check-project.js` 的 GRADIENT_ALLOW）。改主色须同步 `app.json` navigationBar/tabBar。

### ★ 小程序端后台
- 必须走 adminApi：页面禁 `.collection(`；白名单**服务端**校验，空则一律拒绝（不算放行）
- 首页「管理」仅 whoami 通过才渲染；列表/表单 type 驱动，元信息在 `utils/admin.js` TYPES（加字段改元信息，不动页面）
- **★★ 首次开通路径**（文档曾写成死锁）：入口只对管理员显示，而成为管理员又需先有 openid。
  破局 = 后台首页**对非管理员也显示 openid**（whoami 是唯一不校验管理员的接口，专为破局而设）。
  顺序：传 adminApi（白名单空也行）→「添加编译模式」启动页 `pages/admin/index/index` 抄 openid →
  填 `ADMIN_OPENIDS` → **重新部署** → 入口出现。详见 `docs/小程序后台使用说明.md` 第二节
- **★★ `//` 注释符陷阱**（2026-09-23 真事故）：模板示例行自带 `//`，改了内容却没删注释符 ⇒ 看着填好了、服务端眼里白名单仍空。
  判据：`check-deploy` 报「已配置 N 个管理员」；现在的解析是**先剥注释再数字面量**
- checkAdmin 失败**界面静默**（普通用户无感），但向 Console 打印 NO_FUNC/NOT_CONFIGURED/NOT_ADMIN/NO_OPENID/NETWORK/BAD_RESULT 六类人话解释
- 手机端导入=粘贴 CSV，预览→确认，预览零写入

## 二、桌面后台 admin/

零依赖（仅 Node 内置），只绑 127.0.0.1:8787，admin/admin12345，双击 `start-admin.bat` 启动，改密码 /password。
- ★ bootstrap 曾把集合名当文件名 ⇒ **每次启动用 seed 覆盖全部表**。文件存在性一律 `db.fileOf()`，只补缺失表；护栏 smoke-admin.js
- xlsx=zip 用**中央目录** + inflateRawSync；multipart 用 **latin1** 保真
- `admin/data/` 是工作副本不入库；改乱用 `node scripts/export-seed.js --admin-only` 重建
- 导入模板 `/api/import/template` 公开、路由在鉴权之前；先预览后确认；静态资源 no-store

### ★★ 两套后台冲突
桌面后台写**本地副本**，小程序后台**直写云端** ⇒ 小程序端改过后**绝不能拿 admin/data/ 覆盖云端**（整批抹掉、不可恢复）。
防线分散三处，**互为备份、都不能删**（`two-backends.test.js` 18 断言守着）：
① `pages/admin/index` 常驻提醒卡 ② `export-seed.js` 产出 jsonl 前的覆盖云端警告 ③ 文档（`docs/小程序后台使用说明.md` 第六节，桌面文档第四节指向它）。
> **例外：`export-seed --admin-only` 安全** —— 只重建本地副本，不产出 jsonl。

运营位校验：公告正文非空/level 枚举/link 以 / 开头/时间窗不倒挂；推广 routeKey 必须存在/同线路仅一个/角标≤8 字。`parseTimeInput` 别直接 Number()（NaN 静默变 0）。store 的 T 键名=集合名。

## 三、★★ 覆盖写护栏（最严重）

`repository.flush()` 全量覆盖写；未 `loadAll()` 就写 ⇒ 文件被抹成 `[]` 且不报错（2026-09-21 真发生过）。
护栏：`loaded` 标志未装载抛错；`loadAll()` 不吞错。**新脚本碰写操作必须先 loadAll()**。固化在 admin.test.js + smoke-admin.js，别简化掉。

## 四、测试体系（改代码按序跑）

| 层 | 命令 | 规模 |
|---|---|---|
| 单元 | `node test/run-all.js` | 11 套件 510 断言 |
| 体检 | `node scripts/check-project.js` | 12 类 |
| 模块基础 | `node .workbuddy/scripts/check-module-basics.js` | 13 页（改页面必跑） |
| 部署前 | `node scripts/check-deploy.js` | 27 项 |
| 验收 | `node scripts/check-acceptance.js` | 61 断言+12 人工 |
| 冒烟 | `node scripts/smoke-admin.js` | 108 断言（端口 8791） |
| BOM | `node .workbuddy/scripts/check-bom.js` | 179 文件，提审前必跑 |

> `two-backends.test.js` 测的是「**护栏还在不在**」（文档/脚本警告/页面提醒卡三处存在），不是功能逻辑——分散防线最易被当冗余删掉，值得自动化。
> 「配置没填」算**通知不算失败**（空态≠失败态），否则红灯会让人习惯性忽略。

- 报错先分清「代码错 / 检查逻辑错」；「检查器关键词落后」改检查器，**绝不为过检加无用代码**
- run-all.js **子进程逐跑**（套件会 exit + Module._load 污染），别改同进程
- admin.test 测逻辑 / smoke 测 HTTP 层；冒烟备份→跑→还原，开跑前先体检数据目录
- `/logout` 清空型 Cookie 别覆盖 token（否则静默 401）；集合清单用 `Object.values(COLLECTIONS)` 别手抄
- 写扫描工具：**剥注释（等长空白保行号）+ 保留字符串**，缺一不可。CSS 属性匹配用后行否定 `(?<![-\w])color`
- **剥注释现成实现：`scripts/lib/src-scan.js` 的 `stripComments()`**（check-deploy 与测试共用）
- `.workbuddy/scripts/` 只放跨项目通用工具（现 6 个）；失效脚本在 `memory/archive/dead-scripts/` 别引用

## 五、编辑护栏 & 环境限制

**禁 BOM**：改 wxss/wxml/js/json 一律 Write/Edit；禁 PowerShell `Out-File`/`Set-Content`/`>`（5.1 默认 BOM）。必须走 PS 用 `[System.IO.File]::WriteAllText($p,$t,(New-Object System.Text.UTF8Encoding($false)))`。

**★★ 禁 @swc/runtime 语法（白屏事故）**：enhance:true 走 SWC ⇒ **数组解构/对象展开/数组展开/for...of** 生成 `require('@swc/runtime/...')`，零依赖 ⇒ 整页白屏。改写：`x[0]`、`Object.assign`、`concat`/`apply`、下标 for。`admin/` 与 `test/` 不受限。护栏 check-project.js 第 11 类；栈行号是产物行号，跑静态体检更快。

**本机环境**
- Bash PATH 损坏：dirname/ls/grep/tail/head/cat/rm/wc 全不可用 ⇒ 用 Read/Write/Edit/Glob/Grep 或 Node 绝对路径 `C:/Users/怀瑾/.workbuddy/binaries/node/versions/22.22.2-3/node.exe`；Node 参数用 `G:/` 风格
- Node `execSync` 走 cmd.exe：POSIX 兜底（`2>/dev/null||true`）会崩，探测用 try/catch
- git：直连 push；不通跑 `.workbuddy/scripts/push-backup.js <仓库地址>`（自动 7897 代理+敏感自检）；**推送与否只看 `git ls-remote origin`**（本地跟踪引用存不住）；rejected 加 `--allow-unrelated-histories`
- 开发者工具装在 `D:\微信web开发者工具`（非 Program Files，注册表查不到）

### ★★ WXSS「样式全丢」排查（2026-09-22 实战）
症状：内容数据在、导航栏/tabBar 正常、全项目样式丢失。
1. **先用官方 wcsc 真编译**裁决，别肉眼审：`D:\微信web开发者工具\resources\app.asar.unpacked\node_modules\wcc-exec\wcsc.exe`，
   用法 `wcsc.exe -o OUT -js -pc N app.wxss 其余全部.wxss`（-lc 开 lint）。本项目 16 个 wxss 全过，`calc(50% - var(--gap-sm) / 2)` 也接受 ⇒ calc 除法不是问题
2. 编译过 ⇒ 优先怀疑**热重载缓存错乱**：`project.private.config.json` 的 `compileHotReLoad:true`，一次性新增多页后增量补丁脱节正是此症状。
   处理顺序：点「编译」全量重编译 → 关热重载 → 清缓存重启 → 仍不行看 Console 红报错
3. 静态排查用「**新旧写法集合差**」：老文件（确定能编译）的属性/伪类/函数/组合符集合减新文件集合，独有写法才是嫌疑

## 五之二、组件与页面硬约定

### ★★ 弹层三条铁律
1. **样式自备**（isolated 组件吃不到 app.wxss 的 `.mask`；零尺寸遮罩照吃点击 ⇒「按钮全没反应」）
2. **z-index 写死**（遮罩 0 面板 1）；居中用父级 flex，别 top:50%+translateY（层叠上下文错位）
3. **不用 inset 简写**（低版本内核塌 0），四边写开

关闭路径全覆盖：同意/拒绝/遮罩/× 都 `setData({visible:false})`；副作用放在 setData 之后。护栏 check-project.js 第 12 类。
「按钮没反应」排查顺序：透明遮罩残留 → z-index/transform → bindtap 拼错或未实现 → 页面未注册/switchTab 非 tab → 覆盖或零尺寸 → catchtap 截断。另：文案承诺了交互但页面没做。

### 页面基础能力（check-module-basics，改页面必跑）
列表页：下拉刷新/触底加载/加载态/空态/**失败态必须可重试**；表单页：防重/必填校验/成功反馈。
**空态≠失败态**。多区块页独立降级（首页 featLoading/featError）。统一 `.empty-btn`。
筛选+分页：触底循环补页攒够可展示条数，否则整页被筛掉会误判「无结果」。

## 六、跨端口径（唯一来源，别各写一套）

schema=`shared/schema.js`；导入=`shared/import.js`；小程序后台元信息=`utils/admin.js` TYPES；字段校验=`shared/validate.js`；routeKey/normCity=`utils/common.js`；区县反查=`utils/search.js` resolvePlace；公司打分=searchCompanies；电话=isPhoneLike；客服=`utils/privacy.js` CONTACT。
- normalizeRoute 一律重派生 routeKey；改线路城市同步所有关联；companyCount **重算不增减**；删公司/线路级联删关联
- 云函数只上传自己目录 ⇒ shared/utils 要在云函数目录内放**副本**；`sync-cloud-shared.js --check` 查漂移
- 小程序页面禁 `.collection(`（静态断言守着）

## 七、搜索护栏

单字关键词只前缀不包含；打分 100/95/90/85/80/75/70/65/60；detectKeywordType 命中城市优先 'both'；混合搜城市排前。

## 八、部署上线

⚠️ 活跃项目 `G:\workbuddy\logistics-line-query`；`G:\workbuddy\wuliuzhaunxianchun` 是废弃尝试，别改错目录。
PRD 现存 v1.0 基线（v4.3 丢失），冲突以代码为准。个人主体陈镇，类目工具→信息查询，客服 15165018553。
上线后改动需重新提审；`libVersion` 保持 trial；**云函数改动必须重新上传部署**。
部署清单（`docs/验收自检报告.md`）：建 8 集合 → 导 `.data/*.jsonl` → corrections 索引 openid+day、openid+targetId+day → 上传云函数 → 12 项人工 → 提审。

## 九、用户偏好

简洁中文；文件级变更摘要 + 优先级行动清单；UI 问题用截图；批次推进（P0/P1）完成即衔接下一项；检查类任务一次只问一个问题；决策前先要整体评估。

## 十、待办

1. ✅ 远程 https://github.com/ztwl82518294/- （用户确认 Private）
2. ⬜ **云函数上传部署**（含 adminApi，选「云端安装依赖」；前后各跑 `sync-cloud-shared.js --check`）——openid 已填且生效，重传后「管理」入口应出现
3. ⬜ 云控制台建 8 集合 + 导 jsonl：companies40/routes55/route_companies72/cities344/announcements4/featured6
4. ⬜ corrections 索引 ｜ 5. ⬜ 12 项人工验证 ｜ 6. ⬜ 缺「云库导出纠错」脚本 ｜ 7. ⬜ PRD v4.3 找回 ｜ 8. ⬜ 废弃目录可否删 ｜ 9. ⬜（可选）关 enhance 换 Babel
