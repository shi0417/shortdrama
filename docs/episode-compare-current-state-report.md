# Episode Compare Current State Report

> 调研时间：2026-03-04  
> 调研目标：为新增 "Episode Compare" 功能页做现状摸底  
> 调研原则：只读分析，不修改代码

---

## 1. Executive Summary

1. **项目详情页 Tab 实现**：在 `ProjectDetail.tsx` 中使用 `useState<'basic' | 'source' | 'pipeline'>` 控制，通过条件渲染切换内容。新增 Tab 只需修改该文件。

2. **通用资源框架已成熟**：存在完整的 `PIPELINE_RESOURCE_CONFIG` 配置系统，支持 15+ 种资源（timelines、characters、key-nodes 等），提供统一的列表/编辑/删除能力。

3. **novel_timelines 已接入框架**：使用 `PipelineDataSection`（区块展示）和 `PipelineResourceManagerPage`（整页管理），支持字段显示控制、行编辑、localStorage 持久化。

4. **三张目标表现状**：
   - `novel_episodes`：有完整 entity/service/controller/dto，但**未接入通用资源框架**
   - `drama_structure_template`：有 entity，但**未接入通用资源框架**，使用 `novels_id` + `chapter_id`
   - `novel_hook_rhythm`：**表可能不存在**，仅在 `pipeline-episode-script.service.ts` 中有动态检测和写入逻辑

5. **字段显示控制机制**：基于 `localStorage`，key 格式为 `pipeline-columns:{scope}:{resource}:novel:{novelId}`，支持 section/page 两种作用域。

6. **唯一约束确认**：
   - `drama_structure_template`：有 `UNIQUE (novels_id, chapter_id)`（见 SQL migration）
   - `novel_episodes`：**未找到唯一约束定义**（需确认）

7. **推荐实现路径**：复用 `PipelineResourceManagerPage` 框架，新增独立路由 `/projects/[novelId]/pipeline/episode-compare`，按集数对齐三表数据。

8. **主要技术风险**：`novel_hook_rhythm` 表可能不存在，需要先确认表结构或创建 migration。

---

## 2. Project Detail Tabs Current Structure

### 2.1 文件路径

- **页面入口**：`apps/web/src/app/projects/page.tsx`
  - 组件：`ProjectsPage`
  - 渲染：`<ProjectDetail novel={selectedNovel} ... />`

- **Tab 实现**：`apps/web/src/components/ProjectDetail.tsx`
  - 组件：`ProjectDetail`
  - Props：`{ novel: Novel, themes: Theme[], onUpdate: () => void, onDelete: () => void }`

### 2.2 Tab 状态切换实现

```typescript
// apps/web/src/components/ProjectDetail.tsx:17
const [activeTab, setActiveTab] = useState<'basic' | 'source' | 'pipeline'>('basic')
```

Tab 按钮通过 `onClick={() => setActiveTab('xxx')}` 切换状态。

### 2.3 Tab 内容区渲染方式

**条件渲染**（非路由切换）：

```typescript
// apps/web/src/components/ProjectDetail.tsx:112-328
{activeTab === 'basic' ? (
  // Basic Info 表单
) : activeTab === 'source' ? (
  <SourceTextManager novelId={novel.id} />
) : (
  <PipelinePanel novelId={novel.id} novelName={novel.novelsName} totalChapters={novel.totalChapters} />
)}
```

### 2.4 组件层级关系

```
ProjectsPage (app/projects/page.tsx)
└─ ProjectDetail (components/ProjectDetail.tsx)
   ├─ Tab Header（3 个 button）
   └─ Tab Content（条件渲染）
      ├─ Basic Info：内联表单
      ├─ Reference Materials：<SourceTextManager />
      └─ Pipeline：<PipelinePanel />
```

### 2.5 新增 Tab 需要修改的文件

**只需修改 1 个文件**：`apps/web/src/components/ProjectDetail.tsx`

修改点：
1. `activeTab` 类型扩展：`'basic' | 'source' | 'pipeline' | 'episode-compare'`
2. 新增 Tab 按钮（第 70-110 行区域）
3. 新增条件分支（第 112-328 行区域）

---

## 3. novel_timelines Current Implementation

