# 20260303 结构化世界观系统建表报告

## 1. 前置审计结果

- 数据库：`duanju`
- 执行 `SHOW TABLES LIKE 'drama_novels';`：存在 `drama_novels`
- 执行 `SHOW CREATE TABLE drama_novels;`：`id` 字段为 `int NOT NULL AUTO_INCREMENT`
- 结论：`drama_novels.id` 与本次 10 张表中的 `novel_id INT` 外键类型兼容，可继续执行

## 2. 迁移文件

- 已创建：`apps/api/sql/20260303_create_worldview_struct_tables.sql`
- 迁移特性：
  - 10 张目标表全部使用 `CREATE TABLE IF NOT EXISTS`
  - 所有外键均显式命名
  - 统一 `ENGINE=InnoDB`
  - 统一 `CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  - 所有关联 `drama_novels(id)` 的外键均为 `ON DELETE CASCADE ON UPDATE CASCADE`
  - 按依赖顺序创建：
    - `set_payoff_arch` -> `set_payoff_lines`
    - `set_opponent_matrix` -> `set_opponents`
    - `set_traitor_system` -> `set_traitors` / `set_traitor_stages`

## 3. 执行命令与结果摘要

执行命令：

`mysql -h 127.0.0.1 -P 3306 -u root -p123456 duanju < apps/api/sql/20260303_create_worldview_struct_tables.sql`

执行结果：
- 首次执行：成功（无 SQL 错误）
- 二次重复执行（幂等性验证）：成功（无 SQL 错误）

## 4. 创建的表清单

`SHOW TABLES LIKE 'set_%';` 返回：

1. `set_core`
2. `set_payoff_arch`
3. `set_payoff_lines`
4. `set_opponent_matrix`
5. `set_opponents`
6. `set_power_ladder`
7. `set_traitor_system`
8. `set_traitors`
9. `set_traitor_stages`
10. `set_story_phases`

## 5. 外键清单（表 -> 外键名 -> 引用目标）

- `set_core` -> `fk_set_core_novel` -> `drama_novels(id)`
- `set_payoff_arch` -> `fk_payoff_arch_novel` -> `drama_novels(id)`
- `set_payoff_lines` -> `fk_payoff_lines_novel` -> `drama_novels(id)`
- `set_payoff_lines` -> `fk_payoff_lines_arch` -> `set_payoff_arch(id)`
- `set_opponent_matrix` -> `fk_opponent_matrix_novel` -> `drama_novels(id)`
- `set_opponents` -> `fk_opponents_novel` -> `drama_novels(id)`
- `set_opponents` -> `fk_opponents_matrix` -> `set_opponent_matrix(id)`
- `set_power_ladder` -> `fk_power_ladder_novel` -> `drama_novels(id)`
- `set_traitor_system` -> `fk_traitor_system_novel` -> `drama_novels(id)`
- `set_traitors` -> `fk_traitors_novel` -> `drama_novels(id)`
- `set_traitors` -> `fk_traitors_system` -> `set_traitor_system(id)`
- `set_traitor_stages` -> `fk_traitor_stage_novel` -> `drama_novels(id)`
- `set_traitor_stages` -> `fk_traitor_stage_system` -> `set_traitor_system(id)`
- `set_story_phases` -> `fk_story_phase_novel` -> `drama_novels(id)`

## 6. SHOW CREATE TABLE 验证摘要

已对以下 10 张表逐一执行 `SHOW CREATE TABLE`，结果均符合预期：
- `set_core`
- `set_payoff_arch`
- `set_payoff_lines`
- `set_opponent_matrix`
- `set_opponents`
- `set_power_ladder`
- `set_traitor_system`
- `set_traitors`
- `set_traitor_stages`
- `set_story_phases`

验证点：
- 表全部存在
- 外键指向正确父表（`drama_novels` 或对应 `set_*` 父表）
- 无自动命名外键
- 无执行错误

## 7. 幂等性说明

- 由于采用 `CREATE TABLE IF NOT EXISTS`，脚本可重复执行。
- 二次执行已验证：命令成功且不报错，已有表自动跳过，不影响现有数据。

## 8. 约束遵循确认

- 未修改任何已有表结构（包括 `drama_novels`）
- 未删除数据
- 未生成任何 NestJS Entity
- 未改动任何 API/前端代码
