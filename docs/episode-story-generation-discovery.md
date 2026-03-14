# 生成完整故事（Episode Story Generation）Discovery

## 目标与范围

基于当前 main 分支真实代码的**只读分析**，为项目详情页「故事文本」Tab 实现「生成完整故事」高级对话框与后端多阶段故事生成链路提供依据；主写入 `episode_story_versions.story_text`，并设计 AI 检查按钮与最小侵入的进度提示方案。  
本轮**禁止改代码**，仅输出 discovery 报告。

---

## A. 当前「生成每集纲要和每集剧本」对话框是怎么实现的？

### A.1 前端入口

- **入口**：`apps/web/src/components/PipelinePanel.tsx`。Pipeline Tab 内有一处触发「生成每集纲要和每集剧本」的入口（如 Step 3 某模块的「生成」或专门按钮），调用 `handleOpenEpisodeScriptDialog`（约 923–958 行）打开对话框。
- **状态**：`episodeScriptDialogOpen`（boolean）控制对话框显隐；点击打开时设为 `true`，并清空 draft / warnings / referenceSummary 等，再拉模型列表、刷新 prompt 预览。

### A.2 对话框组件

- **组件**：`apps/web/src/components/pipeline/PipelineEpisodeScriptDialog.tsx`。
- **标题**：`生成每集纲要和每集剧本`（约 124 行）。
- **内容**：模型选择、每集时长模板（60s/90s）、生成模式（仅纲要 / 纲要+剧本 / 覆盖）、素材预算、参考数据多选、用户附加要求、允许编辑 Prompt 勾选、Prompt 预览/编辑区、参考摘要、草稿预览、批次状态、警告、写入前确认、底部「取消 / 生成草稿 / 确认写入数据库」按钮；生成中显示 `generatingPhase` 文案（约 396–416 行）。

### A.3 状态由谁管理

- **状态全部在 PipelinePanel**：`episodeScriptDialogOpen`、`episodeScriptModels`、`episodeScriptLoading`、`episodeScriptGenerating`、`episodeScriptPersisting`、`episodeScriptSelectedModelKey`、`episodeScriptDurationMode`、`episodeScriptGenerationMode`、`episodeScriptReferenceTables`、`episodeScriptUserInstruction`、`episodeScriptAllowPromptEdit`、`episodeScriptPromptPreview`、`episodeScriptFontSize`、`episodeScriptSourceTextCharBudget`、`episodeScriptReferenceSummary`、`episodeScriptDraft`、`episodeScriptWarnings`、`episodeScriptNormalizationWarnings`、`episodeScriptValidationWarnings`、`episodeScriptDraftId`、`episodeScriptGeneratingPhase`、以及 batch/count 相关 state（约 344–396 行）。Dialog 为纯展示 + 回调，无内部 state。

### A.4 preview / generate / persist 三段式 API 如何组织

- **Preview**：`pipelineEpisodeScriptApi.previewEpisodeScriptPrompt(novelId, payload)` → POST `/pipeline/:novelId/episode-script-preview-prompt`，Body 为 `PipelineEpisodeScriptRequest`（modelKey、referenceTables、userInstruction、allowPromptEdit、promptOverride、sourceTextCharBudget、durationMode、generationMode、targetEpisodeCount）。见 `apps/web/src/lib/pipeline-episode-script-api.ts` 与 `apps/api/src/pipeline/pipeline.controller.ts` 108–113 行。
- **Generate**：`pipelineEpisodeScriptApi.generateEpisodeScriptDraft(novelId, payload)` → POST `/pipeline/:novelId/episode-script-generate-draft`，同一 DTO 形态；返回含 `draftId`、`draft`、`referenceSummary`、warnings、batchInfo 等。见同上 API 文件与 controller 116–121 行。
- **Persist**：`pipelineEpisodeScriptApi.persistEpisodeScriptDraft(novelId, payload)` → POST `/pipeline/:novelId/episode-script-persist`，Body 为 `PipelineEpisodeScriptPersistPayload`（draftId 或 draft + generationMode）。见同上与 controller 124–129 行。

### A.5 referenceTables 如何传递

- **前端**：`episodeScriptReferenceTables` 状态，类型 `PipelineEpisodeScriptReferenceTable[]`；默认值 `defaultEpisodeScriptReferenceTables`（PipelinePanel 164–176 行），包含 drama_novels、novel_source_segments、novel_adaptation_strategy、adaptation_modes、set_core、novel_timelines、novel_characters、novel_key_nodes、novel_explosions、novel_skeleton_topics、novel_skeleton_topic_items 等。Dialog 内通过 `referenceTableOptions` 多选，`onToggleReferenceTable` 回调更新 state；preview/generate 请求中一并传 `referenceTables`。

