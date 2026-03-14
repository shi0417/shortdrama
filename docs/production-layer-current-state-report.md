# Production Layer Current State Report

> 调研时间：2026-03-13  
> 调研目标：生产层系统（5 张新表 + Episode Script / Scene Board / Shot Board + 旁白主导脚本初稿生成）开发前现状摸底  
> 调研原则：只读分析，不修改代码、不创建 migration/接口/页面

---

## 1. Executive Summary

1. **已有完整的 generate → draft cache → persist 模式**：Episode Script 已实现 `generateDraft` 返回 `draftId`、服务端内存缓存（TTL 30 分钟）、`persistDraft` 优先用 `draftId` 取缓存；前端 `PipelinePanel` 维护 `episodeScriptDraftId`，persist 时优先传 `draftId`，cache miss 时自动 fallback 全量 `draft`。**优先复用该模式**做“旁白主导脚本初稿”生成。

2. **已有“多表聚合再生成”的成熟实现**：Episode Script 生成从 `novel_episodes`、`drama_structure_template`、`novel_hook_rhythm` 及多张世界观表（set_core、set_payoff_arch、set_opponents 等）通过 `buildPrompt` / `fetchReferenceData` 聚合后调用 AI；Worldview 也有 generateDraft + persistDraft。旁白初稿可复用“Compare 聚合 + 生成服务”或直接复用 episode-script 的聚合与 draft 模式。

3. **当前 Episode Script persist 只写 3 张表**：`novel_episodes`、`drama_structure_template`、`novel_hook_rhythm`。拟新增的 `episode_script_versions` / `episode_scenes` / `episode_shots` / `episode_shot_prompts` / `character_visual_profiles` **在代码中未找到任何引用**，需新建表与写入逻辑。

4. **通用资源框架**：`PipelineResourceService`（`RESOURCE_CONFIG`）与前端 `PIPELINE_RESOURCE_CONFIG` 已接入 19 种 resource（含 timelines、episodes、structure-templates、hook-rhythms、payoff-arch、payoff-lines、opponent-matrix、opponents、power-ladder、traitor-system、traitors、traitor-stages、story-phases 等）。**set_core 未接入**该框架，有独立 `set-core` 模块与 PipelinePanel 内嵌编辑。

5. **10 张世界观表接入情况**：除 `set_core` 为“部分接入”（独立 API + Panel 内嵌，无 resource 路由）外，其余 9 张（set_payoff_arch、set_payoff_lines、set_opponent_matrix、set_opponents、set_power_ladder、set_traitor_system、set_traitors、set_traitor_stages、set_story_phases）均已在 **pipeline resource framework** 中完全接入（有 CRUD、整页管理、路由 `/projects/[novelId]/pipeline/[resource]`）。

6. **Episode Compare**：数据来源为 `novel_episodes`、`drama_structure_template`、`novel_hook_rhythm` 三表按 `episode_number`/`chapter_id` 对齐；API `GET /novels/:novelId/episode-compare` 返回 `{ novelId, rows: [{ episodeKey, episode, structureTemplate, hookRhythm }] }`。当前 Compare 页**无**“Generate Script”“Open Script Workspace”入口，仅有“Open Full Compare Page”和刷新，适合在此增加生产层入口。

7. **路由与挂载建议**：现有生产相关能力均在 `/projects/[novelId]/pipeline/...`（如 `[resource]`、`episode-compare`）。建议 Episode Script / Scene Board / Shot Board 继续挂在 **`/projects/[novelId]/pipeline/...`**（例如 `episode-scripts`、`episode-scripts/[episodeNumber]/scenes`、`episode-scripts/[episodeNumber]/shots`），与现有 pipeline 资源、Compare 一致，改动最小。

8. **前端类型与 API**：Episode Script 已有独立 `lib/pipeline-episode-script-api.ts` 与 `types/pipeline.ts` 中的 Draft/Persist 类型；Compare 有 `lib/episode-compare-api.ts` 与 `types/episode-compare.ts`。生产层新类型建议 **`types/episode-script.ts` 或 `types/production.ts`**，API 建议 **`lib/episode-script-api.ts`**（与现有 episode-script 命名区分：现有为“每集纲要/剧本”生成，新为“旁白主导脚本 + 版本/场/镜”）。

