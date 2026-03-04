# Skeleton Topics 前端缺口只读审计报告

审计时间：2026-03-04  
审计范围：`/projects -> Pipeline -> Step1` 红框区域（“新增骨架分析主题”）  
审计约束：只读；未修改业务代码；未写库；未新增 migration；未提交 commit

---

## A. 前端链路与断点

### 1) 路由与组件链路

- `/projects` 路由文件：`apps/web/src/app/projects/page.tsx`
- Tabs 切换文件：`apps/web/src/components/ProjectDetail.tsx`
- 红框区域文件：`apps/web/src/components/PipelinePanel.tsx`
- API 封装：`apps/web/src/lib/api.ts`
- 类型文件：`apps/web/src/types/index.ts`（无 pipeline/skeleton 专用类型）

链路：

`ProjectsPage` -> `ProjectDetail` -> `activeTab === 'pipeline'` -> `PipelinePanel`

### 2) ProjectDetail 的 tabs 切换位置（关键片段）

文件：`apps/web/src/components/ProjectDetail.tsx`

```tsx
const [activeTab, setActiveTab] = useState<'basic' | 'source' | 'pipeline'>('basic')
...
<button onClick={() => setActiveTab('pipeline')}>Pipeline</button>
...
{activeTab === 'basic' ? (
  ...
) : activeTab === 'source' ? (
  <SourceTextManager novelId={novel.id} />
) : (
  <PipelinePanel novelId={novel.id} novelName={novel.novelsName} />
)}
```

### 3) PipelinePanel 红框区域 JSX（关键段落原样摘录）

文件：`apps/web/src/components/PipelinePanel.tsx`

```tsx
{step1Expanded && (
  <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
    <label>
      <input type="checkbox" checked={stepChecks.timeline} onChange={() => handleStepCheck('timeline')} />{' '}
      时间线分析 - 保存到 `novel_timelines`
    </label>
    <label>
      <input type="checkbox" checked={stepChecks.characters} onChange={() => handleStepCheck('characters')} />{' '}
      主要人物 - 保存到 `novel_characters`
    </label>
    <label>
      <input type="checkbox" checked={stepChecks.keyNodes} onChange={() => handleStepCheck('keyNodes')} /> 关键历史节点
      - 保存到 `novel_key_nodes`
    </label>
    <label>
      <input
        type="checkbox"
        checked={stepChecks.skeletonTopics}
        onChange={() => handleStepCheck('skeletonTopics')}
      />{' '}
      新增骨架分析主题 - 对应 `novel_skeleton_topics / novel_skeleton_topic_items`
    </label>
    <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
      后端只读查询并展示已存在数据（本阶段不写库）
    </div>
    <div style={{ marginTop: '10px' }}>
      <div style={{ fontWeight: 600, marginBottom: '6px' }}>时间线列表</div>
      {renderSimpleTable(timelines)}
    </div>
    <div style={{ marginTop: '10px' }}>
      <div style={{ fontWeight: 600, marginBottom: '6px' }}>人物列表</div>
      {renderSimpleTable(characters)}
    </div>
    <div style={{ marginTop: '10px' }}>
      <div style={{ fontWeight: 600, marginBottom: '6px' }}>关键节点列表</div>
      {renderSimpleTable(keyNodes)}
    </div>
    <div style={{ marginTop: '10px' }}>
      <div style={{ fontWeight: 600, marginBottom: '6px' }}>骨架主题列表</div>
      {renderSimpleTable(topics)}
    </div>
  </div>
)}
```

### 4) stepChecks state 与 checkbox 含义

文件：`apps/web/src/components/PipelinePanel.tsx`

```tsx
const [stepChecks, setStepChecks] = useState({
  timeline: false,
  characters: false,
  keyNodes: false,
  skeletonTopics: false,
  explosions: false,
})
```

结论：

- 红框的“新增骨架分析主题”目前只是 `stepChecks.skeletonTopics` 勾选状态
- `handleStepCheck` 仅切本地布尔值，没有触发新增主题 API

### 5) topics 列表渲染函数逻辑（title/description）

文件：`apps/web/src/components/PipelinePanel.tsx`

```tsx
const extractTitle = (row: Record<string, any>): string => {
  return (
    row.title ||
    row.name ||
    row.topic_name ||
    row.topicName ||
    row.item_title ||
    row.itemTitle ||
    row.level_title ||
    row.stage_title ||
    row.phase_name ||
    row.line_name ||
    row.opponent_name ||
    row.novels_name ||
    `#${row.id ?? 'N/A'}`
  )
}