### A.6 promptOverride / allowPromptEdit 如何生效

- **allowPromptEdit**：勾选后 Prompt 预览区变为可编辑 textarea；`onChangePromptPreview` 更新 `episodeScriptPromptPreview`。
- **promptOverride**：在调用 preview/generate 时，若 `allowPromptEdit && episodeScriptPromptPreview.trim()` 则把 `episodeScriptPromptPreview` 作为 `promptOverride` 传往后端；后端在 `PipelineEpisodeScriptService.buildPrompt` 得到系统 prompt 后，若 DTO 带 `promptOverride` 则**直接使用 promptOverride 作为最终发往 LLM 的 prompt**（见 pipeline-episode-script.service.ts 约 390–393 行），不再用自动拼接的 prompt。

### A.7 draft cache 如何工作

- **后端**：`PipelineEpisodeScriptService` 内 `draftCache: Map<string, CachedEpisodeScriptDraft>`（约 247 行），TTL 30 分钟、最多 50 条；`generateDraftId()` 用 `randomUUID()`；`cacheDraft(draftId, entry)` 在 generate 成功后写入；`getCachedDraft(draftId)` 读取时校验 TTL，过期则删除并返回 null。persist 时优先用 `dto.draftId` 取 cache，命中则用 cache 的 draft，未命中且带 `dto.draft` 则用 payload 的 draft，否则抛 `EPISODE_SCRIPT_DRAFT_CACHE_MISS`。
- **前端**：generate 返回 `draftId` 后存到 `episodeScriptDraftId`；persist 时若有 `episodeScriptDraftId` 则优先只传 `draftId`+generationMode（轻量）；若后端返回 cache miss 且前端仍有 `episodeScriptDraft`，则 fallback 为传完整 `draft`（PipelinePanel 约 1097–1162 行）。

### A.8 后端是否已有多阶段编排逻辑可借鉴

- **有**。`PipelineEpisodeScriptService.generateDraft` 在 `targetEpisodeCount > PLAN_BATCH_THRESHOLD`（10）且未使用 promptOverride 时走 `generateDraftMultiStage`（约 346–355 行）：  
  - **Stage A Plan**：用精简参考层（PLAN_LAYERS）调用 LLM 得到每集骨架规划，可 repair 缺集。  
  - **Stage B Batches**：按批（PLAN_BATCH_SIZE=5）生成，每批带 plan 摘要 + 静态/动态参考块 + 可选 evidence（novel_source_segments）；单批可重试、可 repair。  
  - **Stage C Merge**：合并批次结果，validate/normalize。  
  - **Stage D Final**：缺集补生、算 finalCompletenessOk、写 cache、返回 draftId + draft。  
- 可直接借鉴：**「先全局规划再分批正文」**、参考表分层（plan 用少表、batch 用多表）、draft cache + persist 解耦、preview/generate/persist 三个端点。

### A.9 哪些代码可以直接复用到「生成完整故事」

- **前端**：PipelinePanel 内「打开对话框 → 拉模型 → 刷新 preview → generate → persist」的流程结构；PipelineEpisodeScriptDialog 的布局与表单单列（模型、参考多选、用户说明、allowPromptEdit、Prompt 预览、草稿/状态、取消/生成/写入）可整体仿制为「生成完整故事」对话框。  
- **后端**：`PipelineReferenceContextService.getContext`、`buildNarratorPromptContext` / `buildReferenceSummary` 等可复用；核心三表 `CORE_REFERENCE_TABLES`（novel_episodes、drama_structure_template、novel_hook_rhythm）与扩展表配置已存在；`PipelineEpisodeScriptService` 的 draftCache 模式、generateDraftId/cacheDraft/getCachedDraft、以及 persist 时 draftId 优先、cache miss 用 payload 的 fallback 逻辑可直接套用到「故事 draft」。  
- **API 风格**：preview / generate-draft / persist 三端点 + 统一 Request（modelKey、referenceTables、userInstruction、allowPromptEdit、promptOverride、sourceTextCharBudget 等）可照搬为 story 的 preview / generate-draft / persist。

---

## B. 当前 episode_story_versions 的真实现状

### B.1 表已有哪些字段

- 见 `apps/api/sql/20260314_create_episode_story_versions.sql`：  
  id, novel_id, episode_number, source_episode_id, version_no, story_type, title, summary, story_text, story_beat_json, word_count, status, is_active, generation_source, notes, created_at, updated_at。  
- 其中 **story_text LONGTEXT NOT NULL** 为本集完整连续短剧故事正文；**story_beat_json JSON NULL** 可存节拍；**word_count** 便于统计。