9. **后端模块**：生产层 CRUD 与生成可继续放在 **PipelineModule**（与 EpisodeCompare、PipelineEpisodeScript、PipelineResource 同模块），或新建 **ProductionModule** 仅承载 episode_script_versions / scenes / shots / shot_prompts / character_visual_profiles 的 CRUD，生成仍调用现有 PipelineEpisodeScriptService / 新旁白初稿服务。

10. **旁白脚本初稿实现路径预评估**：更适合同步“生成 + 写入 draft 表”或沿用现有 **draft/cache/persist** 模式；输入可直接用 Compare 聚合（`getByNovel`）或现有 episode-script 的 `buildPrompt` 聚合；输出若落新表 `episode_script_versions` + `episode_scenes` + `episode_shots`，需新增 persist 分支或新 service，当前 persist 只写 novel_episodes / drama_structure_template / novel_hook_rhythm。

11. **5 张新表**：`episode_script_versions`、`episode_scenes`、`episode_shots`、`episode_shot_prompts`、`character_visual_profiles` 在代码中 **未找到**；DB 是否已建需查库或 migration 清单。

12. **开放点**：旁白初稿与现有“每集纲要/剧本”是同一接口扩展还是独立接口；Scene/Shot 是否纳入 PIPELINE_RESOURCE_CONFIG；Compare 聚合是否需额外字段供生成用。

---

## 2. Existing Generation / Draft / Persist Patterns

### 2.1 Episode Script（每集纲要/剧本）

- **Service**：`apps/api/src/pipeline/pipeline-episode-script.service.ts`
  - `generateDraft(novelId, dto)`：单次或 multi-stage（plan + batch + merge）生成，返回 `draftId` + `draft: { episodePackage }`；生成后 `cacheDraft(draftId, { novelId, generationMode, draft, createdAt })`。
  - `persistDraft(novelId, dto)`：优先用 `dto.draftId` 从 `getCachedDraft(draftId)` 取 draft；无 draftId 或 cache miss 时用 `dto.draft`；成功后 `deleteCachedDraft(usedDraftId)`。
  - 缓存：`private readonly draftCache = new Map<string, CachedEpisodeScriptDraft>()`，TTL 30 分钟，最大 50 条，`generateDraftId()` 为 `crypto.randomUUID()`。
- **DTO**：`apps/api/src/pipeline/dto/pipeline-episode-script.dto.ts`
  - `PipelineEpisodeScriptPersistDto`：`draftId?: string`，`draft?: Record<string, any>`，`generationMode?`。
- **Controller**：`apps/api/src/pipeline/pipeline.controller.ts`
  - `POST pipeline/:novelId/episode-script-generate-draft` → `generateEpisodeScriptDraft`
  - `POST pipeline/:novelId/episode-script-persist` → `persistEpisodeScriptDraft`
- **前端**：`apps/web/src/lib/pipeline-episode-script-api.ts`（`generateEpisodeScriptDraft`、`persistEpisodeScriptDraft`）；`apps/web/src/components/PipelinePanel.tsx` 中 `episodeScriptDraftId` state、生成后 `setEpisodeScriptDraftId(result.draftId)`，persist 时 `useDraftIdMode ? buildLightPayload() : buildFullPayload()`，cache miss 时 fallback 全量 draft 再 persist。
- **Persist 写入表**：`novel_episodes`、`drama_structure_template`、`novel_hook_rhythm`（见 `affectedTables` 与 `insertEpisodePackage`）。

### 2.2 Worldview

- **Service**：`apps/api/src/pipeline/pipeline-worldview.service.ts`
  - `generateDraft(novelId, dto)`、`persistDraft(novelId, dto)`，无 draftId/cache 机制，为“全量 draft 传参 + 写入”模式。
- **Controller**：`POST pipeline/:novelId/worldview-generate-draft`、`POST pipeline/:novelId/worldview-persist`。

### 2.3 可复用模式小结

- **draftId + 服务端缓存 + persist 优先 draftId**：仅在 Episode Script 中实现，**优先复用**用于旁白脚本初稿（减少大 payload、提高可靠性）。
- **多表聚合生成**：Episode Script 的 `buildPrompt` / `fetchReferenceData` 已聚合 novel_episodes、drama_structure_template、novel_hook_rhythm、set_core、set_payoff_arch、set_opponents、set_power_ladder、set_traitor_*、set_story_phases 等；Compare 的 `getByNovel` 聚合前三表。旁白初稿可复用聚合逻辑或直接使用 Compare 返回结构。

