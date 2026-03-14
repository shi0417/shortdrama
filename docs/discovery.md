# Stage 0 Discovery Report

## Task

将 `/projects/[novelId]/pipeline/episode-scripts` 页面当前的「生成旁白主导脚本初稿」能力，升级为类似「生成每集纲要和每集剧本」的高级生成对话框与后端编排式生成链路。

---

# 0. Discovery Scope

本轮为**只读分析**，未修改任何业务代码、未新增文件、未执行破坏性 SQL。已阅读前后端源码、DTO/service/controller、migration、API 封装与页面组件，并梳理现有调用链。

---

# 1. Executive Summary

## 1.1 当前结论（必填）

1. **episode-scripts 页面旁白初稿生成方式**：页面为 `EpisodeScriptsPage`（`apps/web/src/components/production/EpisodeScriptsPage.tsx`），通过「生成旁白主导脚本初稿」按钮打开一个**简易弹窗**（非 Pipeline 主面板内的大对话框），仅支持 batchSize、modelKey、startEpisode、endEpisode；点击「开始生成」调用 `narratorScriptApi.generateDraft(novelId, params)`，成功后保存 draftId + lastDraft，再通过「保存草稿」调用 `narratorScriptApi.persistDraft(novelId, { draftId, draft })`；**无 prompt 预览、无参考表勾选、无 prompt override**。

2. **「生成每集纲要和每集剧本」弹窗组织方式**：入口在 **Pipeline 主面板**（`PipelinePanel.tsx`）内，通过「生成每集纲要和每集剧本」打开 `PipelineEpisodeScriptDialog`；**状态全部由 PipelinePanel 管理**（episodeScriptDialogOpen、episodeScriptSelectedModelKey、episodeScriptReferenceTables、episodeScriptPromptPreview、episodeScriptDraft 等）；对话框内包含：模型选择、时长模板、生成模式、参考表多选、用户附加要求、允许编辑 Prompt、字体大小、素材预算、**刷新 Prompt 预览**、**可编辑的 Prompt 文本框**、**生成草稿**与**确认写入**按钮；先 `refreshEpisodeScriptPromptPreview` 调 preview API，再 `handleGenerateEpisodeScriptDraft` 调 generate-draft API，再 `handlePersistEpisodeScriptDraft` 调 persist API；写入成功后 alert summary 并 `loadOverview()`。

3. **两套流程共同点**：均为「生成 draft → 缓存 draftId → 用户确认后 persist」；persist 均支持 draftId 优先、cache miss 时 fallback 全量 draft；后端均有 draft cache（TTL + 条数限制）、novelId 校验、错误码（如 EPISODE_SCRIPT_DRAFT_CACHE_MISS / NARRATOR_SCRIPT_DRAFT_CACHE_MISS）；前端均在 persist 失败且为 cache miss 时用本地 draft 重试一次。

4. **两套流程关键差异**：  
   - **写库目标不同**：episode-script persist 写 **novel_episodes、drama_structure_template、novel_hook_rhythm**（「源数据」三表）；narrator persist 写 **episode_script_versions、episode_scenes、episode_shots、episode_shot_prompts**（生产层四表）。  
   - **UI 与参数**：episode-script 有完整对话框（参考表、prompt 预览、override、批次/完整性状态）；narrator 只有简易弹窗（集数范围 + batchSize + 可选 modelKey）。  
   - **生成逻辑**：episode-script 有 plan+batch 多阶段（targetEpisodeCount > 10 时）或单次 LLM；narrator 按 batch 调用 LLM，每批用 `PipelineReferenceContextService.getContext` + `buildNarratorPromptContext` 构建上下文，**不写 episode_script_versions 等表的是 episode-script 流程，写的是 narrator 流程**。

5. **新 UI 基座建议**：「生成每集纲要和每集剧本」的 **PipelineEpisodeScriptDialog + PipelinePanel 状态管理** 更适合作为新 UI 基础，因已具备参考表白名单、prompt preview、prompt override、批次/完整性展示、persist 前确认与 fallback。

6. **写库逻辑复用建议**：若目标仍是「旁白主导脚本」落生产层四表，则**写库逻辑应复用 narrator 的 persist 路径**（`NarratorScriptService.persistDraft` 已实现 version_no、is_active 切换、四表事务写入）；episode-script 的 persist 写的是源数据三表，与生产层四表是不同链路，不可直接混用。

7. **draft cache / versioning / active 切换**：两套均有。Narrator：`NarratorScriptService` 内存 Map key=draftId，TTL 30min，最多 50 条，persist 时按 novel_id+episode_number 先 UPDATE is_active=0 再 INSERT 新 version，version_no 取 MAX(version_no)+1。Episode-script：`PipelineEpisodeScriptService` 同样内存 cache、TTL、limit，persist 时 **delete 再 insert** novel_episodes / drama_structure_template / novel_hook_rhythm（无 version_no/is_active，是覆盖式）。

8. **参考表白名单 / prompt preview / override**：episode-script 已具备：`allowedEpisodeScriptReferenceTables`（DTO）、`referenceTableOptions`（Dialog）、`refreshEpisodeScriptPromptPreview` → `previewEpisodeScriptPrompt` API，`allowPromptEdit` + `promptOverride` 在 preview/generate 时传入，generate 时若 override 有值则用 override 替代服务端拼的 prompt。Narrator 当前**无**参考表勾选、**无** prompt 预览、**无** override；参考表由后端固定为 `NARRATOR_DEFAULT_EXTENSION`（PipelineReferenceContextService）。

9. **资源读取统一**：参考表读取已部分统一到 **PipelineReferenceContextService**（getContext、getTableBlock、buildNarratorPromptContext）；episode-script 的 buildReferenceBlock 对 SHARED_SERVICE_TABLE_NAMES 内表走 `refContext.getTableBlock`，其余 return null。**Resource framework** 指 **PipelineResourceService + PIPELINE_RESOURCE_CONFIG**（CRUD 管理 timelines/characters/episodes/set_core 等），与「生成时参考表」是两套：前者是列表/编辑页用，后者是 prompt 上下文用。

10. **最小侵入改造路径**：在 episode-scripts 页面（或 Pipeline 内独立入口）**复用或仿造 PipelineEpisodeScriptDialog 的交互**，为 narrator 增加「参考表勾选、prompt 预览、prompt override、生成模式等」对话框；后端保持 `NarratorScriptService.generateDraft/persistDraft` 为生产层四表写入主路径，可扩展 DTO 支持 requestedTables / promptOverride 等，参考表继续由 PipelineReferenceContextService 提供；**不**改为用 episode-script 的 persist 写四表（因 episode-script 写的是三张源表）。

---

# 2. Relevant File Inventory