### B.2 后端已有哪些 CRUD

- **Service**：`EpisodeStoryVersionService`（`apps/api/src/pipeline/episode-story-version.service.ts`）：listByNovel、getByNovelAndEpisode、getActiveByNovelAndEpisode、getOne、create、update、setActive、remove。  
- **Controller**：`EpisodeStoryVersionController`（`apps/api/src/pipeline/episode-story-version.controller.ts`）：GET novels/:novelId/episode-story-versions、GET .../:episodeNumber、GET .../:episodeNumber/active；POST novels/:novelId/episode-story-versions；PATCH/DELETE episode-story-versions/:id；POST episode-story-versions/:id/set-active。  
- **DTO**：`CreateEpisodeStoryVersionDto`、`UpdateEpisodeStoryVersionDto`（`apps/api/src/pipeline/dto/episode-story-version.dto.ts`），含 episodeNumber、sourceEpisodeId、versionNo、storyType、title、summary、**storyText**、storyBeatJson、wordCount、status、isActive、generationSource、notes。

### B.3 是否已有前端展示/编辑入口

- **无**。当前前端仅「故事文本」Tab 内有一个按钮「生成完成故事」（`StoryTextPanel`），点击仅 console.log，**没有任何对 episode_story_versions 的列表/详情/编辑或对生成链路的调用**。  
- 未发现 `episode-story-version`、`episodeStoryVersion`、`story_version` 等在前端被引用（grep 结果为空）。

### B.4 version_no / is_active 如何处理

- **version_no**：create 时若 DTO 未传 versionNo，则 `getNextVersionNo(novelId, episodeNumber)` 取 `COALESCE(MAX(version_no),0)+1`；同集递增。  
- **is_active**：create 时 isActive 默认 1；若为 1 则先 `deactivateOthersForEpisode`（同集其余 is_active=0），再 INSERT 新行 is_active=1。update/setActive 时同样先 deactivate 再设当前 id 为 1。与 episode_script_versions 一致。

### B.5 是否已具备直接接入 generate/persist 的基础

- **表与 CRUD 已就绪**：可直接在「生成完整故事」链路中，对每一集（或每批）生成得到 story_text 后，调用 `EpisodeStoryVersionService.create(novelId, { episodeNumber, storyType: 'story_text', title, summary, storyText, ... })` 写入；version_no/is_active 由 service 内部处理。  
- **尚无**：与「故事生成」相关的 preview/generate-draft/persist 三个 pipeline 端点、以及前端对话框与 state、draft cache 均未实现，需要新增并仿照 episode-script 的模式接入。

---

## C. 「生成完整故事」功能的最小侵入实现方式

### C.1 如何弹出类似 PipelineEpisodeScriptDialog 的高级对话框

- **建议**：在「故事文本」Tab 所在组件内管理对话框显隐与状态；Tab 当前由 `ProjectDetail` 渲染为 `StoryTextPanel`（`apps/web/src/components/story-text/StoryTextPanel.tsx`），**不经过 PipelinePanel**。  
  - **方案 A**：在 `StoryTextPanel` 内增加 state（如 `storyGenerateDialogOpen`）、「生成完整故事」按钮点击时设 `true`，并渲染一个**新的**「生成完整故事」对话框组件（仿 PipelineEpisodeScriptDialog），所有 state 放在 StoryTextPanel（或父级 ProjectDetail 若希望与 Pipeline 同层）。  
  - **方案 B**：把「生成完整故事」入口放到 PipelinePanel 内（与「生成每集纲要和每集剧本」并列），复用同一套「拉模型、参考表、preview」的页面结构，仅 API 与 draft 结构不同。  
- **最小侵入**：**方案 A** 更符合「故事文本 Tab 独立入口」的产品位置，且不改动 PipelinePanel 的复杂 state 树；新对话框组件可放在 `apps/web/src/components/story-text/` 下，例如 `StoryGenerateDialog.tsx`，由 StoryTextPanel 引入并传入 props/回调。

### C.2 应新增哪些前端 state

- 建议至少：`storyGenerateDialogOpen`、`storyModels`、`storyLoading`、`storyGenerating`、`storyPersisting`、`storySelectedModelKey`、`storyReferenceTables`、`storyUserInstruction`、`storyAllowPromptEdit`、`storyPromptPreview`、`storySourceTextCharBudget`、`storyReferenceSummary`、`storyDraft`（结构见下）、`storyDraftId`、`storyWarnings`、`storyGeneratingPhase`（进度文案）；若支持按集/按批则可有 `storyTargetEpisodeCount`、`storyActualEpisodeCount`、`storyBatchInfo` 等。  
- 与 episode-script 对齐的命名与类型便于后续复用类型与逻辑。

