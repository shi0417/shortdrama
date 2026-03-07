# AI 模型目录建表与导入报告

## 1. 新增文件清单

- `apps/api/sql/20260306_create_ai_model_catalog.sql`
- `scripts/seed_ai_model_catalog.py`
- `docs/cursor_impl/create_ai_model_catalog_and_seed_report.md`

## 2. 建表 SQL 摘要

- 新建表：`ai_model_catalog`
- 幂等：`CREATE TABLE IF NOT EXISTS`
- 主键：`id BIGINT UNSIGNED AUTO_INCREMENT`
- 唯一键：`uk_ai_model_catalog_model_key (model_key)`
- 核心字段：
  - 标识：`model_key`, `display_name`
  - 解析字段：`provider`, `family`, `model_group`, `modality`, `version_label`
  - 扩展字段：`capability_tags`(JSON), `raw_meta`(JSON), `notes`
  - 状态字段：`is_active`, `is_deprecated`, `sort_order`
  - 时间字段：`created_at`, `updated_at`

## 3. Seed 脚本逻辑摘要

脚本：`scripts/seed_ai_model_catalog.py`

- 将给定整段模型列表内嵌为 multiline string
- 按逗号切分、去空格、按 `model_key` 去重（保持首次出现顺序）
- 自动推断并填充：
  - `provider`
  - `family`
  - `model_group`
  - `modality`
  - `version_label`
  - `capability_tags`
- 写入 `raw_meta`：
  - `original_model_key`
  - `parser_version = "v1"`
- 通过 `ON DUPLICATE KEY UPDATE` 执行幂等 upsert
- 实际连接 MySQL 并写入（本次使用驱动：`pymysql`）

## 4. 执行过程（实际执行）

### 4.1 执行建表

```bash
mysql -h 127.0.0.1 -P 3306 -u root -p123456 duanju --execute="source apps/api/sql/20260306_create_ai_model_catalog.sql"
```

结果：执行成功。

### 4.2 执行导入（第 1 次）

```bash
python scripts/seed_ai_model_catalog.py
```

输出摘要：
- Parsed models: `525`
- Rows in ai_model_catalog: `525`

### 4.3 幂等复跑（第 2 次）

再次执行同一脚本：

```bash
python scripts/seed_ai_model_catalog.py
```

输出摘要：
- Parsed models: `525`
- Rows in ai_model_catalog: `525`

结论：重复执行未产生重复记录，满足幂等要求。

## 5. 导入总数

```sql
SELECT COUNT(*) FROM ai_model_catalog;
```

结果：`525`

## 6. provider 分布统计（前 10）

```sql
SELECT provider, COUNT(*) AS cnt
FROM ai_model_catalog
GROUP BY provider
ORDER BY cnt DESC
LIMIT 10;
```

结果：

| provider | cnt |
|---|---:|
| openai | 144 |
| qwen | 99 |
| google | 80 |
| anthropic | 69 |
| other | 42 |
| xai | 22 |
| deepseek | 19 |
| midjourney | 18 |
| zhipu | 12 |
| suno | 9 |

## 7. 6 个抽样模型入库结果

查询：

```sql
SELECT model_key, provider, family, model_group, modality, version_label, is_active
FROM ai_model_catalog
WHERE model_key IN (
  'gpt-4o',
  'claude-4-sonnet',
  'gemini-2.5-pro',
  'mj_imagine',
  'whisper-1',
  'qwen-plus'
)
ORDER BY model_key;
```

结果：

| model_key | provider | family | model_group | modality | version_label | is_active |
|---|---|---|---|---|---|---:|
| claude-4-sonnet | anthropic | claude | llm | text | NULL | 1 |
| gemini-2.5-pro | google | gemini | llm | text | NULL | 1 |
| gpt-4o | openai | gpt | llm | text | NULL | 1 |
| mj_imagine | midjourney | mj | image | image | NULL | 1 |
| qwen-plus | qwen | qwen | llm | text | NULL | 1 |
| whisper-1 | openai | whisper | audio | audio | NULL | 1 |

## 8. 重复与空值检查

### 8.1 重复 model_key

```sql
SELECT model_key, COUNT(*) c
FROM ai_model_catalog
GROUP BY model_key
HAVING c > 1;
```

结果：无返回行（重复数 = `0`）。

### 8.2 空 model_key

```sql
SELECT COUNT(*) AS empty_model_key_count
FROM ai_model_catalog
WHERE model_key IS NULL OR TRIM(model_key)='';
```

结果：`0`

## 9. 未解析到 provider/family 的模型（前 30）

筛选条件：
- `provider='other'` 或 `family IS NULL/''/'other'`

前 30 条：

1. chatgpt-4o-latest
2. codex-mini
3. cs-gpt-4.1
4. cs-gpt-4.1-mini
5. cs-gpt-4.1-nano
6. cs-gpt-4o
7. cs-gpt-5-all
8. cs-gpt-5-thinking-all
9. cs-o3
10. cs-o3-all
11. cs-o3-pro
12. cs-o3-pro-all
13. cs-qwq-32b
14. doubao-seedream-4-5-251128
15. doubao-seedream-5-0
16. jimeng-seedream-4-5
17. KAT-Coder-Air-V1
18. KAT-Coder-Exp-72B-1010
19. KAT-Coder-Pro-V1
20. MiniMax-M2
21. MiniMax-M2.1
22. MiniMax-M2.1-Lightning
23. MiniMax-M2.5
24. MiniMax-M2.5-Search
25. nano-banana
26. nano-banana-2
27. net-gpt-3.5-turbo
28. net-gpt-4o
29. net-gpt-4o-mini
30. net-o1-mini

## 10. 幂等性结论

- 表创建：`CREATE TABLE IF NOT EXISTS`，幂等
- 导入：基于 `model_key` 唯一键 + `ON DUPLICATE KEY UPDATE`，幂等
- 复跑验证通过：总数保持 `525`，无重复 `model_key`