## 2.1 前端相关文件

| File Path | Layer | Purpose | Why Relevant |
|-----------|--------|---------|--------------|
| apps/web/src/app/projects/[novelId]/pipeline/episode-scripts/page.tsx | page | 路由：渲染 EpisodeScriptsPage | episode-scripts 页面入口 |
| apps/web/src/components/production/EpisodeScriptsPage.tsx | component | 旁白初稿生成 + 版本列表 + 保存草稿 + 简易生成弹窗 | 当前旁白生成主界面与弹窗 |
| apps/web/src/components/production/EpisodeScriptDetailPage.tsx | component | 单集脚本详情（版本、场景列表入口） | 与 episode-scripts 同层级导航 |
| apps/web/src/components/production/SceneBoardPage.tsx | component | 按场景列 scene，可编辑 | 生产层 scene 编辑 |
| apps/web/src/components/production/ShotBoardPage.tsx | component | 按 shot 列 prompt，可编辑；video_cn/video_en 快速补齐 | 生产层 shot/prompt 编辑 |
| apps/web/src/components/PipelinePanel.tsx | component | Pipeline 主面板；打开「生成每集纲要和每集剧本」对话框；管理 episode-script 全部状态与 API 调用 | 每集纲要/剧本对话框入口与状态、preview/generate/persist 调用链 |
| apps/web/src/components/pipeline/PipelineEpisodeScriptDialog.tsx | component | 生成每集纲要和每集剧本对话框 UI（模型、时长、模式、参考表、prompt 预览、生成/写入按钮） | 目标可复用的高级对话框形态 |
| apps/web/src/lib/episode-script-api.ts | api | episodeScriptVersionApi（list/get/create/update/setActive/remove）、episodeSceneApi、episodeShotApi、episodeShotPromptApi、narratorScriptApi（generateDraft、persistDraft） | 旁白与生产层 CRUD/生成/persist 封装 |
| apps/web/src/lib/pipeline-episode-script-api.ts | api | previewEpisodeScriptPrompt、generateEpisodeScriptDraft、persistEpisodeScriptDraft | 每集纲要/剧本 preview、generate、persist |
| apps/web/src/lib/api.ts | api | getNovel、getPipelineOverview 等 | 项目/概览等基础 API |
| apps/web/src/types/episode-script.ts | types | EpisodeScriptVersion、NarratorScriptDraftPayload、NarratorScriptPersistResponse 等 | 旁白与生产层类型 |
| apps/web/src/types/pipeline.ts | types | PipelineEpisodeScriptRequest、PipelineEpisodeScriptPreviewResponse、PipelineEpisodeScriptGenerateDraftResponse、PipelineEpisodeScriptPersistPayload、PipelineEpisodeScriptReferenceTable 等 | 每集纲要/剧本请求与响应类型 |
| apps/web/src/types/pipeline-resource.ts | types | PipelineResourceName、PIPELINE_RESOURCE_CONFIG（含 character-visual-profiles） | 资源配置与 character_visual_profiles 前端配置 |

## 2.2 后端相关文件

| File Path | Layer | Purpose | Why Relevant |
|-----------|--------|---------|--------------|
| apps/api/src/pipeline/pipeline.controller.ts | controller | POST :novelId/episode-script-preview-prompt、episode-script-generate-draft、episode-script-persist、narrator-script-generate-draft、narrator-script-persist | 两套流程的 HTTP 入口 |
| apps/api/src/pipeline/dto/pipeline-episode-script.dto.ts | dto | PipelineEpisodeScriptPreviewDto（modelKey、referenceTables、userInstruction、allowPromptEdit、promptOverride、sourceTextCharBudget、durationMode、generationMode、targetEpisodeCount）、GenerateDraftDto、PersistDto；allowedEpisodeScriptReferenceTables | 每集纲要/剧本参数与参考表白名单 |
| apps/api/src/pipeline/dto/narrator-script.dto.ts | dto | NarratorScriptGenerateDraftDto（targetEpisodeCount、startEpisode、endEpisode、batchSize、modelKey）、NarratorScriptPersistDto（draftId、draft）；DraftPayload、VersionDraft、SceneDraft、ShotDraft 等 | 旁白生成/持久化参数与 draft 结构 |
| apps/api/src/pipeline/pipeline-episode-script.service.ts | service | previewPrompt、generateDraft（单次或 plan+batch）、persistDraft；buildPrompt、buildReferenceBlock（委托 refContext.getTableBlock）；draft cache；deleteExistingEpisodeScriptData + insertEpisodePackage 写 novel_episodes、drama_structure_template、novel_hook_rhythm | 每集纲要/剧本 prompt 构建、生成、写源数据三表 |
| apps/api/src/pipeline/narrator-script.service.ts | service | generateDraft（按批、PipelineReferenceContextService）、persistDraft（写 episode_script_versions、episode_scenes、episode_shots、episode_shot_prompts）；draft cache、version_no、is_active 切换 | 旁白生成与生产层四表写入 |
| apps/api/src/pipeline/pipeline-reference-context.service.ts | service | getContext、buildNarratorPromptContext、getTableBlock；核心三表 + 扩展表（含 drama_source_text、novel_source_segments、adaptation_modes）；SHARED_SERVICE_TABLE_NAMES | 统一参考表聚合，narrator 与 episode-script 共用 |
| apps/api/src/pipeline/pipeline-resource.service.ts | service | RESOURCE_CONFIG（表名、字段、orderBy）；list、get、create、update、delete；character_visual_profiles 已接入 | 资源 CRUD 与 character_visual_profiles 读写 |
| apps/api/src/pipeline/episode-script-version.service.ts | service | listByNovel、getByNovelAndEpisode、listSummaryByNovel 等；无「从 draft 写入」逻辑 | 生产层 version 查询/列表 |
| apps/api/src/pipeline/episode-scene.service.ts | service | listByScriptVersion、create、update、remove | 生产层 scene CRUD |
| apps/api/src/pipeline/episode-shot.service.ts | service | listByScene、create、update、remove | 生产层 shot CRUD |
| apps/api/src/pipeline/episode-shot-prompt.service.ts | service | listByShot、create、update、remove | 生产层 shot prompt CRUD |
| apps/api/src/pipeline/episode-script-production.controller.ts | controller | novels/:novelId/episode-script-versions、episode-script-versions/:id、episode-scenes、episode-shots、episode-shot-prompts 等 | 生产层 REST 入口 |
| apps/api/sql/20260313_create_production_layer_tables.sql | migration | CREATE TABLE episode_script_versions、episode_scenes、episode_shots、episode_shot_prompts、character_visual_profiles | 生产层五表建表 |
| apps/api/src/entities/episode.entity.ts | entity | novel_episodes 表映射（Episode） | 源数据表 entity；生产层四表当前无独立 Entity，为 raw query |