### C.3 应新增哪些后端 API

- **Preview**：POST `/pipeline/:novelId/episode-story-preview-prompt`，Body：modelKey、referenceTables、userInstruction、allowPromptEdit、promptOverride、sourceTextCharBudget、targetEpisodeCount（可选）。返回：promptPreview、usedModelKey、referenceSummary、warnings。  
- **Generate draft**：POST `/pipeline/:novelId/episode-story-generate-draft`，Body 同 preview 并可扩展（如 batchSize）。返回：draftId、draft（见下）、referenceSummary、warnings、batchInfo、generatingPhase 等；draft 建议为 `{ episodes: { episodeNumber, title?, summary?, storyText }[] }` 或与现有 episode_story_versions 单条结构一致以便 persist。  
- **Persist**：POST `/pipeline/:novelId/episode-story-persist`，Body：draftId 或 draft + 可选 generationMode。后端解析 draft 后按集调用 `EpisodeStoryVersionService.create` 写入 episode_story_versions（主写 story_text、title、summary、word_count 等），或封装为「故事 persist 事务」一次写多集。  
- **AI 检查（可选本轮只读）**：POST `/pipeline/:novelId/episode-story-check`，Body：待检查内容（draftId 或 draft 或已存 version ids）；返回检查报告（见 G 节）。

### C.4 preview / generate / persist 是否也应采用三段式

- **建议采用**。与 episode-script、worldview 一致，便于用户先看 prompt 再生成、再确认写入；且后端可复用「preview 只拼 prompt 不调 LLM / generate 调 LLM 并写 cache / persist 从 cache 或 payload 写库」的分工，降低单次请求复杂度与超时风险。

### C.5 是否建议先做 draft cache，再 persist 到 episode_story_versions

- **建议先做 draft cache 再 persist**。理由：  
  - 与 episode-script 一致，前端可「生成草稿 → 审阅/编辑（若开放）→ 再点写入」；  
  - 大集数（如 61 集）生成耗时长，draft 存服务端 cache，避免重复生成；  
  - persist 时可用 draftId 轻量提交，或 cache 过期时用全量 draft 兜底；  
  - 写入目标为现有 `EpisodeStoryVersionService.create`，无需新表；persist 逻辑可以是「按 draft.episodes 循环，每集一条 create(novelId, { episodeNumber, title, summary, storyText, storyType: 'story_text', ... })」，并在同一事务内保证「同集 version_no / is_active」由现有 service 或上层事务协调。

---

## D. 参考表如何分层

### D.1 核心参考（始终包含）

- 与现有 pipeline 一致，以下三张为**核心参考（始终包含）**，不交给用户勾选，参与所有 story 相关接口的 getContext：  
  - **novel_episodes**  
  - **drama_structure_template**  
  - **novel_hook_rhythm**  
- 定义见 `apps/api/src/pipeline/pipeline-reference-context.service.ts` 的 `CORE_REFERENCE_TABLES`（第 6–10 行）。

### D.2 扩展参考（可多选）

- 以下表作为**扩展参考（可多选）**，由用户在「生成完整故事」对话框内多选，通过 `referenceTables` 传入后端；后端 getContext 时 `requestedTables = [核心三表] + referenceTables`（或等价逻辑）：  
  drama_novels, drama_source_text, novel_adaptation_strategy, novel_characters, novel_explosions, novel_key_nodes, novel_skeleton_topic_items, novel_skeleton_topics, novel_source_segments, novel_timelines, set_core, set_opponent_matrix, set_opponents, set_payoff_arch, set_payoff_lines, set_power_ladder, set_story_phases, set_traitor_stages, set_traitor_system, set_traitors。  
- 其中 **adaptation_modes** 在 EXTENDED_TABLE_CONFIG 中存在且无 novelId，若 story 生成需要也可加入扩展列表；当前 episode-script 的 allowedEpisodeScriptReferenceTables 包含 adaptation_modes（见 pipeline-episode-script.dto.ts）。

### D.3 UI 是否默认全部勾选

- **不建议默认全部勾选**。理由：novel_source_segments、drama_source_text 等体量大，一次性全进 prompt 易超 token、拉长时延且增加 JSON/文本生成失败率；与 narrator-pipeline-upgrade-discovery 结论一致。  
- 建议：**核心三表**在 UI 上仅展示为「核心参考（始终包含）」只读说明；**扩展参考**默认勾选保守子集（例如 set_core、novel_characters、novel_key_nodes、novel_timelines、set_payoff_arch、set_payoff_lines、set_story_phases），**不默认勾选** novel_source_segments、drama_source_text；用户可手动勾选并知悉可能增加耗时与失败率。