### 3.1 前端链路

#### 3.1.1 区块展示（PipelinePanel 内）

**组件**：`apps/web/src/components/pipeline/PipelineDataSection.tsx`

**使用位置**：`apps/web/src/components/PipelinePanel.tsx:1766-1771`

```typescript
<PipelineDataSection
  novelId={novelId}
  resource="timelines"
  rows={timelines}
  onRefresh={loadOverview}
/>
```

**能力**：
- 标题可点击跳转整页管理
- 右侧"字段显示"入口（多选 checkbox）
- 点击行打开编辑弹窗
- 字段显示配置存 localStorage（key: `pipeline-columns:section:timelines:novel:{novelId}`）

#### 3.1.2 整页管理

**路由**：`/projects/[novelId]/pipeline/timelines`

**页面文件**：`apps/web/src/app/projects/[novelId]/pipeline/[resource]/page.tsx`

**组件**：`apps/web/src/components/pipeline/PipelineResourceManagerPage.tsx`

**能力**：
- 列表展示（`PipelineDataTable`）
- 新增按钮
- 字段显示设置（localStorage key: `pipeline-columns:page:timelines:novel:{novelId}`）
- 点击行编辑（`PipelineRowEditDialog`）
- 删除功能

#### 3.1.3 通用组件

| 组件 | 路径 | 职责 |
|------|------|------|
| `PipelineDataSection` | `apps/web/src/components/pipeline/PipelineDataSection.tsx` | 区块展示（标题 + 字段显示 + 表格 + 编辑弹窗） |
| `PipelineDataTable` | `apps/web/src/components/pipeline/PipelineDataTable.tsx` | 通用表格（根据 columns 动态渲染） |
| `PipelineRowEditDialog` | `apps/web/src/components/pipeline/PipelineRowEditDialog.tsx` | 通用编辑弹窗（根据 config.fields 动态渲染表单） |
| `PipelineResourceManagerPage` | `apps/web/src/components/pipeline/PipelineResourceManagerPage.tsx` | 整页管理（列表 + 新增 + 字段显示 + 编辑/删除） |

#### 3.1.4 类型定义

**资源配置**：`apps/web/src/types/pipeline-resource.ts`

```typescript
export const PIPELINE_RESOURCE_CONFIG: Record<PipelineResourceName, PipelineResourceConfig> = {
  timelines: {
    resource: 'timelines',
    title: '时间线',
    routeSegment: 'timelines',
    defaultSectionColumns: ['time_node', 'event'],
    defaultPageColumns: ['id', 'time_node', 'event', 'sort_order', 'created_at'],
    fields: [
      { key: 'id', label: 'ID', type: 'number', readonly: true },
      { key: 'time_node', label: '时间节点', type: 'text', editable: true },
      // ...
    ],
  },
}
```

#### 3.1.5 API 调用

**API Client**：`apps/web/src/lib/pipeline-resource-api.ts`

```typescript
pipelineResourceApi.list(novelId, 'timelines')
pipelineResourceApi.getOne('timelines', id)
pipelineResourceApi.create(novelId, 'timelines', data)
pipelineResourceApi.update('timelines', id, data)
pipelineResourceApi.remove('timelines', id)
```

### 3.2 后端链路

#### 3.2.1 Controller

**文件**：`apps/api/src/pipeline/pipeline-resource.controller.ts`

**路由**：
- `GET /novels/:novelId/pipeline-resources/timelines` → `listResourceByNovel()`
- `GET /pipeline-resources/timelines/:id` → `getResourceOne()`
- `POST /novels/:novelId/pipeline-resources/timelines` → `createResource()`
- `PATCH /pipeline-resources/timelines/:id` → `updateResource()`
- `DELETE /pipeline-resources/timelines/:id` → `removeResource()`

#### 3.2.2 Service

**文件**：`apps/api/src/pipeline/pipeline-resource.service.ts`

**资源配置**：`RESOURCE_CONFIG.timelines`

```typescript
timelines: {
  tableName: 'novel_timelines',
  selectableFields: ['id', 'novel_id', 'time_node', 'event', 'sort_order', 'revision_notes_json', 'created_at'],
  editableFields: ['time_node', 'event', 'sort_order'],
  numericFields: ['sort_order'],
  orderBy: 'sort_order ASC, id ASC',
}
```