---

# 3. Existing Flow A: 「生成每集纲要和每集剧本」完整调用链

## 3.1 前端入口

- **页面入口**：用户在项目详情选「Pipeline」标签后，在 PipelinePanel 内点击「生成每集纲要和每集剧本」按钮（或同区域入口），触发 `handleOpenEpisodeScriptDialog`（PipelinePanel.tsx 约 949 行）。
- **对话框**：`PipelineEpisodeScriptDialog`，由 PipelinePanel 渲染，`open={episodeScriptDialogOpen}`。
- **状态**：全部在 PipelinePanel：episodeScriptDialogOpen、episodeScriptModels、episodeScriptSelectedModelKey、episodeScriptReferenceTables、episodeScriptPromptPreview、episodeScriptDraft、episodeScriptDraftId、episodeScriptSourceTextCharBudget、episodeScriptDurationMode、episodeScriptGenerationMode、episodeScriptAllowPromptEdit、episodeScriptFontSize 等（约 344–399 行）。
- **默认值**：referenceTables 默认 `defaultEpisodeScriptReferenceTables`（drama_novels、novel_source_segments、novel_adaptation_strategy、adaptation_modes、set_core 等）；sourceTextCharBudget 默认 30000；durationMode 默认 '60s'；generationMode 默认 'outline_and_script'；模型从 `pipelineAiApi.listAiModelOptions()` 拉取，打开时若无选中则取第一个。

## 3.2 对话框字段清单

| Field | UI Type | Default Value | Source | Sent To Backend As |
|-------|---------|---------------|--------|--------------------|
| model | select | 首个可用模型 | episodeScriptModels | modelKey |
| 每集时长模板 | select | 60s | episodeScriptDurationMode | durationMode |
| 生成模式 | select | outline_and_script | episodeScriptGenerationMode | generationMode |
| 素材预算(chars) | number input | 30000 | episodeScriptSourceTextCharBudget | sourceTextCharBudget |
| 参考数据 | checkboxes | defaultEpisodeScriptReferenceTables | episodeScriptReferenceTables | referenceTables |
| 用户附加要求 | textarea | '' | episodeScriptUserInstruction | userInstruction |
| 允许编辑 Prompt | checkbox | false | episodeScriptAllowPromptEdit | allowPromptEdit |
| Prompt 预览/编辑 | textarea | 服务端预览结果 | episodeScriptPromptPreview | promptOverride（当 allowPromptEdit 且内容非空） |
| 字体大小 | select | 14 | episodeScriptFontSize | 仅前端 |
| 刷新 Prompt 预览 | button | - | - | 触发 preview API |
| 生成草稿 | button | - | - | 触发 generate-draft API |
| 确认写入 | button | - | - | 触发 persist API |
| targetEpisodeCount | 未单独表单项 | totalChapters（从 PipelinePanel props） | totalChapters | targetEpisodeCount |

## 3.3 前端 API 调用链

1. **Preview**：`pipelineEpisodeScriptApi.previewEpisodeScriptPrompt(novelId, { modelKey, referenceTables, userInstruction, allowPromptEdit, promptOverride?, sourceTextCharBudget, durationMode, generationMode, targetEpisodeCount })` → 返回 `promptPreview`、`referenceSummary`、`warnings`；前端 setEpisodeScriptPromptPreview、setEpisodeScriptReferenceSummary、setEpisodeScriptWarnings。
2. **Generate draft**：`pipelineEpisodeScriptApi.generateEpisodeScriptDraft(novelId, { modelKey, referenceTables, userInstruction, allowPromptEdit, promptOverride?, sourceTextCharBudget, durationMode, generationMode, targetEpisodeCount })` → 返回 draftId、draft、promptPreview、referenceSummary、warnings、batchInfo、finalCompletenessOk 等；前端更新 draft 与相关状态。
3. **Persist**：优先 `{ draftId, generationMode }`，失败且为 EPISODE_SCRIPT_DRAFT_CACHE_MISS 时 fallback `{ draft, generationMode }`；`pipelineEpisodeScriptApi.persistEpisodeScriptDraft(novelId, payload)` → 返回 summary（episodes、structureTemplates、hookRhythm、episodeNumbers、affectedTables 等）；成功则 loadOverview、alert。
4. **Loading/error**：preview 与 generate 用 episodeScriptLoading / episodeScriptGenerating / episodeScriptPersisting；错误用 alert；批次/完整性用 batchInfo、failedBatches、finalCompletenessOk、countMismatchWarning 等在 Dialog 内展示。

## 3.4 后端调用链

```text
UI (PipelinePanel)
 -> refreshEpisodeScriptPromptPreview / handleGenerateEpisodeScriptDraft / handlePersistEpisodeScriptDraft
 -> pipelineEpisodeScriptApi.previewEpisodeScriptPrompt / generateEpisodeScriptDraft / persistEpisodeScriptDraft
 -> POST /pipeline/:novelId/episode-script-preview-prompt | episode-script-generate-draft | episode-script-persist
 -> PipelineController.previewEpisodeScriptPrompt / generateEpisodeScriptDraft / persistEpisodeScriptDraft
 -> DTO: PipelineEpisodeScriptPreviewDto / PipelineEpisodeScriptGenerateDraftDto / PipelineEpisodeScriptPersistDto
 -> PipelineEpisodeScriptService.previewPrompt / generateDraft / persistDraft
 -> buildPrompt (referenceTables -> buildReferenceBlock -> refContext.getTableBlock 或自建) -> 拼 prompt
 -> (generate) callLcAiApi 或 generateDraftMultiStage（plan + batch）
 -> (persist) getCachedDraft / dto.draft -> validateAndNormalizeEpisodePackage -> transaction(deleteExistingEpisodeScriptData + insertEpisodePackage)
 -> 返回 promptPreview / draft+summary / persist summary
```

## 3.5 Prompt 机制

- **服务端生成**：prompt 由 `PipelineEpisodeScriptService.buildPrompt` 在服务端生成（任务定义、生成规则、节奏模板、JSON 契约、参考资料 blocks、用户附加要求）；参考资料来自 `buildReferenceBlocksOnly` → `buildReferenceBlock`（表数据块）。
- **支持 preview**：`previewPrompt` 与 `buildPrompt` 共用逻辑，返回 `promptPreview` 和 `referenceSummary`。
- **支持 override**：DTO 有 `allowPromptEdit`、`promptOverride`；generate 时若 `allowPromptEdit && normalizeText(dto.promptOverride)` 存在，则 `finalPrompt = dto.promptOverride`，否则用 `promptPreview`。
- **allowPromptEdit**：前端勾选后，Prompt 文本框可编辑；刷新预览或生成时会把当前文本框内容作为 promptOverride 传后端（若勾选且非空）。
- **参考表进入 prompt**：按 referenceTables 顺序调用 buildReferenceBlock，每表产出一段 block，拼成「【参考资料】」下的 blocks.join('\n\n')。
- **sourceTextCharBudget**：传入 buildPrompt，用于 buildReferenceBlock 的每表 charBudget；整体 charBudget = min(max(8000, sourceTextCharBudget), 120000)。