---

## 3. Generic Resource Framework Reuse Assessment

### 3.1 框架现状

- **后端**：`apps/api/src/pipeline/pipeline-resource.service.ts` 中 `RESOURCE_CONFIG` 以 `PipelineResourceName` 为 key，每项含 `tableName`、`selectableFields`、`editableFields`、`orderBy` 等；CRUD 通过 `PipelineResourceController`（`GET/POST novels/:novelId/pipeline-resources/:resource`、`GET/PATCH/DELETE pipeline-resources/:resource/:id`）。
- **前端**：`apps/web/src/types/pipeline-resource.ts` 中 `PIPELINE_RESOURCE_CONFIG` 定义每 resource 的 `routeSegment`、`fields`、`defaultSectionColumns`、`defaultPageColumns`；`PipelineResourceManagerPage`、`PipelineDataSection`、`PipelineRowEditDialog` 依赖该配置；路由为 `/projects/[novelId]/pipeline/[resource]`（`apps/web/src/app/projects/[novelId]/pipeline/[resource]/page.tsx`）。

### 3.2 对 5 张拟新增表的逐表评估

| 表名 | 是否适合接入现有 pipeline resource framework | 原因 | 更适合整页表格页还是独立工作台 |
|------|----------------------------------------------|------|------------------------------|
| **episode_script_versions** | 部分适合 | 与 novel/episode 强绑定，可能有版本对比、当前版本等业务逻辑；若仅 CRUD 列表可接入。字段与关系需明确后再定。 | 若仅列表+编辑：整页表格可接入；若需版本 diff/发布流：更适合独立工作台（Episode Script 页） |
| **episode_scenes** | 部分适合 | 通常为 episode 下层级，需按 episode 过滤、排序；resource 框架支持 listByNovel+topicId，可扩展为按 episode 过滤。 | 整页表格（按集过滤）或 Scene Board 工作台二选一；Scene Board 更偏看板，建议独立工作台为主 |
| **episode_shots** | 部分适合 | 层级在 scene 下，需 scene_id + 排序；框架当前以 novel 为顶层级，需扩展“按 scene 过滤”或子资源。 | 更适合 Shot Board 工作台（看板/故事板），而非单纯整页表 |
| **episode_shot_prompts** | 较不适合 | 多为 shot 的附属（一条 shot 多条 prompt），强主从关系；通用框架偏“平表 per novel”。 | 更适合在 Shot Board 内嵌或 Shot 详情中编辑，不做独立 resource |
| **character_visual_profiles** | 适合 | 以 novel 为维度、角色视觉设定，与 novel_characters 可能关联；可类比 characters 资源。 | 整页表格页即可；若与角色绑定紧密也可在角色管理内嵌 |

**总结**：  
- **character_visual_profiles**：最适合接入现有 pipeline resource framework，新增一档 `PipelineResourceName` 与 RESOURCE_CONFIG 即可。  
- **episode_script_versions**：可接入做列表/编辑，但“Episode Script”页若是版本+生成+对比，则以工作台为主、resource 为辅。  
- **episode_scenes / episode_shots**：可做 listByNovel + 过滤（episode/scene），但 Scene Board / Shot Board 更偏工作台，建议独立页面 + 按需复用 `PipelineDataSection`/表格组件。  
- **episode_shot_prompts**：不建议单独成 resource，作为 shot 子数据在 Shot 工作台或 Shot 详情中维护。

---

## 4. Existing Worldbuilding Tables Integration Status

| 表名 | 代码中是否引用 | 是否接入 pipeline resource framework | 是否有前端整页 | API / DTO / service / type | 结论 |
|------|----------------|--------------------------------------|----------------|----------------------------|------|
| **set_core** | 是 | 否（未在 PIPELINE_RESOURCE_CONFIG / allowedPipelineResources） | 无独立整页；PipelinePanel 内嵌编辑 + set-core 独立 API | 有：set-core.service.ts, set-core.controller.ts；pipeline-episode-script/review/extract/worldview 等读 set_core | **部分接入**（DB exists，独立模块 + Panel 内嵌，code integration 存在，resource 未接入） |
| **set_payoff_arch** | 是 | 是（payoff-arch） | 有：`/projects/[novelId]/pipeline/payoff-arch` | PipelineResourceService + PIPELINE_RESOURCE_CONFIG | **完全接入** |
| **set_payoff_lines** | 是 | 是（payoff-lines） | 有：`/projects/[novelId]/pipeline/payoff-lines` | 同上 | **完全接入** |
| **set_opponent_matrix** | 是 | 是（opponent-matrix） | 有 | 同上 | **完全接入** |
| **set_opponents** | 是 | 是（opponents） | 有 | 同上 | **完全接入** |
| **set_power_ladder** | 是 | 是（power-ladder） | 有 | 同上 | **完全接入** |
| **set_traitor_system** | 是 | 是（traitor-system） | 有 | 同上 | **完全接入** |
| **set_traitors** | 是 | 是（traitors） | 有 | 同上 | **完全接入** |
| **set_traitor_stages** | 是 | 是（traitor-stages） | 有 | 同上 | **完全接入** |
| **set_story_phases** | 是 | 是（story-phases） | 有 | 同上 | **完全接入** |