#### 3.2.3 Entity

**未找到独立 entity 文件**。通用资源框架直接使用 SQL 查询，不依赖 TypeORM entity。

#### 3.2.4 DTO

**文件**：`apps/api/src/pipeline/dto/pipeline-resource.dto.ts`

```typescript
export type PipelineResourceName = 'timelines' | 'characters' | ...
export class PipelineResourceListQueryDto { topicId?: number }
```

### 3.3 复用点总结

| 能力 | 是否可复用 | 说明 |
|------|-----------|------|
| 字段显示控制 | ✅ | `PipelineDataSection` / `PipelineResourceManagerPage` 已实现 |
| 行编辑弹窗 | ✅ | `PipelineRowEditDialog` 通用组件 |
| 表格展示 | ✅ | `PipelineDataTable` 通用组件 |
| localStorage 持久化 | ✅ | `getPipelineColumnStorageKey()` 工具函数 |
| 整页管理路由 | ✅ | `/projects/[novelId]/pipeline/[resource]` 动态路由 |
| 后端 CRUD API | ✅ | `PipelineResourceController` / `PipelineResourceService` |

---

## 4. Pipeline Generic Resource Framework

### 4.1 资源配置总表

**文件**：`apps/web/src/types/pipeline-resource.ts`

**类型**：`PIPELINE_RESOURCE_CONFIG: Record<PipelineResourceName, PipelineResourceConfig>`

**已接入资源**（15 种）：
- `timelines`（时间线）
- `characters`（人物）
- `key-nodes`（关键节点）
- `explosions`（爆点）
- `skeleton-topics`（骨架主题）
- `skeleton-topic-items`（骨架主题项）
- `payoff-arch`（爽点架构）
- `payoff-lines`（爽点线）
- `opponent-matrix`（对手矩阵）
- `opponents`（对手明细）
- `power-ladder`（权力阶梯）
- `traitor-system`（内鬼系统）
- `traitors`（内鬼角色）
- `traitor-stages`（内鬼阶段）
- `story-phases`（故事阶段）

### 4.2 资源配置结构

每个资源配置包含：

```typescript
interface PipelineResourceConfig {
  resource: PipelineResourceName        // 资源名
  title: string                          // 中文标题
  currentPageTitle: string               // 区块标题
  pageTitle: string                      // 整页标题
  routeSegment: string                   // URL 段（如 'timelines'）
  defaultSectionColumns: string[]        // 区块默认显示字段
  defaultPageColumns: string[]           // 整页默认显示字段
  fields: PipelineFieldConfig[]          // 字段定义（label/type/editable/readonly）
}
```

### 4.3 后端资源配置

**文件**：`apps/api/src/pipeline/pipeline-resource.service.ts`

**类型**：`RESOURCE_CONFIG: Record<PipelineResourceName, ResourceConfig>`

```typescript
interface ResourceConfig {
  tableName: string                      // 数据库表名
  selectableFields: string[]             // 可查询字段
  editableFields: string[]                // 可编辑字段
  numericFields?: string[]                // 数值字段（用于类型转换）
  jsonFields?: string[]                  // JSON 字段
  booleanFields?: string[]                // 布尔字段
  orderBy: string                         // 排序 SQL
}
```

### 4.4 通用组件

| 组件 | 路径 | 职责 |
|------|------|------|
| `PipelineDataSection` | `apps/web/src/components/pipeline/PipelineDataSection.tsx` | 区块展示（标题 + 字段显示 + 表格 + 编辑弹窗） |
| `PipelineDataTable` | `apps/web/src/components/pipeline/PipelineDataTable.tsx` | 通用表格（根据 columns 动态渲染单元格） |
| `PipelineRowEditDialog` | `apps/web/src/components/pipeline/PipelineRowEditDialog.tsx` | 通用编辑弹窗（根据 config.fields 动态渲染表单字段） |
| `PipelineResourceManagerPage` | `apps/web/src/components/pipeline/PipelineResourceManagerPage.tsx` | 整页管理页面 |

### 4.5 字段显示控制实现

**存储位置**：`localStorage`

