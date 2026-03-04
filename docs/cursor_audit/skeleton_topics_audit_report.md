# skeleton_topics 审计报告（只读）

- 审计时间：2026-03-04
- 目标：为后续“用户可新增骨架主题并落库”功能设计提供现状依据
- 审计约束：只读分析；未执行任何 INSERT/UPDATE/DELETE；未执行 migration/ALTER；未调用 AI 生成接口

---

## 执行步骤记录

### Step 0：审计前 git 状态

执行：

- `git status --short`
- `git diff --stat`

结果（摘要）：

- 当前仓库本身已是脏工作区（存在多处 `M` 和 `??`，并非本次审计引入）
- 本次审计开始前已存在未提交改动

### Step 1：全仓库关键词检索

检索关键词：

- `novel_skeleton_topics`
- `novel_skeleton_topic_items`
- `skeletonTopics`
- `topic_items / topicItems`

命中核心文件（用于本报告分析）：

- `apps/web/src/components/PipelinePanel.tsx`
- `apps/web/src/lib/api.ts`
- `apps/api/src/pipeline/pipeline.service.ts`
- `apps/api/sql/20260304_create_novel_skeleton_topics.sql`（仅结构参考）

### Step 2：阅读命中文件并整理调用链

已阅读前端：

- `apps/web/src/app/projects/page.tsx`
- `apps/web/src/components/ProjectDetail.tsx`
- `apps/web/src/components/PipelinePanel.tsx`
- `apps/web/src/lib/api.ts`
- `apps/web/src/types/index.ts`

已阅读后端：

- `apps/api/src/pipeline/pipeline.controller.ts`
- `apps/api/src/pipeline/pipeline.service.ts`
- `apps/api/src/pipeline/pipeline.module.ts`
- `apps/api/src/app.module.ts`

### Step 3：MySQL 只读查询

已执行（仅 SHOW/SELECT）：

- `SHOW CREATE TABLE novel_skeleton_topics;`
- `SHOW CREATE TABLE novel_skeleton_topic_items;`
- `SHOW INDEX FROM novel_skeleton_topics;`
- `SHOW INDEX FROM novel_skeleton_topic_items;`
- `information_schema.KEY_COLUMN_USAGE` / `REFERENTIAL_CONSTRAINTS` 外键查询
- `information_schema.TABLES` + `COUNT(*)` 表存在性与行数

---

## Part 1：现状代码链路审计（前端）

### 1) Pipeline Tab 与红框区域代码定位

- 页面容器：`apps/web/src/app/projects/page.tsx`
  - 通过 `selectedNovel` 渲染 `ProjectDetail`
- Tab 容器：`apps/web/src/components/ProjectDetail.tsx`
  - `activeTab` 为 `'basic' | 'source' | 'pipeline'`
  - `pipeline` 分支渲染 `PipelinePanel`
- 红框区域主文件：`apps/web/src/components/PipelinePanel.tsx`
  - Step1 中包含文案“新增骨架分析主题 - 对应 novel_skeleton_topics / novel_skeleton_topic_items”
- 接口定义：`apps/web/src/lib/api.ts`
  - `api.getPipelineOverview(novelId)` -> `GET /pipeline/:novelId/overview`
- 类型位置：
  - `apps/web/src/lib/api.ts` 定义了 `PipelineOverviewDto`
  - `apps/web/src/types/index.ts` 当前**没有** pipeline 专用类型

### 2) 红框“新增骨架分析主题”为何是静态/固定

结论：红框区是静态说明 + 本地勾选状态，不是可新增主题表单。

关键代码片段（摘录）：

```text
apps/web/src/components/PipelinePanel.tsx
const [stepChecks, setStepChecks] = useState({
  timeline: false,
  characters: false,
  keyNodes: false,
  skeletonTopics: false,
  explosions: false,
})
...
<input
  type="checkbox"
  checked={stepChecks.skeletonTopics}
  onChange={() => handleStepCheck('skeletonTopics')}
/>
新增骨架分析主题 - 对应 `novel_skeleton_topics / novel_skeleton_topic_items`
```

说明：

- 当前“新增骨架分析主题”仅是 `checkbox`（`stepChecks.skeletonTopics`）
- 没有“新增主题”的输入框、提交按钮、主题 CRUD 调用
- 也没有本地新增列表状态（例如 `newTopicName/newTopicType`）与提交逻辑

### 3) 当前 PipelinePanel 如何展示 skeletonTopics