- **set_core** 在 `apps/api/src/set-core/` 有独立模块；在 `apps/web` 无独立路由，仅在 `PipelinePanel` 内通过 `toggleEditor('set_core')`、`handleSetCoreSave`、`handleOpenEnhanceDialog` 等使用。  
- 其余 9 张表在 `pipeline-resource.service.ts` 的 `RESOURCE_CONFIG` 与 `dto/pipeline-resource.dto.ts` 的 `allowedPipelineResources` 中均有对应项，前端 `PIPELINE_RESOURCE_CONFIG` 与 `/pipeline/[resource]` 路由完整。

---

## 5. Episode Compare Integration Opportunities

### 5.1 当前数据来源与结构

- **API**：`GET /novels/:novelId/episode-compare`  
  - 实现：`apps/api/src/pipeline/episode-compare.controller.ts`、`episode-compare.service.ts`  
  - Service 并行查询 `novel_episodes`、`drama_structure_template`、`novel_hook_rhythm`（表存在则查），按 `episode_number` / `chapter_id` 对齐，返回 `EpisodeCompareResponseDto`：`{ novelId, rows: EpisodeCompareRowDto[] }`，每行 `{ episodeKey, episode, structureTemplate, hookRhythm }`。
- **前端**：`apps/web/src/lib/episode-compare-api.ts`（`getByNovel`）、`apps/web/src/types/episode-compare.ts`（`EpisodeCompareRow`、`EpisodeCompareResponse`）；页面：`apps/web/src/app/projects/[novelId]/pipeline/episode-compare/page.tsx` → `EpisodeComparePage`；组件：`EpisodeCompareWorkbench`、`EpisodeCompareToolbar`、`EpisodeCompareRow`、`EpisodeCompareDetailDialog`、`useEpisodeCompareColumns`。

### 5.2 刷新机制

- Workbench 内 `loadData` 调 `episodeCompareApi.getByNovel(novelId)`，`useEffect([novelId])` 加载；工具栏有“刷新”按钮和“Open Full Compare Page”（在 panel 模式下跳转同一 compare 全页）。

### 5.3 对生产层的复用点

- **数据**：Compare 的 `rows` 已包含每集的 episode、structureTemplate、hookRhythm，可直接作为“旁白主导脚本初稿”的输入（按集聚合）。
- **入口**：Compare 页/面板目前**没有**“Generate Script”“Open Script Workspace”按钮；可在 `EpisodeCompareToolbar` 或 Workbench 顶部增加“生成旁白脚本初稿”“打开 Episode Script 工作台”等入口，跳转至 `/projects/[novelId]/pipeline/episode-scripts` 或当前集数的 Script/Scene/Shot 页。
- **跳转**：Compare 行可增加“打开该集 Script/Scene/Shot”链接，用 `router.push(\`/projects/${novelId}/pipeline/episode-scripts/${row.episodeKey}/...\`)` 等。

### 5.4 限制与是否需额外聚合

- Compare 当前**不包含**世界观表（set_core、payoff、opponents 等）字段；若旁白初稿生成需要这些，要么在生成时由后端单独查（与现有 episode-script 一致），要么在 Compare API 中增加可选聚合字段（会加大 payload）。建议：**生成仍由后端聚合**，Compare 仅提供 episode/structure/hookRhythm 对齐视图与入口，不强制扩展 Compare 返回结构。

---

## 6. Recommended Route / Page Structure for Production Layer