**Key 格式**：`pipeline-columns:{scope}:{resource}:novel:{novelId}`

- `scope`：`'section'`（区块）或 `'page'`（整页）
- `resource`：资源名（如 `'timelines'`）
- `novelId`：项目 ID

**工具函数**：`getPipelineColumnStorageKey(resource, novelId, scope)`

**读取逻辑**：
```typescript
// PipelineDataSection.tsx:52-54
useEffect(() => {
  setVisibleColumnKeys(safeReadColumns(storageKey, config.defaultSectionColumns))
}, [storageKey, config.defaultSectionColumns])
```

### 4.6 新增资源最小接入步骤

1. **前端类型扩展**：在 `apps/web/src/types/pipeline-resource.ts` 的 `PipelineResourceName` 类型中新增资源名
2. **前端配置**：在 `PIPELINE_RESOURCE_CONFIG` 中新增资源配置（fields、defaultColumns 等）
3. **后端类型扩展**：在 `apps/api/src/pipeline/dto/pipeline-resource.dto.ts` 的 `allowedPipelineResources` 数组中新增资源名
4. **后端配置**：在 `apps/api/src/pipeline/pipeline-resource.service.ts` 的 `RESOURCE_CONFIG` 中新增资源配置（tableName、selectableFields、editableFields 等）
5. **前端使用**：在 `PipelinePanel.tsx` 中使用 `<PipelineDataSection resource="xxx" />` 或在路由中使用 `<PipelineResourceManagerPage resource="xxx" />`

### 4.7 框架能力评估

| 能力 | 是否支持 | 说明 |
|------|---------|------|
| 同一页面显示多个资源表 | ✅ | `PipelinePanel.tsx` 中已有多处 `<PipelineDataSection resource="xxx" />` |
| 每个资源单独管理可见字段 | ✅ | localStorage key 包含 resource，每个资源独立配置 |
| 字段显示持久化 | ✅ | localStorage（前端） |
| 字段显示服务端持久化 | ❌ | 未找到 server-side 持久化机制 |
| URL 参数控制字段显示 | ❌ | 未找到 URL 参数机制 |

---

## 5. Target Tables Current State

### 5.1 novel_episodes

#### 5.1.1 Entity

**文件**：`apps/api/src/entities/episode.entity.ts`

**实体类**：`Episode`

**关键字段**：
- `novelId`（`novel_id`，int）
- `episodeNumber`（`episode_number`，int）
- `episodeTitle`（`episode_title`，varchar(255)）
- `outlineContent`（`outline_content`，longtext）
- `fullContent`（`full_content`，longtext）
- `structureTemplateId`（`structure_template_id`，int，nullable，FK → `drama_structure_template.id`）

**关系**：
- `@ManyToOne(() => DramaNovel)` → `novel_id`
- `@ManyToOne(() => DramaStructureTemplate)` → `structure_template_id`

#### 5.1.2 DTO

**查询 DTO**：`apps/api/src/episodes/dto/query-episodes.dto.ts`
- `QueryEpisodesDto`：`{ novelId?: number }`

**响应 DTO**：`apps/api/src/episodes/dto/episode-response.dto.ts`
- `EpisodeResponseDto`：包含所有字段 + `structureTemplate?: DramaStructureTemplateDto`

#### 5.1.3 Service

**文件**：`apps/api/src/episodes/episodes.service.ts`

**类**：`EpisodesService`

**方法**：
- `findAll(query: QueryEpisodesDto): Promise<EpisodeResponseDto[]>`
- `findOne(id: number): Promise<EpisodeResponseDto>`

**查询逻辑**：
- 支持按 `novelId` 过滤
- 自动关联 `structureTemplate`（`relations: ['structureTemplate']`）
- 排序：`order: { episodeNumber: 'ASC' }`

#### 5.1.4 Controller

**文件**：`apps/api/src/episodes/episodes.controller.ts`

**路由**：
- `GET /episodes?novelId=1` → `findAll()`
- `GET /episodes/:id` → `findOne()`

**认证**：`@UseGuards(JwtAuthGuard)`

#### 5.1.5 SQL Migration

**未找到独立的 `novel_episodes` 建表 migration**。

