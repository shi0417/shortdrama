# Episode Compare Implementation Report

## 1. 修改文件清单

### 后端
- `apps/api/src/pipeline/dto/pipeline-resource.dto.ts`
- `apps/api/src/pipeline/pipeline-resource.service.ts`
- `apps/api/src/pipeline/pipeline.module.ts`
- `apps/api/src/pipeline/episode-compare.controller.ts`（新增）
- `apps/api/src/pipeline/episode-compare.service.ts`（新增）
- `apps/api/src/pipeline/dto/episode-compare.dto.ts`（新增）
- `apps/api/sql/20260313_create_novel_hook_rhythm.sql`（新增）

### 前端
- `apps/web/src/types/pipeline-resource.ts`
- `apps/web/src/components/ProjectDetail.tsx`
- `apps/web/src/components/PipelinePanel.tsx`
- `apps/web/src/components/pipeline/PipelineResourceManagerPage.tsx`
- `apps/web/src/app/projects/[novelId]/pipeline/episode-compare/page.tsx`（新增）
- `apps/web/src/lib/episode-compare-api.ts`（新增）
- `apps/web/src/types/episode-compare.ts`（新增）
- `apps/web/src/components/episode-compare/episode-compare-storage.ts`（新增）
- `apps/web/src/components/episode-compare/useEpisodeCompareColumns.ts`（新增）
- `apps/web/src/components/episode-compare/EpisodeCompareToolbar.tsx`（新增）
- `apps/web/src/components/episode-compare/EpisodeCompareColumnCard.tsx`（新增）
- `apps/web/src/components/episode-compare/EpisodeCompareRow.tsx`（新增）
- `apps/web/src/components/episode-compare/EpisodeCompareDetailDialog.tsx`（新增）
- `apps/web/src/components/episode-compare/EpisodeCompareWorkbench.tsx`（新增）
- `apps/web/src/components/episode-compare/EpisodeComparePanel.tsx`（新增）
- `apps/web/src/components/episode-compare/EpisodeComparePage.tsx`（新增）

## 2. 新增资源配置

### 前端资源扩展
在 `apps/web/src/types/pipeline-resource.ts` 中扩展 `PipelineResourceName`：
- `episodes`
- `structure-templates`
- `hook-rhythms`

并在 `PIPELINE_RESOURCE_CONFIG` 中新增三组完整字段配置（标题、路由段、默认列、字段定义）：
- `episodes` → `routeSegment: 'episodes'`
- `structure-templates` → `routeSegment: 'structure-templates'`
- `hook-rhythms` → `routeSegment: 'hook-rhythms'`

### 后端资源扩展
在 `apps/api/src/pipeline/dto/pipeline-resource.dto.ts` 中扩展 `allowedPipelineResources` 同名 3 个资源。

在 `apps/api/src/pipeline/pipeline-resource.service.ts` 的 `RESOURCE_CONFIG` 中新增：
- `episodes`（表：`novel_episodes`）
- `structure-templates`（表：`drama_structure_template`，并声明 `novelIdColumn: 'novels_id'`）
- `hook-rhythms`（表：`novel_hook_rhythm`）

## 3. 后端 API / DTO / Service / SQL 变更

### 3.1 通用 resource CRUD 能力补齐
`PipelineResourceService` 增加 `novelIdColumn` 机制，避免对 `novel_id` 的硬编码：
- `listByNovel` 按配置列过滤（`novel_id` 或 `novels_id`）
- `create` 自动写入配置对应的 novel 外键列
- `update` 从配置列读取归属 novelId

新增辅助方法：
- `getNovelIdColumn(config)`，默认回退 `novel_id`

### 3.2 Compare 聚合 API
新增后端接口：
- `GET /novels/:novelId/episode-compare`

文件：
- `apps/api/src/pipeline/episode-compare.controller.ts`
- `apps/api/src/pipeline/episode-compare.service.ts`
- `apps/api/src/pipeline/dto/episode-compare.dto.ts`

返回结构：
- `EpisodeCompareResponseDto { novelId, rows }`
- `EpisodeCompareRowDto { episodeKey, episode, structureTemplate, hookRhythm }`

### 3.3 聚合逻辑
在 `EpisodeCompareService.getByNovel()` 中：
1. 查询 `novel_episodes`（按 `episode_number`）
2. 查询 `drama_structure_template`（按 `chapter_id`）
3. 查询 `novel_hook_rhythm`（先检查表是否存在，不存在返回空数组）
4. 收集三表所有集号，去重，升序
5. 组装统一行模型（缺失块返回 `null`）

### 3.4 SQL migration
新增 `apps/api/sql/20260313_create_novel_hook_rhythm.sql`：
- `CREATE TABLE IF NOT EXISTS novel_hook_rhythm (...)`
- 包含 `novel_id` 外键、`episode_number` 索引、`emotion_level/hook_type/description/cliffhanger/created_at` 字段