### D.4 后端是否应一次性全拼进一个大 prompt

- **不应**。建议与 episode-script 多阶段一致：  
  - **Context Planner / Story Planner** 阶段可用核心三表 + 少量扩展表（如 set_core、novel_episodes 摘要），产出「每集故事要点/节拍」或轻量规划；  
  - **Story Writer** 阶段按批（如每批 3–5 集）生成正文时，再按批注入该批所需参考（含可选 novel_source_segments 等），并严格控制每批 token 预算（如 sourceTextCharBudget、optionalTablesCharBudget）。  
- 这样避免单次 61 集 × 全表的大 prompt。

### D.5 哪些表应被不同子步骤先压缩再传给主生成代理

- **novel_source_segments**、**drama_source_text**：建议仅在「按批写作」时按批或按集做检索/截断（类似 episode-script 的 buildBatchEvidenceBlock、getDramaSourceTextBlock），**不**整表一次性塞入；可选「先压缩成摘要/关键句」再进 prompt。  
- **set_payoff_arch / set_payoff_lines / set_opponents 等**：若单表行数多，可用 perTableMaxChars 或现有 trim 逻辑做字段级截断后再拼进对应阶段。  
- **novel_episodes**：核心表，通常行数=集数，可直接用于规划与分集对齐；若单集 full_content/outline 很长，可对单集做长度截断。

### D.6 novel_source_segments / drama_source_text 是否应默认直接进入 story generation prompt

- **不应默认直接进入**。建议默认不勾选；若用户勾选，则仅在「分批写作」阶段按批/按集按预算注入，并明确在 UI 提示「大表可能增加耗时与失败率」。

---

## E. 5 个代理模块如何落地

采用**可控分阶段流水线**（非开放式 swarm），固定以下 5 个职责模块：

### E.1 Context Planner

- **输入**：novelId、referenceTables（含核心三表 + 用户选扩展表）、sourceTextCharBudget、可选 startEpisode/endEpisode。  
- **输出**：结构化「参考摘要」或「本剧故事上下文块」（供后续 Planner/Writer 使用），例如各表 rowCount、关键字段摘要、压缩后的世界观/人物/节奏描述。  
- **落地**：可复用 `PipelineReferenceContextService.getContext` + `buildNarratorPromptContext` 或专用 `buildStoryContextBlock`；可作为**独立步骤**在 generateDraft 开头执行一次，输出不写库，仅作后续步骤输入。  
- **是否单独 service**：不必单独新 service，在「故事生成 Service」内调用现有 pipeline-reference-context 即可。

### E.2 Story Planner

- **输入**：Context Planner 输出、targetEpisodeCount、用户 userInstruction。  
- **输出**：每集轻量规划，例如 episodeNumber、title、summary、storyBeat（目标/转折/尾钩等），**不**含完整 story_text。  
- **落地**：单次 LLM 调用，要求输出 JSON 数组（与 episode-script 的 plan 阶段类似）；可 repair 缺集。  
- **是否合并**：可与 Context Planner 合并为「规划阶段」一个方法（先 getContext，再 buildPlanPrompt，再 callLcAiApi），也可拆成两个方法便于测试与扩展。  
- **不写库**：仅产出内存中的 plan 结构。

### E.3 Story Writer

- **输入**：Story Planner 输出、Context 块、当前批次的 episode 范围、参考表与预算。  
- **输出**：该批次每集的 **story_text**（完整连续故事正文）、可选 title/summary。  
- **落地**：按批（如 3–5 集一批）调用 LLM，每批 prompt 含 plan 摘要 + 该批参考块；多批结果合并为 draft.episodes[]。  
- **不直接写库**：输出进入 draft cache（draftId + draft）；**真正写库在 Persist 步骤**。

### E.4 Story QA Checker

- **输入**：draft（或已写入的 episode_story_versions 的 id 列表）+ 可选参考表（核心+扩展）。  
- **输出**：检查报告：总评分、逐集问题列表、建议修复方向（如「第 3 集与提纲冲突」「第 5 集缺尾钩」）；**不自动改内容**。  
- **落地**：单独 API（如 POST episode-story-check），一次 LLM 或规则+LLM 混合，返回结构化报告。  
- **是否单独**：建议单独接口与单独方法，便于「只检查不修复」与后续扩展「检查后定点修复」。

### E.5 Story Repair Agent