相关 migration：
- `apps/api/sql/20260303_add_episode_outline_and_structure_fk.sql`：添加 `outline_content`、`history_outline`、`rewrite_diff`、`structure_template_id` 字段

#### 5.1.6 前端类型

**文件**：`apps/web/src/lib/api.ts`

**类型**：`EpisodeResponseDto`（与后端 DTO 一致）

#### 5.1.7 前端 API 调用

**文件**：`apps/web/src/lib/api.ts`

```typescript
getEpisodes: (novelId: number) => apiClient(`/episodes?novelId=${novelId}`)
```

#### 5.1.8 是否已有列表页

**❌ 未找到独立的列表页**。

仅在 `PipelinePanel.tsx` 中通过 `loadOverview()` 间接获取 episodes 数据（用于显示概览，非完整列表页）。

#### 5.1.9 是否已有编辑/删除能力

**❌ 未找到编辑/删除 API**。

`EpisodesController` 只有 `GET` 方法，无 `POST`/`PATCH`/`DELETE`。

#### 5.1.10 是否已接入 pipeline 资源系统

**❌ 未接入**。

`novel_episodes` 不在 `allowedPipelineResources` 数组中，也不在 `PIPELINE_RESOURCE_CONFIG` 中。

#### 5.1.11 字段确认

- **外键字段**：`novel_id`（不是 `novels_id`）
- **集号字段**：`episode_number`
- **唯一约束**：**未找到**。SQL migration 中未发现 `UNIQUE (novel_id, episode_number)` 定义。

---

### 5.2 drama_structure_template

#### 5.2.1 Entity

**文件**：`apps/api/src/entities/drama-structure-template.entity.ts`

**实体类**：`DramaStructureTemplate`

**关键字段**：
- `novelsId`（`novels_id`，int）⚠️ **注意是 `novels_id` 不是 `novel_id`**
- `chapterId`（`chapter_id`，int）
- `structureName`（`structure_name`，varchar(100)）
- `themeType`（`theme_type`，varchar(50)）
- `powerLevel`（`power_level`，int）
- `isPowerUpChapter`（`is_power_up_chapter`，tinyint）
- 多个结构字段（`identityGap`、`pressureSource`、`firstReverse` 等）

**关系**：
- `@ManyToOne(() => DramaNovel)` → `novels_id`
- `@OneToMany(() => Episode)` → `episodes`

#### 5.2.2 DTO

**未找到独立的 DTO 文件**。

仅在 `EpisodeResponseDto` 中作为嵌套对象：`structureTemplate?: DramaStructureTemplateDto`

#### 5.2.3 Service

**未找到独立的 Service**。

仅在 `EpisodesService` 中通过关联查询获取。

#### 5.2.4 Controller

**未找到独立的 Controller**。

#### 5.2.5 SQL Migration

**文件**：`apps/api/sql/20260303_add_episode_outline_and_structure_fk.sql`

**唯一约束**：
```sql
ALTER TABLE drama_structure_template
  ADD CONSTRAINT uk_template_novel_chapter UNIQUE (novels_id, chapter_id);
```

#### 5.2.6 前端类型

**文件**：`apps/web/src/lib/api.ts`

**类型**：`DramaStructureTemplateDto`（嵌套在 `EpisodeResponseDto` 中）

#### 5.2.7 前端 API 调用

**未找到独立的 API 调用**。

仅通过 `getEpisodes()` 获取时自动关联 `structureTemplate`。

#### 5.2.8 是否已有列表页

**❌ 未找到独立的列表页**。

#### 5.2.9 是否已有编辑/删除能力

**❌ 未找到编辑/删除 API**。

#### 5.2.10 是否已接入 pipeline 资源系统

**❌ 未接入**。

`drama_structure_template` 不在 `allowedPipelineResources` 数组中。

#### 5.2.11 字段确认

- **外键字段**：`novels_id`（不是 `novel_id`）⚠️
- **集号字段**：`chapter_id`（不是 `episode_number`）
- **唯一约束**：✅ `UNIQUE (novels_id, chapter_id)`（见 SQL migration）

---

### 5.3 novel_hook_rhythm

#### 5.3.1 Entity

**❌ 未找到 entity 文件**。

#### 5.3.2 DTO

**❌ 未找到独立的 DTO**。

