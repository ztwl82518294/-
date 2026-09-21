# 数据库索引配置（createIndexes）

wx-server-sdk 不提供代码建索引的 API，索引需在**云开发控制台手动创建**，
或使用控制台「数据库 → 索引管理 → 导入」导入本目录的 JSON 文件。

> **为什么这里还有 `index.js`？**
> 本目录位于 `cloudfunctions/` 下，开发者工具「上传并部署」会校验目录结构，
> 缺少 `index.js` / `package.json` 会被判定为损坏的云函数而上传失败。
> 该入口不建索引，只返回本仓库维护的索引清单（`action: 'list'` / `'get'`），
> 便于日后核对线上索引是否与仓库一致。

## 必建索引清单

| 集合 | 字段 | 用途 | 排序 |
|------|------|------|------|
| lines | fromCity | 直达/中转搜索粗过滤（searchLine，标准城市字段，万股级核心索引） | 升序 |
| lines | toCity | 搜索粗过滤（标准城市字段） | 升序 |
| lines | fromCity + status | 直达查询复合索引（status=1 常量过滤） | 均升序 |
| lines | fromCityName | 旧数据兼容查询（后缀变体 in 查询） | 升序 |
| lines | toCityName | 旧数据兼容查询 | 升序 |
| lines | fromCityName + toCityName + status | 复合查询（status=1 常量过滤） | 均升序 |
| lines | companyName | batchVip 按公司批量开通 | 升序 |
| stat_events | month + _openid | adminStats / prize 月度活跃聚合 | 均升序 |
| stat_events | day + _openid | statLog 频控计数（同用户当日条数） | 均升序 |
| stat_events | month + type | adminStats 搜索/浏览分别计数（`where({month,type}).count()`） | 均升序 |
| favorites | lineId | 收藏查重 / isFavorite | 升序 |
| favorites | **_openid + lineId** | **唯一索引**，根治重复收藏（见下方注意事项） | 均升序 |
| favorites | createTime | getFavorites 按时间倒序分页 | **降序** |
| prize_codes | code | 兑奖码核销查询 | 升序 |
| prize_codes | month + openid | 名单/幂等生成 | 均升序 |
| prize_logs | month + ts | 管理员日志按月份查最近 50 条（`where({month}).orderBy('ts','desc')`） | month 升序 / ts **降序** |
| prize_logs | ts | 不传月份时查全量日志最近 50 条 | **降序** |

## ⚠️ favorites 唯一索引：建之前必须先清理重复数据

`addFavorite` 是「先查后插」，两步之间不是原子操作，连点会产生同一用户同一线路的重复记录。
建 `_openid + lineId` **唯一索引**后由数据库兜底，可从根上杜绝。

但**集合里若已存在重复数据，唯一索引会创建失败**。请按顺序操作：

1. 云开发控制台 → 数据库 → `favorites` → 聚合，用下面语句找出重复分组：

   ```js
   .match({})
   .group({ _id: { openid: '$_openid', lineId: '$lineId' }, ids: $.push('$_id'), n: $.sum(1) })
   .match({ n: { $gt: 1 } })
   .limit(1000)
   ```

2. 对每一组保留 `ids` 中的第一条，其余记录删除（控制台记录列表按 `_id` 删除即可）。
3. 重复数据清理干净后，再建唯一索引。
4. 若暂时不想清理，可先建**非唯一**的 `_openid + lineId` 索引（同样能加速查重），
   等清理完再改唯一；此时 `utils/storage.js` 的 `addFavorite` / `removeFavorite`
   已有兼容逻辑（重复键错误按成功处理、取消时清理全部重复项），不会报错。

## 控制台操作步骤

1. 打开微信开发者工具 → 云开发控制台 → 数据库
2. 选中集合 → 「索引管理」→ 逐条添加上表索引（复合索引按顺序填入字段）
3. 索引为后台异步构建，数据量大时需等待几分钟

## 本目录文件说明

- `lines.indexes.json` / `stat_events.indexes.json` / `favorites.indexes.json`
  / `prize_codes.indexes.json` / `prize_logs.indexes.json`
  —— 各集合的索引定义（字段名 + 顺序），可对照手动录入。
- 索引名与字段顺序需与 JSON 保持一致；`direction` 中 `"1"`=升序、`"-1"`=降序。