- **现状**：生产相关能力均在 `/projects/[novelId]/pipeline/...`（`[resource]`、`episode-compare`）；ProjectDetail 为 Tab（basic / source / pipeline / episode-compare），无独立 `/production` 路由。
- **方案 1（推荐）**：挂在 **`/projects/[novelId]/pipeline/...`**
  - 例如：`/projects/[novelId]/pipeline/episode-scripts`（Episode Script 列表/工作台）、`/projects/[novelId]/pipeline/episode-scripts/[episodeNumber]`（单集脚本）、`/projects/[novelId]/pipeline/episode-scripts/[episodeNumber]/scenes`（Scene Board）、`/projects/[novelId]/pipeline/episode-scripts/[episodeNumber]/shots`（Shot Board）。
  - 理由：与现有 pipeline 资源、Compare 同层级，导航与权限一致；无需新 Tab 或新顶层路由；Compare 可自然跳转 `pipeline/episode-scripts`。
- **方案 2**：`/projects/[novelId]/production/...`  
  - 需新增 production 段与可能的新 Tab，改动较大，仅当希望与“内容/结构” pipeline 严格区分时考虑。
- **方案 3**：仅 ProjectDetail 新 Tab / 子工作台  
  - 将 Episode Script / Scene / Shot 做成 Tab 内嵌，与当前 episode-compare 类似；但 Scene/Shot 多为按集维度的重 UI，更适合独立路由页，故不推荐仅 Tab。

**结论**：推荐 **方案 1**，Episode Script、Scene Board、Shot Board 均挂在 `/projects/[novelId]/pipeline/...` 下，具体路径在实现时再定（如 episode-scripts、episode-scripts/[ep]/scenes、episode-scripts/[ep]/shots）。

---

## 7. Frontend Type / API Organization Recommendation

- **现状**：  
  - `types/pipeline.ts`：Episode Script 的 Draft、GenerateDraftResponse、PersistPayload、ReferenceTable 等。  
  - `types/pipeline-resource.ts`：PipelineResourceName、PIPELINE_RESOURCE_CONFIG、PipelineResourceRow 等。  
  - `types/episode-compare.ts`：EpisodeCompareRow、EpisodeCompareResponse。  
  - `lib/api.ts`：通用 apiClient、项目/小说等 API。  
  - `lib/pipeline-resource-api.ts`：list/getOne/create/update/remove by resource。  
  - `lib/pipeline-episode-script-api.ts`：preview、generateDraft、persistDraft（当前“每集纲要/剧本”）。  
  - `lib/episode-compare-api.ts`：getByNovel。

- **建议**：  
  - **生产层 types**：新增 `types/episode-script.ts` 或 `types/production.ts`，放置 episode_script_versions、episode_scenes、episode_shots、episode_shot_prompts、character_visual_profiles 的实体/列表/DTO 类型，与现有 `pipeline.ts`（生成用）区分开。  
  - **API client**：若“旁白脚本初稿”与现有 episode-script 共用后端或扩展同一 controller，可继续用 `lib/pipeline-episode-script-api.ts` 并扩展类型；若独立成“生产脚本”接口，建议单独 **`lib/episode-script-api.ts`**（或 `lib/production-api.ts`）承载版本/场景/镜头 CRUD 与“旁白初稿生成”调用，避免与现有“每集纲要/剧本”命名混淆。

---

## 8. Backend Module Organization Recommendation

- **现状**：  
  - `apps/api/src/pipeline/pipeline.module.ts` 汇聚 PipelineController、PipelineResourceController、EpisodeCompareController，以及 PipelineService、PipelineExtractService、PipelineReviewService、PipelineResourceService、PipelineWorldviewService、PipelineEpisodeScriptService、EpisodeCompareService。  
  - Compare API 在 **PipelineModule** 下（EpisodeCompareController、EpisodeCompareService）。  
  - 资源 CRUD 在 PipelineResourceController + PipelineResourceService；生成在 PipelineController + 各 *Service。

- **建议**：  
  - **方案 A**：生产层 CRUD（episode_script_versions、episode_scenes、episode_shots、episode_shot_prompts、character_visual_profiles）仍放在 **PipelineModule**，新增 Controller（如 EpisodeScriptVersionController、SceneController、ShotController 等）或一个 ProductionController 多路由，Service 可新建 EpisodeScriptVersionService、SceneService 等，与现有风格一致。  
  - **方案 B**：新建 **ProductionModule**，仅负责上述 5 张表的 CRUD 与对应 API；“旁白脚本初稿生成”可仍在 PipelineModule 调用 PipelineEpisodeScriptService 或新服务，或由 ProductionModule 注入并调用。  
  - 推荐 **方案 A**（全部留在 PipelineModule）以保持“pipeline”为内容与生产统一入口；若后续生产域接口和权限明显分化，再拆 ProductionModule 不迟。