仅在 `pipeline-episode-script.service.ts` 的类型定义中有 `hookRhythm` 结构：

```typescript
hookRhythm: {
  episodeNumber: number;
  emotionLevel: number;
  hookType: string;
  description: string;
  cliffhanger: string;
}
```

#### 5.3.3 Service

**未找到独立的 Service**。

仅在 `PipelineEpisodeScriptService` 中有相关逻辑：
- `detectHookRhythmTableIfExists()`：动态检测表是否存在
- `insertEpisodePackage()`：如果表存在则写入数据

#### 5.3.4 Controller

**❌ 未找到独立的 Controller**。

#### 5.3.5 SQL Migration

**❌ 未找到建表 migration**。

#### 5.3.6 前端类型

**❌ 未找到前端类型定义**。

#### 5.3.7 前端 API 调用

**❌ 未找到独立的 API 调用**。

#### 5.3.8 是否已有列表页

**❌ 未找到列表页**。

#### 5.3.9 是否已有编辑/删除能力

**❌ 未找到编辑/删除 API**。

#### 5.3.10 是否已接入 pipeline 资源系统

**❌ 未接入**。

#### 5.3.11 表存在性检测逻辑

**文件**：`apps/api/src/pipeline/pipeline-episode-script.service.ts:2578-2597`

```typescript
private async detectHookRhythmTableIfExists(): Promise<{ exists: boolean; columns: Set<string> }> {
  // 查询 information_schema.tables
  // 如果存在，再查询 information_schema.columns
  // 返回 { exists: true/false, columns: Set<string> }
}
```

**写入逻辑**：`apps/api/src/pipeline/pipeline-episode-script.service.ts:2543-2576`

- 如果表不存在 → 跳过写入，记录 warning
- 如果表存在但缺少 `novel_id` 或 `episode_number` → 跳过写入，记录 warning
- 如果表存在且字段兼容 → 写入数据

#### 5.3.12 字段确认

**基于代码推断**（表可能不存在）：
- **外键字段**：`novel_id`（代码中检测 `novel_id` 字段）
- **集号字段**：`episode_number`（代码中检测 `episode_number` 字段）
- **其他字段**：`emotion_level`、`hook_type`、`description`、`cliffhanger`、`sort_order`（代码中写入时使用）

**唯一约束**：**未找到**（表可能不存在）

---

## 6. Feasibility Assessment for Episode Compare

### 6.1 推荐实现路径

#### 方案 A：新增独立 Tab（推荐）

**位置**：`apps/web/src/components/ProjectDetail.tsx`

**优点**：
- 与现有 Tab 结构一致
- 用户路径清晰（项目详情 → Episode Compare）
- 无需新增路由层级

**缺点**：
- Tab 数量增加（当前 3 个 → 4 个）

**实现步骤**：
1. 修改 `ProjectDetail.tsx`：扩展 `activeTab` 类型，新增 Tab 按钮
2. 新增组件：`apps/web/src/components/EpisodeComparePanel.tsx`
3. 在 Tab 内容区条件渲染：`{activeTab === 'episode-compare' ? <EpisodeComparePanel /> : ...}`

#### 方案 B：新增独立路由页面

**路由**：`/projects/[novelId]/pipeline/episode-compare`

**优点**：
- 可复用 `PipelineResourceManagerPage` 的页面框架
- URL 可分享
- 不影响现有 Tab 结构

**缺点**：
- 需要新增路由文件
- 用户需要从 Pipeline Tab 跳转

**实现步骤**：
1. 新增路由文件：`apps/web/src/app/projects/[novelId]/pipeline/episode-compare/page.tsx`
2. 新增组件：`apps/web/src/components/pipeline/EpisodeComparePage.tsx`
3. 在 `PipelinePanel.tsx` 中添加跳转链接

### 6.2 可复用组件

| 组件 | 复用方式 | 说明 |
|------|---------|------|
| `PipelineDataTable` | ✅ 直接复用 | 通用表格组件，只需传入不同的 `columns` 和 `rows` |
| `PipelineRowEditDialog` | ⚠️ 需适配 | 当前只支持单资源编辑，需扩展支持三表联动编辑 |
| `PipelineResourceManagerPage` | ⚠️ 需适配 | 当前只支持单资源，需扩展支持多资源对比 |
| 字段显示控制逻辑 | ✅ 直接复用 | localStorage + `getPipelineColumnStorageKey()` 机制 |