## 4. 前端页面 / 组件 / 路由变更

### 4.1 入口 1：项目详情页 Tab
在 `apps/web/src/components/ProjectDetail.tsx`：
- `activeTab` 类型扩展为 `'basic' | 'source' | 'pipeline' | 'episode-compare'`
- 新增 Tab 按钮：`Episode Compare`
- 新增渲染分支：`<EpisodeComparePanel novelId={novel.id} novelName={novel.novelsName} />`

### 4.2 入口 2：独立页面路由
新增：
- `apps/web/src/app/projects/[novelId]/pipeline/episode-compare/page.tsx`
- 渲染 `EpisodeComparePage`

### 4.3 Pipeline 入口按钮
在 `apps/web/src/components/PipelinePanel.tsx` 增加：
- `Open Episode Compare` 按钮
- 跳转 `/projects/${novelId}/pipeline/episode-compare`

### 4.4 Compare 组件结构
- `EpisodeComparePanel`：Tab 内简版（compact）
- `EpisodeComparePage`：独立页完整版（page）
- `EpisodeCompareWorkbench`：核心逻辑（加载数据、列配置、行列表、详情弹窗）
- `EpisodeCompareToolbar`：每张表独立字段显示控制
- `EpisodeCompareRow`：统一对照行
- `EpisodeCompareColumnCard`：三列卡片块展示
- `EpisodeCompareDetailDialog`：三块明细 + 新建/编辑/删除入口

## 5. 字段显示与 localStorage 方案

新增独立存储机制（避免污染原 pipeline 资源页 key）：
- `episode-compare-columns:panel:{resource}:novel:{novelId}`
- `episode-compare-columns:page:{resource}:novel:{novelId}`

实现文件：
- `apps/web/src/components/episode-compare/episode-compare-storage.ts`
- `apps/web/src/components/episode-compare/useEpisodeCompareColumns.ts`

能力：
- 每张表独立显示字段
- 全选
- 清空
- 恢复默认
- panel/page 双作用域独立持久化

## 6. 三表对齐逻辑说明

第一版按你要求采用统一键：
- `novel_episodes.episode_number` → `episodeKey`
- `drama_structure_template.chapter_id` → `episodeKey`
- `novel_hook_rhythm.episode_number` → `episodeKey`

后端聚合时：
- 自动收集三表所有出现过的 key
- 去重排序
- 缺失块置 `null`

前端逐行显示，确保同一集三块可并排对照。

## 7. 编辑 / 删除 / 新建交互说明

在 `EpisodeCompareDetailDialog` 中实现：
- 每一行（episodeKey）进入详情后，分三块显示原始数据
- 若某块有数据：提供“编辑”
- 若某块无数据：提供“新建该集记录”
- 编辑/新建复用 `PipelineRowEditDialog`
- 删除通过 `PipelineRowEditDialog` 的 `onDelete` 触发
- 成功后自动刷新 compare 数据

调用链统一复用：
- `pipelineResourceApi.create/update/remove`

## 8. 风险与已知限制

1. 第一版默认 `chapter_id === episode_number`，未实现高级映射关系。
2. `EpisodeCompareDetailDialog` 目前为“每次编辑一个资源块”的模式，非三块同屏批量保存。
3. `hook-rhythms` 资源依赖新 migration 生效；若数据库未执行 SQL，会在 CRUD 时报表不存在。
4. 宽度策略采用可见字段数量映射到 `flex-grow`，属于稳态近似方案，不是精确宽度算法。

## 9. 手工验证步骤

### 9.1 资源接入验证
1. 打开：
   - `/projects/{novelId}/pipeline/episodes`
   - `/projects/{novelId}/pipeline/structure-templates`
   - `/projects/{novelId}/pipeline/hook-rhythms`
2. 验证列表加载、字段显示弹层、行编辑/删除、创建记录。

### 9.2 Compare API 验证
1. 调用 `GET /novels/{novelId}/episode-compare`
2. 验证返回：
   - `rows[].episodeKey` 升序
   - 三块数据可为 `null`
   - 三表均有数据时对齐正确

### 9.3 项目详情页入口验证
1. 在 `/projects` 选中项目，切到 `Episode Compare` Tab
2. 验证简版工作台显示、字段切换、行点击详情。

### 9.4 独立页入口验证
1. 点击 `Open Full Compare Page`
2. 验证跳转 `/projects/{novelId}/pipeline/episode-compare`
3. 验证完整数据展示与编辑流程。

### 9.5 fallback/空态验证
1. 删除某一集某张表对应记录
2. Compare 行中该块应显示 `No data`
3. 点“新建该集记录”可成功创建并刷新。
