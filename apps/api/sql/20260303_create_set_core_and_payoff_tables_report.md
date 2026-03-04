# 20260303 创建 set_core / set_payoff_arch / set_payoff_lines 执行报告

## 1. 前置审计

- 已连接数据库：`duanju`
- `SHOW TABLES LIKE 'drama_novels';` 结果：存在 `drama_novels`
- `SHOW CREATE TABLE drama_novels;` 结果：`id` 字段为 `int NOT NULL AUTO_INCREMENT`
- 结论：`drama_novels.id` 与本次新表外键 `INT` 类型兼容

## 2. 迁移文件

- 已创建迁移 SQL：`apps/api/sql/20260303_create_set_core_and_payoff_tables.sql`
- 设计满足：
  - `CREATE TABLE IF NOT EXISTS`（幂等、可重复执行）
  - 外键显式命名（无自动命名）
  - 引擎 `InnoDB`
  - 字符集/排序规则 `utf8mb4_unicode_ci`
  - 外键统一 `ON DELETE CASCADE ON UPDATE CASCADE`
  - 仅创建新表，不修改已有表结构，不删除数据

## 3. 执行结果

执行命令：

`mysql -h 127.0.0.1 -P 3306 -u root -p123456 duanju < apps/api/sql/20260303_create_set_core_and_payoff_tables.sql`

执行状态：成功（无 SQL 错误）

是否已有表被跳过：
- 本次执行后，3 张目标表均存在。
- 由于采用 `IF NOT EXISTS`，重复执行时将自动跳过已存在表，不会报错。

## 4. 验证结果

### 4.1 表存在性

`SHOW TABLES LIKE 'set_%';` 返回：
- `set_core`
- `set_payoff_arch`
- `set_payoff_lines`

### 4.2 SHOW CREATE TABLE 摘要

#### set_core
- 主键：`id`
- 索引：`idx_set_core_novel`、`idx_set_core_active`
- 外键：`fk_set_core_novel` -> `drama_novels(id)`（CASCADE/CASCADE）

#### set_payoff_arch
- 主键：`id`
- 索引：`idx_payoff_arch_novel`、`idx_payoff_arch_active`
- 外键：`fk_payoff_arch_novel` -> `drama_novels(id)`（CASCADE/CASCADE）

#### set_payoff_lines
- 主键：`id`
- 索引：`idx_payoff_lines_arch`、`idx_payoff_lines_novel`、`idx_payoff_lines_ep`
- 外键：
  - `fk_payoff_lines_novel` -> `drama_novels(id)`（CASCADE/CASCADE）
  - `fk_payoff_lines_arch` -> `set_payoff_arch(id)`（CASCADE/CASCADE）

## 5. 结论

- 3 张新表已创建成功。
- 所有外键均建立成功且指向正确目标。
- 迁移脚本可重复执行且不影响已有数据。