### 6.3 必须新增的模块

1. **三表对齐数据模型**
   - 按 `episode_number` 对齐 `novel_episodes` 和 `novel_hook_rhythm`
   - 按 `chapter_id` 对齐 `drama_structure_template`（注意：`chapter_id` 可能不等于 `episode_number`）
   - 处理缺失数据（某集在某表中不存在）

2. **三表对比 UI 组件**
   - 方案 A：三个独立表格并排显示（每表独立字段显示控制）
   - 方案 B：按集数统一行模型，三块对照面板（推荐）

3. **字段显示控制扩展**
   - 每张表独立配置字段显示（复用现有 localStorage 机制）
   - 支持"一键显示全部字段"快捷操作

4. **后端 API（如需要编辑）**
   - 如果需要在对比页编辑，需要新增或扩展 API
   - 当前 `novel_episodes` 和 `drama_structure_template` 无编辑 API

### 6.4 方案对比

#### 方案 A：三个独立表格并排显示

**优点**：
- 实现简单，直接复用 `PipelineDataTable` × 3
- 每表独立字段显示控制
- 每表独立滚动

**缺点**：
- 三表数据可能不同步（滚动位置不一致）
- 难以直观对比同一集的三表数据

**复用成本**：**低**（直接复用 `PipelineDataTable`）

#### 方案 B：按集数统一行模型，三块对照面板

**优点**：
- 直观对比同一集的三表数据
- 统一滚动位置
- 用户体验更好

**缺点**：
- 需要新增对齐逻辑
- 需要自定义 UI 布局

**复用成本**：**中**（需新增对齐逻辑，但可复用字段显示控制）

### 6.5 字段显示控制复用评估

| 需求 | 是否可复用 | 说明 |
|------|-----------|------|
| 每张表单独选择显示字段 | ✅ | localStorage key 包含 resource，三表用不同 resource 名即可 |
| `drama_structure_template` 一键显示全部字段 | ✅ | 在字段显示下拉中添加"全选"快捷操作 |
| `novel_hook_rhythm` 一键显示全部字段 | ✅ | 同上 |
| 字段显示持久化 | ✅ | localStorage 机制已支持 |

### 6.6 列显示持久化机制现状

**当前机制**：`localStorage`

**Key 格式**：`pipeline-columns:{scope}:{resource}:novel:{novelId}`

**作用域**：
- `section`：区块展示（PipelinePanel 内）
- `page`：整页管理（独立路由页面）

**URL 参数**：❌ 不支持

**服务端持久化**：❌ 不支持

### 6.7 当前最主要的技术风险

1. **`novel_hook_rhythm` 表可能不存在**
   - 风险：无法展示该表数据
   - 缓解：先确认表是否存在，如不存在需创建 migration

2. **`drama_structure_template` 使用 `chapter_id` 而非 `episode_number`**
   - 风险：`chapter_id` 可能不等于 `episode_number`，无法直接对齐
   - 缓解：需要确认业务逻辑，`chapter_id` 是否与 `episode_number` 一一对应

3. **`novel_episodes` 无唯一约束**
   - 风险：可能存在重复数据（同一 `novel_id` + `episode_number` 多条记录）
   - 缓解：查询时需去重或确认业务逻辑

4. **三表无编辑 API**
   - 风险：如果需要在对比页编辑，需要新增 API
   - 缓解：先实现只读对比，编辑功能后续迭代

---

## 7. File Inventory

### 7.1 前端文件

#### 7.1.1 页面与路由

| 文件 | 说明 |
|------|------|
| `apps/web/src/app/projects/page.tsx` | 项目列表页入口 |
| `apps/web/src/app/projects/[novelId]/pipeline/[resource]/page.tsx` | 通用资源管理页路由 |

#### 7.1.2 组件