## 3.6 数据落库机制

- **generate-draft**：不写库，只生成 draft 并放入服务端内存 cache（draftId -> { novelId, draft, createdAt }）。
- **persist**：才写库；先 resolve draft（draftId 取 cache 或 payload.draft），校验 novelId、校验并规范化 draft，再在**同一事务**内：delete 指定集数范围的 novel_episodes、drama_structure_template、novel_hook_rhythm，再 insertEpisodePackage 写入三表。
- **Draft 缓存**：有；key=draftId，value={ novelId, draft, createdAt }；TTL 与条数限制在 PipelineEpisodeScriptService 内（DRAFT_CACHE_TTL_MS、MAX_CACHED_DRAFTS）。
- **事务**：persist 使用 `this.dataSource.transaction(async (manager) => { delete...; return insertEpisodePackage(...); })`。
- **版本化**：**无**。episode-script 写的是源数据三表，按集数 delete 再 insert，无 version_no/is_active 概念。

---

# 4. Existing Flow B: 当前 narrator-script / 旁白主导脚本初稿 调用链

## 4.1 前端入口

- **页面**：`/projects/[novelId]/pipeline/episode-scripts` → `EpisodeScriptsPage`（production/EpisodeScriptsPage.tsx）。
- **按钮**：「生成旁白主导脚本初稿」打开**简易弹窗**（同文件内 inline 的 div 弹层），「保存草稿」在 draftId 存在时显示。
- **状态**：draftId、lastDraft、draftPreview、generateDialogOpen、generateParams（batchSize、modelKey、startEpisode、endEpisode）在 EpisodeScriptsPage 内；load 时拉 novel、episodeScriptVersionApi.listByNovel、listSummaryByNovel。
- **参数来源**：generateParams 默认 batchSize=5、startEpisode='1'、endEpisode='5'、modelKey=''；用户可在弹窗中修改；「只生成前 5 集」按钮会设为 1、5、5、5。

## 4.2 当前 UI 字段

| Field | UI Type | Default Value | Sent To Backend As | Notes |
|-------|---------|---------------|--------------------|-------|
| batchSize | number | 5 | batchSize | 每批集数 |
| modelKey | text | '' | modelKey（空则不传） | 可选 |
| startEpisode | text | '1' | startEpisode（parseInt 有效时） | 可选 |
| endEpisode | text | '5' | endEpisode（parseInt 有效时） | 可选 |
| targetEpisodeCount | 无 | 未暴露 | 未传 | 后端用 start/end 与全集数截断 |

## 4.3 前端 API 调用链

- **Generate**：`narratorScriptApi.generateDraft(novelId, { batchSize, modelKey?, startEpisode?, endEpisode? })` → 返回 `{ draftId, draft }`；draft 含 scripts、meta.batchCount。
- **Persist**：`narratorScriptApi.persistDraft(novelId, { draftId, draft })`；失败且 code === 'NARRATOR_SCRIPT_DRAFT_CACHE_MISS' 时重试 `persistDraft(novelId, { draft: lastDraft })`。
- **List/CRUD**：episodeScriptVersionApi.listByNovel、listSummaryByNovel、getByEpisode；episodeSceneApi、episodeShotApi、episodeShotPromptApi 用于 Scene/Shot 页的列表与编辑。

## 4.4 后端调用链

```text
UI (EpisodeScriptsPage)
 -> narratorScriptApi.generateDraft / persistDraft
 -> POST /pipeline/:novelId/narrator-script-generate-draft | narrator-script-persist
 -> PipelineController.generateNarratorScriptDraft / persistNarratorScriptDraft
 -> DTO: NarratorScriptGenerateDraftDto / NarratorScriptPersistDto
 -> NarratorScriptService.generateDraft / persistDraft
 -> generateDraft: refContext.getContext(episodeNumbers, requestedTables: NARRATOR_DEFAULT_EXTENSION) -> buildNarratorPromptContext -> generateNarratorScriptsWithLlm（按批）-> 合并 scripts、写 cache
 -> persistDraft: getCachedDraft(draftId) 或 dto.draft -> transaction: 每 script 先 UPDATE is_active=0，再 INSERT episode_script_versions -> 每 scene INSERT episode_scenes -> 每 shot INSERT episode_shots、episode_shot_prompts -> 返回 summary
```

## 4.5 Draft Cache 机制

- **数据结构**：`Map<string, CachedNarratorScriptDraft>`，`CachedNarratorScriptDraft = { novelId, draft, createdAt }`（narrator-script.service.ts 约 30–35 行）。
- **Key**：draftId（randomUUID()）。
- **TTL**：30 分钟（DRAFT_CACHE_TTL_MS）。
- **Limit**：最多 50 条（MAX_CACHED_DRAFTS），超出时删最旧（enforceDraftCacheLimit）。
- **Miss**：persist 时若 draftId 对应 cache 不存在且未传 draft，抛 BadRequestException code `NARRATOR_SCRIPT_DRAFT_CACHE_MISS`；前端捕获后用全量 draft 再请求一次。
- **novelId mismatch**：persist 时若 cache 中 novelId !== 请求 novelId，抛 BadRequestException code `NARRATOR_SCRIPT_DRAFT_ID_NOVEL_MISMATCH`。
- **错误码**：NARRATOR_SCRIPT_DRAFT_CACHE_MISS、NARRATOR_SCRIPT_DRAFT_ID_NOVEL_MISMATCH、NARRATOR_SCRIPT_DRAFT_REQUIRED（未提供 draftId 且未提供 draft）。

## 4.6 写库机制

- **episode_script_versions**：按 resolved.scripts 循环；先查 novel_episodes 取 source_episode_id，再查 MAX(version_no)+1，再 UPDATE 同 novel_id+episode_number 的 is_active=0，再 INSERT 新行（version_no、script_type、title、summary、status='draft'、is_active=1）。
- **episode_scenes**：每 script.scenes 一条 INSERT，script_version_id、episode_number、scene_no、scene_title 等。
- **episode_shots**：每 scene.shots 一条 INSERT，script_version_id、scene_id、episode_number、shot_no、visual_desc 等。
- **episode_shot_prompts**：每 shot.prompts 一条 INSERT，shot_id、prompt_type、prompt_text 等。
- **version_no**：已处理，同集递增。
- **is_active**：同一 novel_id+episode_number 先全部置 0 再插入新 version 为 1。
- **事务**：整个 persist 在一个 `dataSource.transaction(async (manager) => { ... })` 内。
- **旧 active**：通过 UPDATE is_active=0 清理，不删历史 version。
- **character_visual_profiles**：当前 narrator 流程**不写入**；表已在 migration 与 resource 中存在，但 narrator 生成/持久化未包含该表。

