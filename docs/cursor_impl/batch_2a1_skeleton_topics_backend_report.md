# Batch 2A-1 实现报告：Skeleton Topics Backend CRUD

## 1) 新增/修改文件清单

### 新增
- `apps/api/src/skeleton-topics/skeleton-topics.module.ts`
- `apps/api/src/skeleton-topics/skeleton-topics.controller.ts`
- `apps/api/src/skeleton-topics/skeleton-topics.service.ts`
- `apps/api/src/skeleton-topics/dto/create-skeleton-topic.dto.ts`
- `apps/api/src/skeleton-topics/dto/update-skeleton-topic.dto.ts`

### 修改
- `apps/api/src/app.module.ts`（注册 `SkeletonTopicsModule`）

---

## 2) API 列表与 DTO

所有接口均受 `JwtAuthGuard` 保护。

### API 列表

1. `GET /novels/:novelId/skeleton-topics`
   - 返回指定 `novelId` 下全部 topics
   - 排序：`sort_order ASC, id ASC`

2. `POST /novels/:novelId/skeleton-topics`
   - 创建 topic
   - 唯一键冲突 `(novel_id, topic_key)` 返回 `409 Conflict`

3. `PATCH /skeleton-topics/:id`
   - 按 `id` 更新 topic（部分字段）
   - 若更新后触发唯一键冲突，返回 `409 Conflict`

4. `DELETE /skeleton-topics/:id`
   - 删除 topic（items 由 FK CASCADE 删除）
   - 返回 `{ "ok": true }`

5. `GET /skeleton-topics/:id/items`（推荐项已实现）
   - 返回该 topic 下所有 items
   - 排序：`sort_order ASC, id ASC`

### DTO

#### CreateSkeletonTopicDto
- `topicKey`: string, 1~64, 正则 `^[a-z0-9_]+$`
- `topicName`: string, 1~100
- `topicType`: `'text' | 'list' | 'json'`
- `description?`: string, max 255
- `sortOrder?`: int
- `isEnabled?`: int, 0/1

#### UpdateSkeletonTopicDto
- `topicKey?`: string, 1~64, 正则 `^[a-z0-9_]+$`
- `topicName?`: string, 1~100
- `topicType?`: `'text' | 'list' | 'json'`
- `description?`: string, max 255
- `sortOrder?`: int
- `isEnabled?`: int, 0/1

---

## 3) 核心 SQL（关键片段）

> 说明：全部使用参数化 SQL（`?`），无字符串拼接注入风险。

### Novel 存在性校验

```sql
SELECT id FROM drama_novels WHERE id = ? LIMIT 1
```

### Topic 列表查询

```sql
SELECT
  id,
  novel_id AS novelId,
  topic_key AS topicKey,
  topic_name AS topicName,
  topic_type AS topicType,
  description,
  sort_order AS sortOrder,
  is_enabled AS isEnabled,
  created_at AS createdAt,
  updated_at AS updatedAt
FROM novel_skeleton_topics
WHERE novel_id = ?
ORDER BY sort_order ASC, id ASC
```

### Topic 创建

```sql
INSERT INTO novel_skeleton_topics (
  novel_id, topic_key, topic_name, topic_type, description, sort_order, is_enabled
) VALUES (?, ?, ?, ?, ?, ?, ?)
```

### Topic 更新（动态字段）

```sql
UPDATE novel_skeleton_topics
SET ...dynamic_fields...
WHERE id = ?
```

### Topic 删除

```sql
DELETE FROM novel_skeleton_topics WHERE id = ?
```

### Topic Items 查询

```sql
SELECT
  id,
  novel_id AS novelId,
  topic_id AS topicId,
  item_title AS itemTitle,
  content,
  content_json AS contentJson,
  sort_order AS sortOrder,
  source_ref AS sourceRef,
  created_at AS createdAt,
  updated_at AS updatedAt
FROM novel_skeleton_topic_items
WHERE topic_id = ?
ORDER BY sort_order ASC, id ASC
```

---

## 4) 兼容性说明

- 未修改现有 `GET /pipeline/:novelId/overview` 的字段结构与行为
- 未修改 `PipelineOverviewDto` 字段名
- pipeline 仍从 `novel_skeleton_topics / novel_skeleton_topic_items` 读取

---

## 5) 验证结果

### A. Build 验证

命令：

```bash
pnpm --dir apps/api build
```

结果：通过。

### B. 接口验证（已实测）

登录方式：优先 `s01/123456`，本地实测成功获取 token。

#### 1) List Topics（空数组）

**curl 示例**

```bash
curl -X GET "http://localhost:4000/novels/1/skeleton-topics" \
  -H "Authorization: Bearer <TOKEN>"
```

**样例返回**

```json
[]
```

#### 2) Create Topic

**curl 示例**

```bash
curl -X POST "http://localhost:4000/novels/1/skeleton-topics" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{
    "topicKey": "audit_1772614201",
    "topicName": "Audit Topic",
    "topicType": "text",
    "description": "created by curl-example",
    "sortOrder": 10,
    "isEnabled": 1
  }'
```

**样例返回（实测）**

```json
{
  "id": 1,
  "novelId": 1,
  "topicKey": "audit_1772614201",
  "topicName": "Audit Topic",
  "topicType": "text",
  "description": "created by curl-example",
  "sortOrder": 10,
  "isEnabled": 1,
  "createdAt": "2026-03-04T08:50:02.000Z",
  "updatedAt": "2026-03-04T08:50:02.000Z"
}
```

#### 3) Patch Topic

**curl 示例**

```bash
curl -X PATCH "http://localhost:4000/skeleton-topics/1" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{
    "topicName": "Audit Topic Updated",
    "description": "updated by curl-example"
  }'
```

**样例返回（实测）**

```json
{
  "id": 1,
  "novelId": 1,
  "topicKey": "audit_1772614201",
  "topicName": "Audit Topic Updated",
  "topicType": "text",
  "description": "updated by curl-example",
  "sortOrder": 10,
  "isEnabled": 1,
  "createdAt": "2026-03-04T08:50:02.000Z",
  "updatedAt": "2026-03-04T08:50:02.000Z"
}
```

#### 4) Delete Topic

**curl 示例**

```bash
curl -X DELETE "http://localhost:4000/skeleton-topics/1" \
  -H "Authorization: Bearer <TOKEN>"
```

**样例返回（实测）**

```json
{
  "ok": true
}
```

> 补充验证：`GET /skeleton-topics/:id/items` 也已实测（空数组返回正常）。

---

## 6) 风险点与注意事项

- **唯一键冲突风险**：`(novel_id, topic_key)` 冲突会返回 `409`，前端需要明确提示用户改 key。
- **级联删除风险**：删除 topic 会级联删除其 items（FK CASCADE），前端应做二次确认。
- **部分更新空请求**：`PATCH` 若无任何可更新字段会返回 `400`（当前已显式处理）。
- **数据一致性**：当前采用 DataSource 原生 SQL，后续如引入 Entity 需保证字段映射一致。

---

本次实现符合约束：

- 未改数据库结构（无 migration / ALTER）
- 未调用 AI 接口
- 仅新增/扩展后端 CRUD 接口与 DTO 校验
- 未破坏现有 pipeline overview 结构与行为