关键链路：

```text
apps/web/src/components/PipelinePanel.tsx
useEffect(() => {
  const data = await api.getPipelineOverview(novelId)
  setTopics(data.skeletonTopics || [])
}, [novelId])
...
<div>骨架主题列表</div>
{renderSimpleTable(topics)}
```

展示结构：

- 状态字段：`topics`（类型 `Array<Record<string, any> & { items: Record<string, any>[] }>`）
- 展示方式：统一 `renderSimpleTable(rows)`，两列 `title` / `description`
- 标题提取优先级包含：`topic_name/topicName/item_title/...`
- 描述提取优先级包含：`description/content/source_ref/...`

### 4) 当前是否已有“新增主题按钮/输入框”

结论：**没有**。

现有按钮主要是：

- Step3 模块级 `生成(或刷新) / 编辑 / 保存`（仅 `console.log`）
- “插入 novel_characters”
- “生成/完善（本地预览）”

均不对应 skeleton topic 的新增提交。

### 5) 最小改动切入点（仅结论，不改代码）

- 最小切入点：`PipelinePanel` 的 Step1 “骨架主题列表”区域（紧邻 `renderSimpleTable(topics)`）
- 建议位置：在“骨架主题列表”标题下插入独立 `TopicCrudPanel`（新增主题表单 + 列表刷新按钮）
- 样式复用：复用 `PipelinePanel` 当前卡片边框/按钮样式、以及 `renderSimpleTable` 的表格样式

---

## Part 2：现状代码链路审计（后端）

### 1) pipeline overview 接口定位

- `apps/api/src/pipeline/pipeline.controller.ts`
- `apps/api/src/pipeline/pipeline.service.ts`
- `apps/api/src/pipeline/pipeline.module.ts`
- `apps/api/src/app.module.ts`（已注册 `PipelineModule`）

关键代码片段（摘录）：

```text
apps/api/src/pipeline/pipeline.controller.ts
@Controller('pipeline')
@UseGuards(JwtAuthGuard)
@Get(':novelId/overview')
getOverview(@Param('novelId', ParseIntPipe) novelId: number) {
  return this.pipelineService.getOverview(novelId);
}
```

### 2) GET /pipeline/:novelId/overview 实际 DTO 结构

以 `pipeline.service.ts` 实际类型为准：

```text
export interface PipelineOverviewDto {
  timelines: RowRecord[];
  characters: RowRecord[];
  keyNodes: RowRecord[];
  explosions: RowRecord[];
  skeletonTopics: Array<RowRecord & { items: RowRecord[] }>;
  worldview: {
    core: RowRecord[];
    payoffArch: RowRecord[];
    opponents: RowRecord[];
    powerLadder: RowRecord[];
    traitors: RowRecord[];
    storyPhases: RowRecord[];
  };
}
```

### 3) Service 如何查 skeleton topics / items

关键逻辑（摘录）：

```text
const topics = await this.selectByNovel('novel_skeleton_topics', 'st', novelId, { orderBy: 'st.sort_order' });
const topicItems = await this.selectByNovel('novel_skeleton_topic_items', 'si', novelId, { orderBy: 'si.sort_order' });
...
const topicId = Number(item.topic_id ?? item.topicId);
...
const skeletonTopics = topics.map((topic) => ({
  ...topic,
  items: itemsByTopicId.get(Number(topic.id)) ?? [],
}));
```

结论：

- topics 与 items 是两次独立查询（不是 SQL JOIN）
- 通过内存 `Map<topicId, items[]>` 进行聚合
- 返回体中 `skeletonTopics` 已包含 `items` 嵌套

### 4) “表不存在返回空数组”实现方式

关键逻辑（摘录）：

```text
private async hasTable(tableName: string): Promise<boolean> {
  SELECT 1 FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1
}

private async selectByNovel(...) {
  const tableExists = await this.hasTable(tableName);
  if (!tableExists) return [];
  ...
}
```

结论：

- 每个表查询前都先检查 `information_schema.TABLES`
- 不存在则直接返回空数组，避免运行时报错

### 5) skeleton topics 是否已有 TypeORM entity

结论：当前**没有** `novel_skeleton_topics` / `novel_skeleton_topic_items` 对应 entity。

- `apps/api/src/entities` 仅见：`user / drama_novels / drama_source_text / novel_episodes / drama_structure_template / ai_short_drama_theme`
- pipeline 读取依赖 `DataSource + QueryBuilder + raw rows`，非实体仓储模式