| 文件 | 说明 |
|------|------|
| `apps/web/src/components/ProjectDetail.tsx` | 项目详情页（Tab 实现） |
| `apps/web/src/components/PipelinePanel.tsx` | Pipeline Tab 主组件 |
| `apps/web/src/components/pipeline/PipelineDataSection.tsx` | 资源区块展示组件 |
| `apps/web/src/components/pipeline/PipelineDataTable.tsx` | 通用表格组件 |
| `apps/web/src/components/pipeline/PipelineRowEditDialog.tsx` | 通用行编辑弹窗 |
| `apps/web/src/components/pipeline/PipelineResourceManagerPage.tsx` | 资源整页管理组件 |

#### 7.1.3 类型定义

| 文件 | 说明 |
|------|------|
| `apps/web/src/types/pipeline-resource.ts` | Pipeline 资源类型与配置 |
| `apps/web/src/types/pipeline.ts` | Pipeline 相关类型（episode-script 等） |
| `apps/web/src/types/index.ts` | 通用类型（Novel、Theme 等） |

#### 7.1.4 API Client

| 文件 | 说明 |
|------|------|
| `apps/web/src/lib/api.ts` | 通用 API client（包含 `getEpisodes`） |
| `apps/web/src/lib/pipeline-resource-api.ts` | Pipeline 资源 API client |

### 7.2 后端文件

#### 7.2.1 Entity

| 文件 | 说明 |
|------|------|
| `apps/api/src/entities/episode.entity.ts` | `Episode` 实体（`novel_episodes`） |
| `apps/api/src/entities/drama-structure-template.entity.ts` | `DramaStructureTemplate` 实体 |

#### 7.2.2 Controller

| 文件 | 说明 |
|------|------|
| `apps/api/src/episodes/episodes.controller.ts` | Episodes Controller（只读） |
| `apps/api/src/pipeline/pipeline-resource.controller.ts` | Pipeline 资源通用 Controller |

#### 7.2.3 Service

| 文件 | 说明 |
|------|------|
| `apps/api/src/episodes/episodes.service.ts` | Episodes Service（只读） |
| `apps/api/src/pipeline/pipeline-resource.service.ts` | Pipeline 资源通用 Service |
| `apps/api/src/pipeline/pipeline-episode-script.service.ts` | Episode Script 生成与持久化（包含 `novel_hook_rhythm` 写入逻辑） |

#### 7.2.4 DTO

| 文件 | 说明 |
|------|------|
| `apps/api/src/episodes/dto/query-episodes.dto.ts` | Episodes 查询 DTO |
| `apps/api/src/episodes/dto/episode-response.dto.ts` | Episodes 响应 DTO |
| `apps/api/src/pipeline/dto/pipeline-resource.dto.ts` | Pipeline 资源通用 DTO |

### 7.3 SQL Migration 文件

| 文件 | 说明 |
|------|------|
| `apps/api/sql/20260303_add_episode_outline_and_structure_fk.sql` | 添加 episode 字段 + `drama_structure_template` 唯一约束 |

---

## 8. Open Questions / Unknowns

1. **`novel_episodes` 是否有唯一约束 `(novel_id, episode_number)`？**
   - 现状：SQL migration 中未找到
   - 影响：如果无唯一约束，可能存在重复数据，需要去重逻辑

2. **`novel_hook_rhythm` 表是否真实存在？**
   - 现状：代码中有动态检测逻辑，但未找到建表 migration
   - 影响：如果不存在，需要先创建表才能展示数据

3. **`drama_structure_template.chapter_id` 是否与 `episode_number` 一一对应？**
   - 现状：字段名不同，业务逻辑不明确
   - 影响：如果不对应，无法直接按集数对齐三表

4. **是否需要在对比页支持编辑功能？**
   - 现状：三表当前都无编辑 API（`novel_episodes` 和 `drama_structure_template` 只有只读 API）
   - 影响：如果支持编辑，需要新增或扩展 API

5. **字段显示配置是否需要服务端持久化？**
   - 现状：当前只有 localStorage（前端）
   - 影响：如果多设备同步，需要服务端持久化

6. **`novel_hook_rhythm` 表的完整字段定义是什么？**
   - 现状：代码中只有写入时使用的字段名（`novel_id`、`episode_number`、`emotion_level`、`hook_type`、`description`、`cliffhanger`、`sort_order`）
   - 影响：如果字段不完整，需要确认表结构
