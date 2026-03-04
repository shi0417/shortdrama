# 20260304 项目自定义历史骨架主题建表报告

## 1. 前置审计结果（Stage A）

- 数据库：`duanju`
- 审计命令：
  - `SHOW TABLES LIKE 'drama_novels';`
  - `SHOW CREATE TABLE drama_novels;`
  - `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='duanju' AND TABLE_NAME IN ('novel_skeleton_topics','novel_skeleton_topic_items');`
- 审计结果：
  - `drama_novels` 存在
  - `drama_novels.id` 为 `int NOT NULL AUTO_INCREMENT`（与本次 `novel_id INT` / `topic_id INT` 外键兼容）
  - `novel_skeleton_topics` 不存在（执行前）
  - `novel_skeleton_topic_items` 不存在（执行前）

## 2. 迁移文件（Stage B）

- 已创建迁移文件：`apps/api/sql/20260304_create_novel_skeleton_topics.sql`
- 建表策略：
  - `ENGINE=InnoDB`
  - `DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  - `CREATE TABLE IF NOT EXISTS`（幂等）
  - 仅新增：
    - `novel_skeleton_topics`
    - `novel_skeleton_topic_items`
- 外键设计：
  - `novel_skeleton_topics.novel_id -> drama_novels.id`（CASCADE / CASCADE）
  - `novel_skeleton_topic_items.novel_id -> drama_novels.id`（CASCADE / CASCADE）
  - `novel_skeleton_topic_items.topic_id -> novel_skeleton_topics.id`（CASCADE / CASCADE）

## 3. 执行迁移（Stage C）

- 目标命令（用户指定）：
  - `mysql -h 127.0.0.1 -P 3306 -u root -p123456 duanju < apps/api/sql/20260304_create_novel_skeleton_topics.sql`
- 本机 PowerShell 实际执行命令（等效）：
  - `mysql -h 127.0.0.1 -P 3306 -u root -p123456 duanju --execute="source apps/api/sql/20260304_create_novel_skeleton_topics.sql"`
- 执行结果：
  - 退出码：`0`
  - 无 SQL 错误，迁移执行成功

## 4. 验证结果（Stage D）

### 4.1 表存在性

- `SHOW TABLES LIKE 'novel_skeleton_%';` 返回：
  - `novel_skeleton_topics`
  - `novel_skeleton_topic_items`

### 4.2 SHOW CREATE TABLE 关键片段

`novel_skeleton_topics`（关键索引与外键）：

- `UNIQUE KEY uk_novel_skeleton_topics_novel_topic_key (novel_id, topic_key)`
- `KEY idx_novel_skeleton_topics_novel_sort (novel_id, sort_order)`
- `CONSTRAINT fk_novel_skeleton_topics_novel FOREIGN KEY (novel_id) REFERENCES drama_novels(id) ON DELETE CASCADE ON UPDATE CASCADE`

`novel_skeleton_topic_items`（关键索引与外键）：

- `KEY idx_novel_skeleton_topic_items_topic_sort (topic_id, sort_order)`
- `KEY idx_novel_skeleton_topic_items_novel_topic (novel_id, topic_id)`
- `CONSTRAINT fk_novel_skeleton_topic_items_novel FOREIGN KEY (novel_id) REFERENCES drama_novels(id) ON DELETE CASCADE ON UPDATE CASCADE`
- `CONSTRAINT fk_novel_skeleton_topic_items_topic FOREIGN KEY (topic_id) REFERENCES novel_skeleton_topics(id) ON DELETE CASCADE ON UPDATE CASCADE`

### 4.3 information_schema 外键核验

执行：

`SELECT CONSTRAINT_NAME, TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA='duanju' AND TABLE_NAME IN ('novel_skeleton_topics','novel_skeleton_topic_items') AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME, CONSTRAINT_NAME;`

返回 3 条外键，且指向正确：

1. `fk_novel_skeleton_topic_items_novel`: `novel_skeleton_topic_items.novel_id -> drama_novels.id`
2. `fk_novel_skeleton_topic_items_topic`: `novel_skeleton_topic_items.topic_id -> novel_skeleton_topics.id`
3. `fk_novel_skeleton_topics_novel`: `novel_skeleton_topics.novel_id -> drama_novels.id`

## 5. 边界约束确认（Stage F）

- 本次仅新增 2 张目标表及 1 份报告文件
- 未修改任何现有表结构
- 未改动 NestJS/Next.js 业务代码
- 未插入任何初始化数据