const extractDescription = (row: Record<string, any>): string => {
  return (
    row.description ||
    row.core_text ||
    row.notes ||
    row.content ||
    row.line_content ||
    row.detailed_desc ||
    row.ability_boundary ||
    row.stage_desc ||
    row.historical_path ||
    row.rewrite_path ||
    row.public_identity ||
    row.real_identity ||
    row.source_ref ||
    ''
  )
}
```

结论：

- 当前是通用展示函数，不是 skeleton topic 专用 UI
- 没有“新增/编辑/删除 topic”按钮与表单

---

## B. 前端 API 现状

文件：`apps/web/src/lib/api.ts`

### 1) pipeline 相关方法清单（实际存在）

- `getPipelineOverview(novelId)` -> `GET /pipeline/:novelId/overview`

### 2) skeleton-topics CRUD 方法是否存在

审计结论：**缺失**（未实现）。

不存在以下方法：

- `getSkeletonTopics`
- `createSkeletonTopic`
- `updateSkeletonTopic`
- `deleteSkeletonTopic`
- `getSkeletonTopicItems`

### 3) `NEXT_PUBLIC_API_BASE_URL` 读取逻辑

```ts
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000'
```

结论：

- 请求统一走 `API_BASE_URL + endpoint`
- 当前 PipelinePanel 只通过 `api.getPipelineOverview` 拉数据

---

## C. 后端接口对齐检查（只读）

### 1) 已实现 skeleton-topics 路由（后端）

文件：`apps/api/src/skeleton-topics/skeleton-topics.controller.ts`

- `GET /novels/:novelId/skeleton-topics`
- `POST /novels/:novelId/skeleton-topics`
- `PATCH /skeleton-topics/:id`
- `DELETE /skeleton-topics/:id`
- `GET /skeleton-topics/:id/items`

### 2) 与前端现有调用习惯对比

- 前端当前只调用：`/pipeline/:novelId/overview`
- 后端新增的 skeleton-topics 路由前缀是：`/novels/:id/...` 与 `/skeleton-topics/:id/...`
- **结论**：后端 CRUD 已有，但前端尚未接入，因此 UI 仍是“只读显示 + 静态 checkbox”

---

## D. 数据库结构核对（只读）

### 1) SHOW CREATE TABLE（原样）

#### `novel_skeleton_topics`

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
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
```

#### `novel_skeleton_topic_items`

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

### 2) 行数

- `novel_skeleton_topics`: `0`
- `novel_skeleton_topic_items`: `0`

### 3) 关键索引与唯一键

- `novel_skeleton_topics`
  - `PRIMARY(id)`
  - `UNIQUE uk_novel_skeleton_topics_novel_topic_key (novel_id, topic_key)`
  - `idx_novel_skeleton_topics_novel_sort (novel_id, sort_order)`
- `novel_skeleton_topic_items`
  - `PRIMARY(id)`
  - `idx_novel_skeleton_topic_items_topic_sort (topic_id, sort_order)`
  - `idx_novel_skeleton_topic_items_novel_topic (novel_id, topic_id)`

---

## E. 结论

### 1) 为什么红框没变化（根因）

1. 红框“新增骨架分析主题”在 `PipelinePanel` 中仅是本地 `checkbox` 状态，没有新增表单和提交动作。  
2. 前端 `api.ts` 未接入 skeleton-topics CRUD 方法，只有 `getPipelineOverview`。  
3. `PipelinePanel` 的数据流是“overview 只读聚合显示”，不是“topics CRUD 交互流”。  

### 2) 要实现“用户新增主题”，前端需补齐

- 表单字段：`topicKey/topicName/topicType/description/sortOrder/isEnabled`
- 表单校验：长度、必填、`topicKey` 格式与冲突处理（409）
- 错误提示：请求失败、重复 key、网络异常
- 列表刷新策略：新增/编辑/删除后更新 topics（局部刷新或重新拉取）
- 交互元素：新增按钮、编辑入口、删除确认、items 展开区

### 3) Batch 2A-2 最小实现路线（建议，不实现）

#### 方案 A（最小改动，内聚在 PipelinePanel）

- 在 `PipelinePanel` Step1 “骨架主题列表”区域内新增 `TopicCrudPanel` 内联段
- 在 `apps/web/src/lib/api.ts` 增加 5 个 skeleton-topics API 方法
- 复用现有 `renderSimpleTable` 样式做列表展示，新增轻量表单

#### 方案 B（结构化拆分，长期维护更优）

- 新增组件：`apps/web/src/components/pipeline/TopicCrudPanel.tsx`
- 新增类型：`apps/web/src/types/pipeline.ts`（Topic/TopicItem DTO）
- 新增 API 文件：`apps/web/src/lib/pipeline-api.ts`（或在现有 `api.ts` 分组）
- `PipelinePanel` 仅保留容器职责，减少复杂度

### 4) 需要改动文件清单（建议）

#### 现有文件（建议改）

- `apps/web/src/components/PipelinePanel.tsx`
- `apps/web/src/lib/api.ts`
- `apps/web/src/types/index.ts`（或迁移到独立 types）

#### 建议新增文件

- `apps/web/src/components/pipeline/TopicCrudPanel.tsx`（方案 B）
- `apps/web/src/components/pipeline/TopicItemsPanel.tsx`（可选）
- `apps/web/src/types/pipeline.ts`（方案 B）

---

附：只读验证命令执行结果

- `pnpm --dir apps/web build` 已通过（无新增构建错误）

---

本次仅输出报告文件，未修改业务代码 / 未写库 / 未新增 migration。