---

## Part 3：数据库表结构输出（SHOW CREATE TABLE / INDEX / FK / 行数）

> 说明：以下均为本次只读查询原样输出（SHOW/SELECT）。

### 3.1 SHOW CREATE TABLE novel_skeleton_topics（原样）

```sql
CREATE TABLE `novel_skeleton_topics` (
  `id` int NOT NULL AUTO_INCREMENT,
  `novel_id` int NOT NULL,
  `topic_key` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `topic_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `topic_type` enum('text','list','json') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'text',
  `description` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sort_order` int DEFAULT '0',
  `is_enabled` tinyint DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_novel_skeleton_topics_novel_topic_key` (`novel_id`,`topic_key`),
  KEY `idx_novel_skeleton_topics_novel_sort` (`novel_id`,`sort_order`),
  CONSTRAINT `fk_novel_skeleton_topics_novel` FOREIGN KEY (`novel_id`) REFERENCES `drama_novels` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
```

### 3.2 SHOW CREATE TABLE novel_skeleton_topic_items（原样）

```sql
CREATE TABLE `novel_skeleton_topic_items` (
  `id` int NOT NULL AUTO_INCREMENT,
  `novel_id` int NOT NULL,
  `topic_id` int NOT NULL,
  `item_title` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `content` longtext COLLATE utf8mb4_unicode_ci,
  `content_json` json DEFAULT NULL,
  `sort_order` int DEFAULT '0',
  `source_ref` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_novel_skeleton_topic_items_topic_sort` (`topic_id`,`sort_order`),
  KEY `idx_novel_skeleton_topic_items_novel_topic` (`novel_id`,`topic_id`),
  CONSTRAINT `fk_novel_skeleton_topic_items_novel` FOREIGN KEY (`novel_id`) REFERENCES `drama_novels` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_novel_skeleton_topic_items_topic` FOREIGN KEY (`topic_id`) REFERENCES `novel_skeleton_topics` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
```

### 3.3 索引输出（SHOW INDEX 摘要）

`novel_skeleton_topics`：

- `PRIMARY (id)`
- `uk_novel_skeleton_topics_novel_topic_key (novel_id, topic_key)`（唯一）
- `idx_novel_skeleton_topics_novel_sort (novel_id, sort_order)`

`novel_skeleton_topic_items`：

- `PRIMARY (id)`
- `idx_novel_skeleton_topic_items_topic_sort (topic_id, sort_order)`
- `idx_novel_skeleton_topic_items_novel_topic (novel_id, topic_id)`

`SHOW INDEX` 原始结果（节选原样）：

```text
Table	Non_unique	Key_name	Seq_in_index	Column_name
novel_skeleton_topics	0	PRIMARY	1	id
novel_skeleton_topics	0	uk_novel_skeleton_topics_novel_topic_key	1	novel_id
novel_skeleton_topics	0	uk_novel_skeleton_topics_novel_topic_key	2	topic_key
novel_skeleton_topics	1	idx_novel_skeleton_topics_novel_sort	1	novel_id
novel_skeleton_topics	1	idx_novel_skeleton_topics_novel_sort	2	sort_order
novel_skeleton_topic_items	0	PRIMARY	1	id
novel_skeleton_topic_items	1	idx_novel_skeleton_topic_items_topic_sort	1	topic_id
novel_skeleton_topic_items	1	idx_novel_skeleton_topic_items_topic_sort	2	sort_order
novel_skeleton_topic_items	1	idx_novel_skeleton_topic_items_novel_topic	1	novel_id
novel_skeleton_topic_items	1	idx_novel_skeleton_topic_items_novel_topic	2	topic_id
```

### 3.4 外键输出（information_schema）

`KEY_COLUMN_USAGE` 结果：

- `fk_novel_skeleton_topic_items_novel`：`novel_skeleton_topic_items.novel_id -> drama_novels.id`
- `fk_novel_skeleton_topic_items_topic`：`novel_skeleton_topic_items.topic_id -> novel_skeleton_topics.id`
- `fk_novel_skeleton_topics_novel`：`novel_skeleton_topics.novel_id -> drama_novels.id`

`REFERENTIAL_CONSTRAINTS` 结果：

- 三个外键均为 `UPDATE_RULE=CASCADE`、`DELETE_RULE=CASCADE`

外键查询原始结果（原样）：

```text
TABLE_NAME	COLUMN_NAME	CONSTRAINT_NAME	REFERENCED_TABLE_NAME	REFERENCED_COLUMN_NAME
novel_skeleton_topic_items	novel_id	fk_novel_skeleton_topic_items_novel	drama_novels	id
novel_skeleton_topic_items	topic_id	fk_novel_skeleton_topic_items_topic	novel_skeleton_topics	id
novel_skeleton_topics	novel_id	fk_novel_skeleton_topics_novel	drama_novels	id

CONSTRAINT_NAME	TABLE_NAME	REFERENCED_TABLE_NAME	UPDATE_RULE	DELETE_RULE
fk_novel_skeleton_topic_items_novel	novel_skeleton_topic_items	drama_novels	CASCADE	CASCADE
fk_novel_skeleton_topic_items_topic	novel_skeleton_topic_items	novel_skeleton_topics	CASCADE	CASCADE
fk_novel_skeleton_topics_novel	novel_skeleton_topics	drama_novels	CASCADE	CASCADE
```

### 3.5 表存在性与行数

存在性查询结果：

- `novel_skeleton_topics`：存在
- `novel_skeleton_topic_items`：存在

当前行数：

- `novel_skeleton_topics`：`0`
- `novel_skeleton_topic_items`：`0`

原始结果（原样）：

```text
TABLE_NAME
novel_skeleton_topic_items
novel_skeleton_topics

table_name	row_count
novel_skeleton_topics	0
novel_skeleton_topic_items	0
```

---

## Part 4：功能差距结论（只写差距，不做实现）

目标能力：

> 用户点击新增主题 -> 写入 `novel_skeleton_topics` -> 针对该主题生成抽取结果 -> 写入 `novel_skeleton_topic_items` -> 可无限新增

### 前端差距

- 缺少 skeleton topic 的新增 UI（topic_key/topic_name/topic_type/description/sort_order/is_enabled）
- 缺少新增主题的状态管理（表单态、提交态、错误态）
- 缺少输入校验（topic_key 唯一性提示、必填字段校验、长度限制）
- 缺少 skeleton topic items 展开查看与刷新机制（当前仅平面 `renderSimpleTable(topics)`）
- 缺少新增成功后的局部刷新策略（当前仅 `useEffect` 初次拉 overview）

### 后端差距

- 缺少 skeleton topics 的写接口（`POST /pipeline/:novelId/topics` 或等价路由）
- 缺少 topic 级更新/删除接口（`PATCH/DELETE`）
- 缺少 topic items 的写接口（新增批量 items、更新 items、删除 items）
- 缺少明确 DTO 与字段校验层（目前 overview 返回 `RowRecord`，未形成稳定 schema）
- 缺少“按 topic 查询 items”的专用 GET（当前依赖 overview 聚合）

### 数据库差距（字段够不够）

`novel_skeleton_topics` 字段现状：

- `topic_key/topic_name/topic_type/description/sort_order/is_enabled` 已具备，支持主题定义

`novel_skeleton_topic_items` 字段现状：

- `item_title/content/content_json/sort_order/source_ref` 已具备，支持主题下结果条目

潜在注意点（方向建议）：

- `topic_key` 唯一约束已是 `(novel_id, topic_key)`，可直接作为前端去重依据
- 若未来需要“软删除”语义，目前 items 表缺少 `is_deleted` 字段（仅方向建议，不涉及改表）
- 当前 rows 为 0，功能联调时需先有写接口或种子数据才能在 UI 看到真实内容

### 最小改动切入点（方案方向）

- 前端：`PipelinePanel` 的 Step1 “骨架主题列表”区域，新增 `TopicCrudPanel`（新增 + 刷新 + 基础列表）
- 后端：复用 `pipeline` 模块，先补 topics 写接口与 items 写接口，再由 overview 统一回读
- 数据层：先复用现有表字段，不改结构，优先完成端到端闭环

---

## Step 5：审计后 git 检查

执行：

- `git status --short`
- `git diff --stat`

结果说明：

- 仓库在审计前即为脏工作区；本次审计过程中未修改业务代码
- 本次仅产出审计报告文件：`docs/cursor_audit/skeleton_topics_audit_report.md`
- 因需交付报告文件，严格意义 `git diff` 非 0（文档新增导致）

---

本次为只读审计：未修改业务代码、未写库、未执行 migration/DDL、未调用 AI 生成接口。