---

## 9. Narrator-Script Draft Generation Feasibility

- **同步 vs draft/cache/persist**：现有 Episode Script 已证明 **draft/cache/persist** 可行（大 payload、刷新不丢、draftId 轻量 persist）。旁白初稿若体量类似，建议沿用该模式；若体量小且无需预览再存，也可同步“生成并写入 episode_script_versions + scenes + shots”。
- **输入**：  
  - 可直接用 **Compare 聚合**（getByNovel）得到每集 episode + structureTemplate + hookRhythm，后端再按需补查世界观表；或  
  - 直接复用 **PipelineEpisodeScriptService** 的 `buildPrompt` / 聚合逻辑（已含 novel_episodes、drama_structure_template、novel_hook_rhythm、set_core、set_payoff_*、set_opponents、set_power_ladder、set_traitor_*、set_story_phases），输出改为“旁白主导”结构并写入新表。
- **输出**：  
  - 若落 **episode_script_versions**、**episode_scenes**、**episode_shots**（及可选 episode_shot_prompts），需新增 persist 逻辑（当前 persist 只写 novel_episodes、drama_structure_template、novel_hook_rhythm）；可新方法如 `persistNarratorScriptDraft(novelId, dto)` 或扩展现有 persist 的“模式”（如 generationMode 区分写入目标表）。
- **最可复用**：**PipelineEpisodeScriptService** 的聚合与调用 AI、**draftId/cache/persist** 流程；前端 **PipelinePanel** 的“生成 → 存 draftId → 预览 → 保存”交互可复刻到 Compare 或新 Episode Script 页。

---

## 10. File Inventory

### 10.1 前端（与 pipeline / compare / episode script 相关）

| 路径 | 说明 |
|------|------|
| `apps/web/src/app/projects/[novelId]/pipeline/[resource]/page.tsx` | 通用 pipeline 资源页 |
| `apps/web/src/app/projects/[novelId]/pipeline/episode-compare/page.tsx` | Episode Compare 页 |
| `apps/web/src/components/ProjectDetail.tsx` | 项目详情 Tab（basic / source / pipeline / episode-compare） |
| `apps/web/src/components/PipelinePanel.tsx` | Pipeline 主面板，含 Episode Script 生成/预览/保存、draftId 状态 |
| `apps/web/src/components/pipeline/PipelineDataSection.tsx` | 区块列表 + 行编辑入口 |
| `apps/web/src/components/pipeline/PipelineResourceManagerPage.tsx` | 整页资源管理 |
| `apps/web/src/components/pipeline/PipelineRowEditDialog.tsx` | 行编辑弹窗 |
| `apps/web/src/components/pipeline/PipelineEpisodeScriptDialog.tsx` | 每集纲要/剧本生成弹窗 |
| `apps/web/src/components/episode-compare/EpisodeComparePage.tsx` | Compare 全页容器 |
| `apps/web/src/components/episode-compare/EpisodeComparePanel.tsx` | Compare 面板（Tab 内） |
| `apps/web/src/components/episode-compare/EpisodeCompareWorkbench.tsx` | Compare 工作台（数据 + 工具栏 + 行） |
| `apps/web/src/components/episode-compare/EpisodeCompareToolbar.tsx` | 列选择 + Open Full Compare Page |
| `apps/web/src/components/episode-compare/EpisodeCompareRow.tsx` | 单行展示 |
| `apps/web/src/components/episode-compare/EpisodeCompareDetailDialog.tsx` | 行详情弹窗 |
| `apps/web/src/components/episode-compare/useEpisodeCompareColumns.ts` | 列配置与 localStorage |
| `apps/web/src/components/episode-compare/episode-compare-storage.ts` | Compare 存储 key 等 |
| `apps/web/src/types/pipeline.ts` | Episode Script / Worldview 等类型 |
| `apps/web/src/types/pipeline-resource.ts` | PipelineResourceName、PIPELINE_RESOURCE_CONFIG |
| `apps/web/src/types/episode-compare.ts` | EpisodeCompareRow、EpisodeCompareResponse |
| `apps/web/src/lib/api.ts` | apiClient、通用 API |
| `apps/web/src/lib/pipeline-resource-api.ts` | 资源 list/getOne/create/update/remove |
| `apps/web/src/lib/pipeline-episode-script-api.ts` | 每集纲要/剧本 preview、generateDraft、persistDraft |
| `apps/web/src/lib/episode-compare-api.ts` | getByNovel |