- **输入**：QA Checker 报告 + draft（或指定 episode 的 story version id）+ 可选参考表。  
- **输出**：修复后的 story_text（或仅被指出的集）。  
- **落地**：可按「逐集修复」调用 LLM，或按批修复；写回时可通过 EpisodeStoryVersionService.update 更新已有 version，或生成新 version（version_no+1、is_active 由 service 处理）。  
- **本轮建议**：Discovery 只设计职责与 I/O；实现可放在「先上线生成+检查」之后，再迭代「定点修复」。

### E.6 哪一步真正写入 episode_story_versions.story_text

- **Persist 步骤**：在用户点击「确认写入数据库」后，后端从 draftId 或 payload.draft 解析出每集 story_text（及 title、summary 等），**按集调用 `EpisodeStoryVersionService.create(novelId, dto)`** 写入；或在一个事务内循环 create，保证要么全成功要么回滚。  
- **Story Writer** 只负责产出 draft，不直接写库；**只有 Persist 会写 episode_story_versions.story_text**。

---

## F. 是否支持一次性生成 61 集

### F.1 一次性 61 集是否适合单次大 prompt

- **不适合**。61 集 × 每集数百到数千字 story_text，单次 prompt+单次生成易超模型 context、超时、且 JSON/长文质量难控，与 narrator 单链路大 prompt 问题类似。

### F.2 是否必须分批

- **建议必须分批**。与 episode-script 的 plan + batch 一致：先 **Story Planner** 产出 61 集骨架，再 **Story Writer** 按批（如每批 3–5 集）生成正文，每批一次 LLM 调用，最后合并为 draft。

### F.3 批次建议大小

- 建议 **每批 3–5 集**（与 PLAN_BATCH_SIZE=5 对齐）；可配置为 batchSize，默认 5；若单集目标字数很大可再缩小到 2–3。

### F.4 61 集如何保持连续性

- **Plan 先行**：Story Planner 输出 61 集统一规划（每集 title、summary、storyBeat），Writer 每批生成时 prompt 中带入「上一批最后一集摘要/尾钩」和「本批集号与规划」，减少断档。  
- **上下文注入**：每批 prompt 除本批 plan 外，可包含「前一批最后一集的 summary 或结尾句」作为 continuity 提示。  
- **未确认**：是否在 schema 中显式存「上一集 tail_sentence」等字段由实现阶段定。

### F.5 是否需要「先全局规划，再分批正文写作」

- **需要**。与 episode-script 的 generateDraftMultiStage 一致：先 **Story Planner**（全局规划），再 **Story Writer**（分批正文），再合并、校验、cache、返回 draft。

### F.6 怎样避免每集像独立摘要而不是连续故事

- **Prompt 约束**：在 Writer 的 system/user prompt 中明确要求「本集开头需与上一集结尾衔接」「保持人物状态与时间线连续」。  
- **Plan 约束**：Planner 输出中每集含「与上集衔接点」「本集开场状态」，Writer 按此生成。  
- **可选**：在 QA Checker 中增加「连续性」维度，对「与上集/下集衔接」打分或标问题，供后续 Repair 或人工修改。

---

## G. AI 检查按钮如何设计

### G.1 对话框中 AI 检查按钮放在哪里

- 建议放在「生成完整故事」对话框内、**草稿预览区域下方**或**与「生成草稿」「确认写入」并列**：例如「生成草稿 | AI 检查 | 确认写入数据库」。  
- 「AI 检查」仅在已有 draft（或已选中的已存 story versions）时可用；点击后调 POST episode-story-check，展示检查报告区域（总评分、逐集问题、建议）。

### G.2 检查输入是否也要参考核心表 + 扩展表

- **建议要**。检查时需判断「故事与提纲/结构/节奏是否一致」「人物与设定是否一致」，因此检查请求应带 referenceTables（或复用当前对话框已选 referenceTables），后端 getContext 后拼入检查 prompt，与生成时一致。

### G.3 检查输出格式如何设计

- 建议结构化：  
  - **总评分**：如 score 0–100，或 passed: boolean。  
  - **逐集问题**：数组 `{ episodeNumber, issues: { type, message, severity }[] }`。  
  - **建议修复**：数组 `{ episodeNumber?, suggestion }` 或按问题类型的通用建议。  
- 类型可定义为 `StoryCheckReportDto`：overallScore、passed、episodeIssues、suggestions、warnings。

### G.4 是否建议先只做检查，不做自动修复

- **建议先只做检查，不做自动修复**。首轮实现「AI 检查」仅返回报告，由用户根据报告人工改 draft 或后续再点「定点修复」；避免首轮逻辑过重与修复质量不可控。

### G.5 后续如何扩展为「检查后定点修复」

- 后续可增加「按集修复」入口：用户勾选报告中的若干集 → 点击「定点修复」→ 后端对选中集调用 Story Repair Agent，用 QA 报告中的问题 + 当前 story_text + 参考表再生成一版，写回方式为 update 该集当前 active version 或 create 新 version。

