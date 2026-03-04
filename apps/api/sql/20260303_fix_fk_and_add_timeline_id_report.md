# 20260303 FK 修复与 timeline_id 迁移报告

## 1) 审计结果（执行前）

数据库：`duanju`

### 1.1 关键表结构快照
- `novel_explosions`: `novel_id` 外键指向 `novels(id)`，`timeline_id` 字段已存在但无外键。
- `novel_key_nodes`: `novel_id` 外键指向 `novels(id)`，`timeline_id` 已有外键指向 `novel_timelines(id)`。
- `novel_timelines`: `novel_id` 外键指向 `novels(id)`。

### 1.2 仍引用 `novels` 的外键（审计 SQL）
共发现 7 条：
- `novel_characters.novel_characters_ibfk_1` (`novel_id` -> `novels.id`)
- `novel_contents.novel_contents_ibfk_1` (`novel_id` -> `novels.id`)
- `novel_episodes.novel_episodes_ibfk_1` (`novel_id` -> `novels.id`)
- `novel_explosions.novel_explosions_ibfk_1` (`novel_id` -> `novels.id`)
- `novel_hook_rhythm.novel_hook_rhythm_ibfk_1` (`novel_id` -> `novels.id`)
- `novel_key_nodes.novel_key_nodes_ibfk_1` (`novel_id` -> `novels.id`)
- `novel_timelines.novel_timelines_ibfk_1` (`novel_id` -> `novels.id`)

补充发现：
- `novel_configs` 有 `novel_id` 列，但此前没有外键约束。

## 2) 修复动作（已执行）

迁移文件：
- `apps/api/sql/20260303_fix_fk_and_add_timeline_id.sql`

执行命令：
- `mysql -h 127.0.0.1 -P 3306 -u root -p123456 duanju < apps/api/sql/20260303_fix_fk_and_add_timeline_id.sql`

### 2.1 外键修复
- 删除所有 `novel_*` 表中 `novel_id` 上“非 `drama_novels`”的外键（包含原指向 `novels` 的外键）。
- 统一补齐/重建 `novel_*`.`novel_id` -> `drama_novels(id)`：
  - `ON DELETE CASCADE`
  - `ON UPDATE CASCADE`
- 同步覆盖到 `novel_timelines.novel_id`。
- 为 `novel_configs.novel_id` 新增了到 `drama_novels(id)` 的外键（此前缺失）。

### 2.2 `timeline_id` 修复
- 确保 `novel_explosions.timeline_id`、`novel_key_nodes.timeline_id` 存在且为 `INT NULL`。
- 重建两表 `timeline_id` 外键为：
  - `REFERENCES novel_timelines(id)`
  - `ON DELETE SET NULL`
  - `ON UPDATE CASCADE`

### 2.3 孤儿数据处理（默认方案1，保守）
执行前计数（迁移脚本自动输出）：
- `orphan_novel_timelines_novel_id`: `0`
- `orphan_novel_explosions_novel_id`: `0`
- `orphan_novel_key_nodes_novel_id`: `0`
- `orphan_novel_explosions_timeline_id`: `0`
- `orphan_novel_key_nodes_timeline_id`: `0`

清理执行影响：
- `cleaned_novel_explosions_timeline_id_rows`: `0`
- `cleaned_novel_key_nodes_timeline_id_rows`: `0`
- 各 `novel_*` 表 `novel_id` 清理影响均为 `0`

说明：
- 默认方案1已执行：`timeline_id` 非法值置空，`novel_id` 非法值对可空列置空、不可空列删除。
- 方案2（严格，占位补齐）已写在迁移脚本注释中，未默认执行。

## 3) 验证结果（执行后）

### 3.1 不再存在引用 `novels` 的外键
- `information_schema.KEY_COLUMN_USAGE` 查询结果：`0` 条。

### 3.2 关键表 `SHOW CREATE TABLE` 验证
- `novel_explosions`：
  - `fk_novel_explosions_novel_id_drama_novels`
  - `fk_novel_explosions_timeline_id_novel_timelines`
- `novel_key_nodes`：
  - `fk_novel_key_nodes_novel_id_drama_novels`
  - `fk_novel_key_nodes_timeline_id_novel_timelines`
- `novel_timelines`：
  - `fk_novel_timelines_novel_id_drama_novels`

结论：迁移成功，目标约束全部生效。

## 4) 回滚建议（手动）

> MySQL DDL 非完全事务化，建议按“先备份后回滚”的方式执行。

### 4.1 回滚新增/重建外键
按表执行：
- `ALTER TABLE <table> DROP FOREIGN KEY <fk_name>;`

重点外键名：
- `fk_novel_characters_novel_id_drama_novels`
- `fk_novel_configs_novel_id_drama_novels`
- `fk_novel_contents_novel_id_drama_novels`
- `fk_novel_episodes_novel_id_drama_novels`
- `fk_novel_explosions_novel_id_drama_novels`
- `fk_novel_hook_rhythm_novel_id_drama_novels`
- `fk_novel_key_nodes_novel_id_drama_novels`
- `fk_novel_timelines_novel_id_drama_novels`
- `fk_novel_explosions_timeline_id_novel_timelines`
- `fk_novel_key_nodes_timeline_id_novel_timelines`

### 4.2 若需回滚字段变更
- 如业务要求可移除字段：
  - `ALTER TABLE novel_explosions DROP COLUMN timeline_id;`
  - `ALTER TABLE novel_key_nodes DROP COLUMN timeline_id;`
- 若只回滚外键关系，不建议删列。

### 4.3 回滚到旧引用（不推荐）
- 若必须恢复历史关系，可将 `novel_id` 外键重新指向旧表；但前提是旧表与数据完整恢复。