---

# 5. Data Model Discovery

## 5.1 目标表现状

| Table | Exists? | Entity Exists? | Used By Current Flow? | Write Path Exists? | Notes |
|-------|---------|----------------|----------------------|--------------------|-------|
| episode_script_versions | 是 | 否（raw query） | 是（narrator persist + episode-script-version.service 读） | 是（NarratorScriptService.persistDraft） | migration 已建；CRUD 用 EpisodeScriptVersionService |
| episode_scenes | 是 | 否 | 是（narrator persist + episode-scene.service） | 是（narrator persist） | 同上 |
| episode_shots | 是 | 否 | 是（narrator persist + episode-shot.service） | 是（narrator persist） | 同上 |
| episode_shot_prompts | 是 | 否 | 是（narrator persist + episode-shot-prompt.service） | 是（narrator persist） | 同上 |
| character_visual_profiles | 是 | 未确认 | 是（resource 列表/编辑） | 仅 resource create/update，无生成写入 | 在 PIPELINE_RESOURCE_CONFIG 与 RESOURCE_CONFIG 中 |

## 5.2 参考表现状

| Table | Exists? | Read Path Exists? | Resource Config Exists? | Currently Used In Which Flow? | Notes |
|-------|---------|-------------------|-------------------------|-------------------------------|-------|
| drama_novels | 是 | 是（refContext + episode-script） | 否（非 resource 表名） | narrator（getContext novel）、episode-script |  |
| drama_source_text | 是 | 是（refContext.getTableBlock） | 否 | episode-script、narrator（若 requestedTables 含） |  |
| novel_adaptation_strategy | 是 | 是（EXTENDED_TABLE_CONFIG） | 否 | 两者（refContext） |  |
| novel_characters | 是 | 是 | 是（characters） | 两者 |  |
| novel_episodes | 是 | 是（refContext 核心三表） | 是（episodes） | 两者 |  |
| drama_structure_template | 是 | 是（核心三表） | 是（structure-templates） | 两者 |  |
| novel_hook_rhythm | 是 | 是（核心三表） | 是（hook-rhythms） | 两者 |  |
| novel_explosions | 是 | 是 | 是（explosions） | 两者 |  |
| novel_key_nodes | 是 | 是 | 是（key-nodes） | 两者 |  |
| novel_skeleton_topic_items | 是 | 是 | 是（skeleton-topic-items） | 两者 |  |
| novel_skeleton_topics | 是 | 是 | 是（skeleton-topics） | 两者 |  |
| novel_source_segments | 是 | 是（SourceRetrievalService + refContext） | 否 | episode-script、narrator（若 requested） |  |
| novel_timelines | 是 | 是 | 是（timelines） | 两者 |  |
| set_core | 是 | 是 | 是（payoff 等为 set_* 资源） | 两者 |  |
| set_opponent_matrix | 是 | 是 | 是（opponent-matrix） | 两者 |  |
| set_opponents | 是 | 是 | 是（opponents） | 两者 |  |
| set_payoff_arch | 是 | 是 | 是（payoff-arch） | 两者 |  |
| set_payoff_lines | 是 | 是 | 是（payoff-lines） | 两者 |  |
| set_power_ladder | 是 | 是 | 是（power-ladder） | 两者 |  |
| set_story_phases | 是 | 是 | 是（story-phases） | 两者 |  |
| set_traitor_stages | 是 | 是 | 是（traitor-stages） | 两者 |  |
| set_traitor_system | 是 | 是 | 是（traitor-system） | 两者 |  |
| set_traitors | 是 | 是 | 是（traitors） | 两者 |  |

（adaptation_modes 表在 EXTENDED_TABLE_CONFIG 中，无 novelId，params: []。）

---

# 6. Resource Framework Discovery

## 6.1 pipeline-resource.service 现状

- **Registry**：`RESOURCE_CONFIG` 在 pipeline-resource.service.ts 内，类型为 `Record<PipelineResourceName, ResourceConfig>`；每资源有 tableName、novelIdColumn、selectableFields、editableFields、orderBy 等。
- **已配置资源**：timelines、characters、key-nodes、explosions、episodes、structure-templates、hook-rhythms、skeleton-topics、skeleton-topic-items、payoff-arch、payoff-lines、opponent-matrix、opponents、power-ladder、traitor-system、traitors、traitor-stages、story-phases、**character-visual-profiles**。
- **Route/CRUD**：前端 route 为 `/projects/:novelId/pipeline/:resource`（PipelineResourceManagerPage）；后端 PipelineResourceController 提供 novels/:novelId/pipeline-resources/:resource 的 GET/POST；PipelineResourceService 提供 list、get、create、update、delete。
- **character_visual_profiles**：已接入 RESOURCE_CONFIG 与 PIPELINE_RESOURCE_CONFIG；表名 character_visual_profiles，novel_id、character_id 等字段；create/update 时校验 character_id 属于该 novel。

## 6.2 对本任务的判断

- **character_visual_profiles 是否应接入 resource framework**：**已接入**。适合继续作为「角色视觉设定」的 CRUD 与列表管理；与「脚本生成」解耦，不建议默认绑进 narrator 一次生成任务（与既有设计一致）。
- **episode_shot_prompts 是否应接入 resource framework**：**不建议**。当前为「按 shot 从属」的嵌套资源，由 episode-shot-prompt.service + episode-script-production 的 shot 下 prompts 接口管理更合适；若强行做成顶层 resource，与 script_version -> scene -> shot -> prompt 的层级不符。
- **episode_scenes / episode_shots**：应作为**生产层子结构**（按 script_version 或 scene 聚合），由现有 EpisodeSceneService、EpisodeShotService 与 REST 设计维护；不做成与 timelines/characters 同级的独立 resource 更清晰。

---

# 7. Prompt / Context Assembly Discovery

## 7.1 现有 prompt builder 位置

- **Episode-script**：`PipelineEpisodeScriptService.buildPrompt`（约 1920 行）、`buildReferenceBlocksOnly`、`buildReferenceBlock`；最终 prompt 为任务定义 + 生成规则 + 节奏模板 + JSON 契约 + 参考资料 blocks + 用户附加要求。
- **Narrator**：无独立 buildPrompt 方法；上下文由 `PipelineReferenceContextService.getContext` + `buildNarratorPromptContext` 得到世界观块，与 episode 行（在 generateNarratorScriptsWithLlm 内用 episodeMap/structureMap/hookMap 拼）一起组成 userPrompt。