---

## H. 进度提示怎么做最小侵入

### H.1 只有 loading 文案

- 实现简单，但 61 集分批时用户无法感知阶段，体验一般。

### H.2 阶段状态文案

- 与当前 episode-script 一致：在请求进行中显示「正在生成全集规划…」「正在分批生成（Batch 1/13）…」「正在合并与校验…」。  
- **实现**：后端在 generate-draft 同步流中无法推中间状态，可像 episode-script 一样由**前端用定时器模拟阶段推进**（如 15s 显示规划、25s 显示第一批…），或后端在长时间 generate 中通过 Server-Sent Events 推送 phase（需改协议）。  
- **最小侵入**：**仅前端阶段状态文案 + 定时器估算**，无需后端改协议，与现有 `episodeScriptGeneratingPhase` 一致（PipelinePanel 894–906 行、PipelineEpisodeScriptDialog 396–416 行）。

### H.3 进度条 + 阶段状态

- 若后端不返真实进度，进度条只能前端估算（如按批数/总批数），与「阶段状态文案」信息量类似，略增 UI 复杂度。  
- 可作为可选增强，非最小必需。

### H.4 task 轮询

- 后端改为「创建 task → 异步执行多阶段 → 前端轮询 task 状态」可得到真实 phase 与进度，但需要 task 表与轮询 API，侵入大。  
- 与 narrator-pipeline-upgrade-discovery 结论一致：当前项目无 task 基础设施时，不首选。

### H.5 推荐方案

- **推荐**：**阶段状态文案 + 前端定时器估算**（与 episode-script 一致）。  
- 具体：点击「生成草稿」后，前端设 `storyGeneratingPhase`，用 setInterval/setTimeout 按预估时间切换「正在生成全集规划…」「正在分批生成（第 1–5 集）…」…「正在合并与校验…」；请求返回后清空 phase。  
- 若未来引入异步 task，再改为轮询 task 的 currentPhase/percent。

---

## I. 文件级改动清单

### 必须修改

- `apps/web/src/components/story-text/StoryTextPanel.tsx`：增加「生成完整故事」对话框显隐 state、按钮点击打开对话框；接入新 API（preview/generate/persist）与进度文案。  
- `apps/api/src/pipeline/pipeline.controller.ts`：新增 POST `:novelId/episode-story-preview-prompt`、`:novelId/episode-story-generate-draft`、`:novelId/episode-story-persist`（及可选 `:novelId/episode-story-check`）。  
- `apps/api/src/pipeline/pipeline.module.ts`：若新建 StoryGenerationService 或 EpisodeStoryGenerationService，需在 providers 中注册并在 controller 中注入。

### 建议新增

- `apps/web/src/components/story-text/StoryGenerateDialog.tsx`：仿 PipelineEpisodeScriptDialog 的「生成完整故事」对话框（模型、参考表、用户说明、allowPromptEdit、Prompt 预览、草稿/批次状态、AI 检查按钮、取消/生成草稿/确认写入）。  
- `apps/web/src/lib/episode-story-api.ts`（或 pipeline-episode-story-api.ts）：previewEpisodeStoryPrompt、generateEpisodeStoryDraft、persistEpisodeStoryDraft、可选 checkEpisodeStory。  
- `apps/web/src/types/episode-story.ts`（或 pipeline 中扩展）：PipelineEpisodeStoryRequest、PipelineEpisodeStoryDraft、PipelineEpisodeStoryPersistPayload、PipelineEpisodeStoryCheckReport 等。  
- `apps/api/src/pipeline/episode-story-generation.service.ts`（或 pipeline-episode-story.service.ts）：previewPrompt、generateDraft（内部分阶段：context → plan → batch write）、persistDraft（draftId/draft → EpisodeStoryVersionService.create 循环）、可选 check。  
- `apps/api/src/pipeline/dto/episode-story-generation.dto.ts`（或 pipeline-episode-story.dto.ts）：PreviewDto、GenerateDraftDto、PersistDto、CheckDto、响应 DTO。

### 明确不改

- `apps/api/src/pipeline/episode-story-version.service.ts`、`episode-story-version.controller.ts`、`dto/episode-story-version.dto.ts`：仅被「生成故事」链路在 persist 时调用 create，不改变其 CRUD 接口与表结构。  
- `apps/api/src/pipeline/narrator-script.service.ts`、episode-script 四表 persist 逻辑、`pipeline-episode-script.service.ts` 的 episode-script 专用逻辑：不删不改。  
- `apps/api/sql/20260314_create_episode_story_versions.sql`、production layer 表结构：不删不改。  
- `apps/web/src/components/ProjectDetail.tsx`：仅保证「故事文本」Tab 仍渲染 StoryTextPanel；若 StoryTextPanel 内部新增对话框不需改 ProjectDetail。  
- `apps/web/src/components/PipelinePanel.tsx`、`PipelineEpisodeScriptDialog.tsx`：不改为「故事」服务，仅作参考实现。

