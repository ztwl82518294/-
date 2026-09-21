# 物流专线查询 - 项目长期备忘

## 文档基准（重要）
- **`PRD.md`（根目录，v4.0）是后续开发的唯一依据**，按代码实现反向整理，含需求编号 `F-{模块}-{序号}` / `R-{序号}`、数据模型、以及第 6 章「数据一致性护栏 R-10~R-15」。
- `README.md` 是 v3.1 介绍性文档，已明显滞后（未覆盖 VIP 到期模型、兑奖码、月度统计、埋点频控、按公司批量 VIP、双键制/自愈迁移）。**两者冲突时以 PRD 为准。**
- 动工前先在 PRD 定位需求编号；新增能力需先补 PRD 条目再写代码。

## 数据形态约定（重要）
- 网点数据入库路径有三条，形态不统一：① 新版 adminLine save/batchSave → `[{addr,phone}]` 数组；② 旧版云函数批量导入/控制台直灌 → 字符串 `"地址 | 电话1,电话2"` + 老字段全空；③ 手工编辑 → 老字段有值。
- 读端统一用 `utils/outlets.js` 的 `parseOutlets/deriveLegacy` 归一（详情页、编辑页已接入），口径与 adminLine 服务端 `deriveOutlets` 一致。新增消费网点/地址/电话的页面时必须先过 deriveLegacy。
- 服务端 adminLine `deriveOutlets` 有两道护栏：三者都未提交不动网点字段（防 update 清空）；单地址多电话保持 1 网点挂多号。
- 城市索引字段 fromCity/toCity 由服务端 normCity 派生（去"市/区/县/省"后缀）；searchLine 查询侧同口径归一，两侧必须一致。

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

## 运维事项
- git 仓库仍 0 提交、无版本备份（已多次提醒用户，未处理）。
- 云函数改动后需在开发者工具重新上传；adminLine 最近一次修复（2026-09-16）后用户需重传。
- 导入文件放 `E:\微信小程序公司信息\`；项目自带的 JSON 处理脚本在 `.workbuddy/scripts/`（fix-shandong-json.js 可作为其他公司数据修复的模板）。
- 一键回归：`node .workbuddy/scripts/run-tests.js`；静态体检：`node .workbuddy/scripts/scan-project-health.js`（绑定/dataset/路由/wx:key）。改前端绑定时先跑体检。

## 用户偏好
- 简洁中文输出；文件级变更摘要 + 按优先级行动清单；UI 问题用截图沟通。
- 批次推进（P0/P1/P2），完成一项自动衔接下一项。