## 7.2 现有上下文注入方式

- **Episode-script**：按 referenceTables 顺序对每表调用 buildReferenceBlock（内部对 SHARED_SERVICE_TABLE_NAMES 表走 refContext.getTableBlock），得到 block 数组，拼成「【参考资料】」+ blocks.join('\n\n')。
- **Narrator**：getContext 拉核心三表 + requestedTables（NARRATOR_DEFAULT_EXTENSION）的扩展表；buildNarratorPromptContext 将 optionalTables 格式化为「【label（tableName）】\nJSON」多段，带 charBudget 截断。

## 7.3 风险识别

- **一次性塞入过多表**：若 referenceTables 全选且无足够 charBudget，仍可能单 prompt 过大；episode-script 有 sourceTextCharBudget 与 120000 上限；narrator 有 WORLDVIEW_CHAR_BUDGET 与 optionalTablesCharBudget。
- **主参考 vs 二级**：核心三表（novel_episodes、drama_structure_template、novel_hook_rhythm）为必选主参考；set_core、novel_characters、set_payoff_* 等为常用扩展；novel_source_segments/drama_source_text 体量大，适合控制预算或由专门检索/摘要再注入。
- **专门 agent 预处理**：当前无独立「世界观/角色/冲突」预处理 agent；若后续做多阶段编排，可考虑 WorldBibleAgent/CharacterAgent 先产出压缩摘要再给 ScriptBuilderAgent。

---

# 8. Proposed Multi-Agent Mapping

（本节为 discovery 结论，不写代码。）

## 8.1 建议代理拆分

| Agent Name | Responsibility | Primary Inputs | Output Schema | Why This Split |
|------------|----------------|----------------|---------------|----------------|
| ContextPlanner | 聚合参考表、压缩为 context blocks | novelId、episodeNumbers、requestedTables、charBudget | PipelineReferenceContext | 已有 PipelineReferenceContextService 可对应；统一入口 |
| ScriptArchitect | 按批生成每集 script（version + scenes 骨架） | context、batch episodeNumbers、modelKey | NarratorScriptVersionDraft[]（或扩展） | 与当前 narrator 按批 LLM 一致，可显式命名为「编排阶段」 |
| ShotWriter | 基于 scenes 展开 shots + prompts | scenes、context 子集 | 同 NarratorScriptShotDraft | 可与 ScriptArchitect 合并为一轮 LLM 或拆为两轮 |
| QAReviewer | 校验 JSON、集数完整、scenes/shots 数量、必填字段 | draft | { ok, warnings, repaired? } | 可先做轻量校验，再扩展画面/质量规则 |

PlannerAgent / WorldBibleAgent / CharacterAgent / ConflictPayoffAgent 等命名可作为后续「多阶段编排」时的逻辑分层，当前代码尚未实现独立 agent 类；建议先保留「Context + Script + Shot + QA」四阶段编排，与任务描述一致。

## 8.2 每个代理应读取哪些表

- **ContextPlanner（等价 getContext）**：核心三表必读；扩展表按 requestedTables（narrator 默认 NARRATOR_DEFAULT_EXTENSION：set_core、set_payoff_arch、set_payoff_lines、set_opponents、set_power_ladder、set_story_phases、novel_characters、novel_key_nodes、novel_timelines 等）。
- **ScriptArchitect / ShotWriter**：不直接读表，消费 ContextPlanner 输出。
- **QAReviewer**：不读表，只读 draft 结构。

## 8.3 代理间数据交接

- **ContextPlanner → ScriptArchitect**：typed object `PipelineReferenceContext`（novel、episodes、structureTemplates、hookRhythms、optionalTables、meta）；或已序列化的 prompt 字符串（当前做法）。
- **ScriptArchitect → ShotWriter**：若拆成两阶段，应交接 typed scripts（含 scenes 与 shots 骨架），避免仅用自然语言传递集数/场景序号。
- **必须保留字段**：episodeNumber、sceneNo、shotNo、promptType、promptText、visualDesc、narratorText 等，与现有 DTO 一致，便于 persist 写入四表。

---

# 9. Gap Analysis

## 9.1 已有能力

- [x] **Prompt preview**：episode-script 有；narrator 无。
- [x] **Prompt override**：episode-script 有（allowPromptEdit + promptOverride）；narrator 无。
- [x] **Draft cache**：两者均有（draftId + TTL + limit）。
- [x] **Batch generation**：narrator 有（按 batchSize 分批 LLM）；episode-script 有（plan+batch 当 targetEpisodeCount > 10）。
- [x] **Versioned write**：narrator 有（version_no、is_active）；episode-script 写源表无 version。
- [x] **Active version switching**：narrator persist 时同集 is_active 先 0 再新 1；episode-script 不涉及。
- [x] **Resource framework**：有（PipelineResourceService + 前端 PIPELINE_RESOURCE_CONFIG），含 character_visual_profiles。
- [x] **Scene/shot writer**：narrator persist 写入 episode_scenes、episode_shots、episode_shot_prompts；CRUD 由 EpisodeSceneService、EpisodeShotService、EpisodeShotPromptService 提供。
- [x] **Character visual profile writer**：仅 resource 的 create/update，无「生成脚本时一并生成」。
- [ ] **QA loop**：episode-script 有 repair/validation 逻辑；narrator 无独立 QA 阶段。
- [x] **Typed intermediate schema**：NarratorScriptVersionDraft、SceneDraft、ShotDraft、ShotPromptDraft；EpisodePackage 等。
- [ ] **Progress reporting**：episode-script 有 generatingPhase、batchInfo；narrator 仅日志。
- [x] **Retry / repair loop**：episode-script 有 batch 重试与 repair；narrator 单批失败即抛。

## 9.2 缺失能力

| Capability | Missing? | Priority | Why Needed | Suggested Reuse / Insertion Point |
|------------|----------|----------|------------|------------------------------------|
| Narrator 侧 prompt preview | 是 | 高 | 与「每集纲要/剧本」体验一致 | 复用 PipelineEpisodeScriptDialog 的预览区逻辑，或新增 narrator preview API（返回 buildNarratorPromptContext 结果） |
| Narrator 侧参考表勾选 | 是 | 高 | 控制上下文体量与成本 | 前端传 requestedTables，后端 getContext 已支持；DTO 增加 requestedTables，默认 NARRATOR_DEFAULT_EXTENSION |
| Narrator 侧 prompt override | 是 | 中 | 高级用户微调 | 同 episode-script：allowPromptEdit + promptOverride 传 generate |
| Narrator 侧生成模式（快速/标准/严格） | 是 | 中 | 任务描述中的 QA 轮数 | 可在 DTO 增加 generationMode 或 qaRounds，后端在生成后做 0/1/2 轮校验与修正 |
| 输出目标表勾选（如 character_visual_profiles） | 是 | 低 | 任务要求默认不勾选 | 前端可选「同时生成角色视觉」并传参，后端单独分支写 character_visual_profiles |