---

## J. 下一步 Blueprint 输入

### J.1 推荐 API 清单

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /pipeline/:novelId/episode-story-preview-prompt | 预览故事生成 prompt |
| POST | /pipeline/:novelId/episode-story-generate-draft | 多阶段生成故事草稿，返回 draftId + draft |
| POST | /pipeline/:novelId/episode-story-persist | 将 draftId 或 draft 写入 episode_story_versions |
| POST | /pipeline/:novelId/episode-story-check | （可选）AI 检查 draft 或已存 story versions，返回报告 |

### J.2 推荐 DTO 字段

- **Preview / Generate 请求**：modelKey?, referenceTables, userInstruction?, allowPromptEdit?, promptOverride?, sourceTextCharBudget?, targetEpisodeCount?, batchSize?。  
- **Preview 响应**：promptPreview, usedModelKey, referenceTables, referenceSummary, warnings?.  
- **Generate 响应**：draftId, usedModelKey, promptPreview?, referenceSummary?, draft: { episodes: { episodeNumber, title?, summary?, storyText }[] }, targetEpisodeCount?, actualEpisodeCount?, countMismatchWarning?, warnings?, batchInfo?, finalCompletenessOk?, repairSummary?.  
- **Persist 请求**：draftId? | draft?, generationMode?.  
- **Persist 响应**：ok: true, summary: { scriptVersions: number, episodeNumbers: number[] }, warnings?.  
- **Check 请求**：draftId? | draft? | versionIds?; referenceTables?。  
- **Check 响应**：overallScore, passed, episodeIssues: { episodeNumber, issues: { type, message, severity }[] }[], suggestions[], warnings?。

### J.3 推荐前端 state 清单

- storyGenerateDialogOpen, storyModels, storyLoading, storyGenerating, storyPersisting, storySelectedModelKey, storyReferenceTables, storyUserInstruction, storyAllowPromptEdit, storyPromptPreview, storySourceTextCharBudget, storyReferenceSummary, storyDraft, storyDraftId, storyWarnings, storyGeneratingPhase, storyTargetEpisodeCount, storyActualEpisodeCount, storyBatchInfo, storyFinalCompletenessOk, storyCheckReport（若做 AI 检查）。

### J.4 推荐服务方法清单

- **EpisodeStoryGenerationService**（或 PipelineEpisodeStoryService）：previewPrompt(novelId, dto), generateDraft(novelId, dto), persistDraft(novelId, dto), check(novelId, dto)?  
- 内部：buildContextBlocks, buildPlanPrompt, runPlanner, splitBatches, runWriterBatch, mergeDraft, validateDraft, cacheDraft, getCachedDraft, resolveDraftForPersist, persistToStoryVersions（循环 EpisodeStoryVersionService.create）。  
- **PipelineReferenceContextService**：复用 getContext、buildNarratorPromptContext / buildReferenceSummary 或新增 buildStoryContextBlock。  
- **EpisodeStoryVersionService**：仅调用现有 create、getByNovelAndEpisode、getActiveByNovelAndEpisode。

### J.5 推荐实施顺序

1. **Blueprint**：细化 API 路径、DTO 字段、前端 state、多阶段步骤与错误处理。  
2. **后端 DTO + 三端点占位**：episode-story-preview-prompt、episode-story-generate-draft、episode-story-persist 返回占位或最小实现；EpisodeStoryGenerationService 注入与路由注册。  
3. **后端 Context + Planner**：getContext + Story Planner 单次 LLM，输出 plan 结构，不写库。  
4. **后端 Writer + Merge + Cache**：按批 Writer、合并、validate、cacheDraft，generateDraft 返回 draftId + draft。  
5. **后端 Persist**：从 draftId/draft 解析，循环 EpisodeStoryVersionService.create，写 episode_story_versions。  
6. **前端对话框 + state + API 对接**：StoryGenerateDialog、StoryTextPanel state、episode-story-api 三接口、进度阶段文案（前端定时器）。  
7. **AI 检查（可选）**：POST episode-story-check、CheckReport 展示、不自动修复。  
8. **Story Repair Agent（可选）**：检查后定点修复与写回。

---

*Discovery 基于 main 分支现状，仅读代码未做任何修改。*