### 10.2 后端（pipeline / compare / resource / set_core）

| 路径 | 说明 |
|------|------|
| `apps/api/src/pipeline/pipeline.module.ts` | Pipeline、Resource、EpisodeCompare 模块定义 |
| `apps/api/src/pipeline/pipeline.controller.ts` | overview、extract、review、worldview、episode-script 生成/持久化 |
| `apps/api/src/pipeline/pipeline-resource.controller.ts` | novels/:novelId/pipeline-resources/:resource CRUD |
| `apps/api/src/pipeline/episode-compare.controller.ts` | GET novels/:novelId/episode-compare |
| `apps/api/src/pipeline/pipeline-episode-script.service.ts` | generateDraft、persistDraft、draftCache、insertEpisodePackage |
| `apps/api/src/pipeline/pipeline-resource.service.ts` | RESOURCE_CONFIG、listByNovel、getOne、create、update、remove |
| `apps/api/src/pipeline/episode-compare.service.ts` | getByNovel（三表聚合） |
| `apps/api/src/pipeline/dto/pipeline-episode-script.dto.ts` | GenerateDraft、Persist（含 draftId）、ReferenceTable |
| `apps/api/src/pipeline/dto/pipeline-resource.dto.ts` | PipelineResourceName、ListQueryDto |
| `apps/api/src/pipeline/dto/episode-compare.dto.ts` | EpisodeCompareRowDto、EpisodeCompareResponseDto |
| `apps/api/src/set-core/set-core.service.ts` | set_core CRUD 与增强 |
| `apps/api/src/set-core/set-core.controller.ts` | set_core API |

### 10.3 SQL / 文档

| 路径 | 说明 |
|------|------|
| `apps/api/sql/20260303_create_set_core_and_payoff_tables.sql` | set_core、set_payoff_arch、set_payoff_lines 等 |
| `apps/api/sql/20260303_create_worldview_struct_tables.sql` | 世界观多表（含 set_opponents、set_story_phases 等） |
| `apps/api/sql/20260313_create_novel_hook_rhythm.sql` | novel_hook_rhythm |
| `docs/report-phase5a-draftid-lightweight-persist.md` | draftId 轻量 persist 实现说明 |
| `docs/design-phase5-draftid-lightweight-persist.md` | draftId 设计 |
| `docs/episode-compare-current-state-report.md` | Episode Compare 现状报告 |

---

## 11. Open Questions / Unknowns

1. **5 张新表**：`episode_script_versions`、`episode_scenes`、`episode_shots`、`episode_shot_prompts`、`character_visual_profiles` 是否已在库中建表？当前代码库中**未找到**任何引用；若未建，需 migration 与字段设计。
2. **旁白主导脚本初稿**：与现有“每集纲要/剧本”是共用同一接口（如 generationMode 区分）还是独立接口（如 `/narrator-script-generate-draft`）？若独立，是否仍复用 PipelineEpisodeScriptService 的聚合与 AI 调用？
3. **Compare 是否扩展**：是否需要在 `GET /novels/:novelId/episode-compare` 中增加世界观相关字段或“可选的聚合摘要”，供前端展示或传给生成接口？当前建议是生成端单独查世界观。
4. **Scene/Shot 与 resource 的边界**：episode_scenes、episode_shots 是否纳入 `PipelineResourceName` 与整页 `[resource]` 路由，还是仅作为 Episode Script / Scene Board / Shot Board 工作台的后端 CRUD，前端不通过 `/pipeline/[resource]` 访问？
5. **set_core 是否接入 resource**：若希望 set_core 也出现在“Pipeline 资源”列表与整页管理中，需在 `allowedPipelineResources` 与 `RESOURCE_CONFIG`、`PIPELINE_RESOURCE_CONFIG` 中新增（例如 `set-core`），并处理其 is_active/version 等特殊语义。

---

*报告结束。未修改任何代码，未创建 migration/接口/页面。*