---

# 10. Risks and Constraints

## 10.1 技术风险

- **61 集一次性生成**：narrator 已按批（默认 5 集/批），token/latency 风险已拆散；若用户把 batchSize 调很大或集数很多，单批 prompt 仍可能过大，需保留 charBudget 与批次上限。
- **单 prompt 过大**：PipelineReferenceContextService 有 optionalTablesCharBudget、perTableMaxChars；narrator 有 WORLDVIEW_CHAR_BUDGET；建议前端参考表勾选时带提示或默认子集。
- **参考表权重失衡**：当前无显式权重，按顺序拼接；若某表特别长可考虑单独上限或截断策略（已部分存在）。
- **批次一致性**：多批合并后按 episodeNumber 排序，风格一致性依赖同一 model 与同一 system prompt。
- **半成功半失败**：narrator 任一批失败即抛，无「部分 persist」；若要做部分落库需额外设计。
- **character_visual_profiles 与角色表同步**：若未来由生成写该表，需与 novel_characters 等对齐 character_id，避免悬空引用。
- **prompt preview 与执行不一致**：若用户编辑 prompt 后未再点预览，generate 用 override 与「上次预览」可能不一致；与 episode-script 相同，可接受。

## 10.2 数据风险

- **旧版本覆盖**：narrator 只做 is_active 切换与 INSERT 新 version，不删旧 version；episode-script 为 delete 再 insert 源表三表，会覆盖指定集数。
- **多批次写入顺序**：narrator 单次 persist 在一个事务内按 script 顺序写，无跨请求顺序问题。
- **外键**：episode_scenes.script_version_id、episode_shots.scene_id、episode_shot_prompts.shot_id 均在同一事务内用刚插入的 id，无外键风险。
- **历史数据缺列/空值**：migration 已建表；旧数据若缺列需迁移脚本，当前发现未涉及。

## 10.3 UI/交互风险

- **对话框参数过多**：若完全照搬 episode-script 的参考表 + 时长 + 模式 + 预算等，narrator 对话框会变复杂；可做「简版/高级」折叠或默认隐藏部分选项。
- **默认全勾选**：narrator 当前后端固定 NARRATOR_DEFAULT_EXTENSION；若前端开放勾选且默认全选，可能 prompt 过大；建议默认与 NARRATOR_DEFAULT_EXTENSION 一致并限制可选表。
- **用户编辑 prompt 后问题追踪**：与 episode-script 相同，可记录「是否使用了 override」便于排查。

---

# 11. Recommended Minimal-Intrusion Plan

## 11.1 前端建议

- **复用 vs 抽公共**：优先在 **episode-scripts 页面** 使用「类 PipelineEpisodeScriptDialog」的对话框组件（可抽成共享的 GenerateDraftDialog 或先复制再收口），包含：模型、参考表多选、集数范围、batchSize、prompt 预览区、允许编辑 prompt、生成/保存按钮；状态可放在 EpisodeScriptsPage 或上层。
- **episode-scripts 页面**：保留当前版本列表与「保存草稿」；将「生成旁白主导脚本初稿」从简易弹窗升级为**大对话框**（参考 PipelineEpisodeScriptDialog 布局），增加「刷新 Prompt 预览」、参考表勾选、prompt 文本框（只读/可编辑）。
- **API 层**：保留现有 narratorScriptApi.generateDraft、persistDraft；扩展 generateDraft 的 params 支持 `referenceTables?: string[]`、`promptOverride?: string`、`allowPromptEdit?: boolean`；若后端增加 narrator preview 接口，前端增加 `narratorScriptApi.previewPrompt(novelId, payload)`。

## 11.2 后端建议

- **Orchestrator**：不必须新建；保持 **NarratorScriptService** 为入口，内部已用 PipelineReferenceContextService；可增加「preview」方法返回 buildNarratorPromptContext 结果供前端展示。
- **Narrator 写库**：继续用现有 persistDraft（四表 + version_no + is_active）；**不**复用 PipelineEpisodeScriptService.persistDraft（那是三张源表）。
- **Resource framework**：character_visual_profiles 已接入，无需为 narrator 单独扩展；若未来「生成时顺带生成角色视觉」，可在 narrator 流程末尾调用单独 writer 或 resource create，且默认关闭。
- **DTO**：NarratorScriptGenerateDraftDto 增加可选 `referenceTables?: string[]`、`promptOverride?: string`、`allowPromptEdit?: boolean`；若实现 preview，增加 NarratorScriptPreviewDto 或复用同一 DTO 子集。

## 11.3 批处理建议

- **61 集切 batch**：已实现；按 startEpisode/endEpisode 与 targetEpisodeCount 得到集号列表，再按 batchSize 切批，每批调 LLM 一次，合并后排序。
- **每批 QA**：当前无；若做「标准/严格」模式，可在每批或合并后做一次 JSON/集数/必填字段校验，不合格可重试或标记。
- **先 draft 再 persist**：已为固定流程；不改为 generate 直接写库。
- **persist 策略**：当前为全量一次事务（同 novel 内涉及集数一起 UPDATE is_active + INSERT）；无需「分批落非激活再统一切 active」，除非未来支持「仅部分集数」激活。

---

# 12. Concrete Next-Step Blueprint Inputs

## 12.1 建议新增/修改文件清单

| File Path | Action | Reason |
|-----------|--------|--------|
| apps/web/src/components/production/EpisodeScriptsPage.tsx | modify | 将简易弹窗改为大对话框，增加参考表、prompt 预览、override、与后端新参数对接 |
| apps/web/src/components/production/NarratorGenerateDialog.tsx 或 pipeline/NarratorScriptDialog.tsx | create | 可选：抽成独立对话框组件，便于与 PipelineEpisodeScriptDialog 复用布局逻辑 |
| apps/web/src/lib/episode-script-api.ts | modify | narratorScriptApi 增加 previewPrompt（若后端有），generateDraft 增加 referenceTables、promptOverride、allowPromptEdit 等参数 |
| apps/web/src/types/episode-script.ts | modify | 增加 preview 请求/响应类型（若实现 preview） |
| apps/api/src/pipeline/dto/narrator-script.dto.ts | modify | NarratorScriptGenerateDraftDto 增加 referenceTables、promptOverride、allowPromptEdit；可选 NarratorScriptPreviewDto |
| apps/api/src/pipeline/narrator-script.service.ts | modify | generateDraft 支持 requestedTables（或 dto.referenceTables）、promptOverride；可选 previewPrompt 方法 |
| apps/api/src/pipeline/pipeline.controller.ts | modify | 可选：POST :novelId/narrator-script-preview-prompt |

## 12.2 建议新增 DTO 字段

| DTO | Field | Type | Required? | Purpose |
|-----|-------|------|-----------|---------|
| NarratorScriptGenerateDraftDto | referenceTables | string[] | 否 | 与 getContext requestedTables 一致，默认 NARRATOR_DEFAULT_EXTENSION |
| NarratorScriptGenerateDraftDto | promptOverride | string | 否 | 用户编辑后的全文，替代服务端拼的 prompt |
| NarratorScriptGenerateDraftDto | allowPromptEdit | boolean | 否 | 是否采用 promptOverride |
| （若做 preview） | - | - | - | 同上字段用于 preview 请求 |

## 12.3 建议新增中间类型

| Type Name | Layer | Purpose | Key Fields |
|-----------|--------|---------|------------|
| NarratorScriptPreviewResponse | api/frontend | 与 episode-script 对齐 | promptPreview、usedModelKey、referenceSummary、warnings、requestedTables |

---

# 13. Evidence Appendix

## 13.1 关键证据片段

- **apps/api/src/pipeline/narrator-script.service.ts**
  - 关键函数：generateDraft、persistDraft、getCachedDraft、generateNarratorScriptsWithLlm
  - 关键接口：CachedNarratorScriptDraft
  - 关键字段：draftCache (Map)、DRAFT_CACHE_TTL_MS、MAX_CACHED_DRAFTS
  - 关键调用：refContext.getContext、refContext.buildNarratorPromptContext；transaction 内 INSERT 四表
  - 结论：narrator 写生产层四表，带 version_no/is_active，有 draft cache。

- **apps/api/src/pipeline/pipeline-episode-script.service.ts**
  - 关键函数：previewPrompt、generateDraft、persistDraft、buildPrompt、buildReferenceBlock、deleteExistingEpisodeScriptData、insertEpisodePackage
  - 关键调用：buildReferenceBlock 内 SHARED_SERVICE_TABLE_NAMES 时 refContext.getTableBlock；persist 时 transaction(delete 三表 + insertEpisodePackage 三表)
  - 结论：episode-script 写源数据三表，无 version；参考表读取已部分委托 PipelineReferenceContextService。

- **apps/web/src/components/pipeline/PipelineEpisodeScriptDialog.tsx**
  - 关键：referenceTableOptions、模型/时长/模式/参考表/用户要求/allowPromptEdit/字体/刷新预览/Prompt 文本框/生成/写入
  - 结论：可作为 narrator 高级对话框的 UI 参考。

- **apps/web/src/components/production/EpisodeScriptsPage.tsx**
  - 关键：generateDialogOpen、generateParams（batchSize、modelKey、startEpisode、endEpisode）、handleGenerate 调 narratorScriptApi.generateDraft、handlePersist 调 persistDraft 并处理 NARRATOR_SCRIPT_DRAFT_CACHE_MISS
  - 结论：当前旁白生成为简易弹窗，无 preview、无参考表、无 override。

- **apps/api/src/pipeline/pipeline-resource.service.ts**
  - 关键：RESOURCE_CONFIG 含 character-visual-profiles；tableName=character_visual_profiles
  - 结论：character_visual_profiles 已接入 resource framework，仅 CRUD，无生成写入。

## 13.2 未确认项

| Question | Why It Matters | Where To Verify Next |
|----------|----------------|----------------------|
| 生产层四表是否有 TypeORM Entity 文件 | 若后续用 Repository 写，需确认是否建 Entity | apps/api/src/entities 目录及 TypeORM 配置 |
| character_visual_profiles 表是否在 run-production-migration 中执行 | 影响部署后表是否存在 | apps/api/scripts/run-production-migration.js 与 sql 引用 |
| episode-script 的 targetEpisodeCount 与 totalChapters 来源是否一致 | 前端传 totalChapters 作为 targetEpisodeCount | PipelinePanel 的 totalChapters 与 novel 接口 |

---

# 14. Final Recommendation

## Final Recommendation

- **推荐前端基座**：以 **PipelineEpisodeScriptDialog** 的交互与布局为基座，在 episode-scripts 页面（或统一入口）为「旁白主导脚本初稿」提供同级对话框：模型、参考表多选、集数范围、batchSize、Prompt 预览、允许编辑 Prompt、生成草稿、保存草稿；状态管理可放在 EpisodeScriptsPage 或抽成共享 hook。
- **推荐后端基座**：**NarratorScriptService** 继续作为旁白生成与生产层四表写入的唯一入口；扩展 generateDraft 支持 requestedTables（或 referenceTables）、promptOverride、allowPromptEdit；可选增加 previewPrompt（返回 buildNarratorPromptContext 结果），供前端「刷新 Prompt 预览」。
- **推荐复用的写库逻辑**：**NarratorScriptService.persistDraft**（episode_script_versions、episode_scenes、episode_shots、episode_shot_prompts、version_no、is_active、事务）；不复用 PipelineEpisodeScriptService.persistDraft（写的是三张源表）。
- **推荐资源读取基座**：**PipelineReferenceContextService**（getContext、getTableBlock、buildNarratorPromptContext）；narrator 已使用，仅需前端传入 requestedTables 覆盖默认 NARRATOR_DEFAULT_EXTENSION（若需要）。
- **推荐批处理策略**：维持当前「按 batchSize 分批 LLM、合并 scripts、单次 persist 事务写四表」；可选在合并后增加轻量 QA 校验（JSON、集数、必填字段），再 persist。
- **推荐质量检查策略**：先实现「生成后一次校验」（结构、集数、必填），不合格抛错或返回 warnings；「标准/严格」模式的多轮修正可后续迭代。
- **不建议采用的方案**：① 用 episode-script 的 persist 写生产层四表（因 episode-script 写的是 novel_episodes 等三表）；② 在 narrator 默认流程中绑定写入 character_visual_profiles（与当前「独立生成」设计不符）；③ 不做 prompt 预览与参考表勾选直接上多 agent（先统一 UI 与参数再扩展阶段）。
- **原因**：两套流程写库目标不同，复用写库逻辑必须选 narrator 的 persist；前端体验对齐「每集纲要/剧本」可降低学习成本；资源与参考表已集中在 PipelineReferenceContextService，扩展 DTO 即可支持可配置参考表与 override，侵入最小。

---

*Discovery 完成；未修改任何业务代码。*
