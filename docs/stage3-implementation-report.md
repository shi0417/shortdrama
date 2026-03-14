# Stage 3 Implementation Report

## Task

基于 `docs/discovery.md` 与 `docs/blueprint.md`，将 `/projects/[novelId]/pipeline/episode-scripts` 页当前「生成旁白主导脚本初稿」的简易弹窗，升级为带 prompt preview / referenceTables / promptOverride 的高级生成对话框，并保持 narrator 四表持久化链路不变。

---

# 1. 修改文件清单

| File Path | Change Type |
|-----------|-------------|
| apps/api/src/pipeline/dto/narrator-script.dto.ts | 修改 |
| apps/api/src/pipeline/pipeline.controller.ts | 修改 |
| apps/api/src/pipeline/pipeline-reference-context.service.ts | 修改 |
| apps/api/src/pipeline/narrator-script.service.ts | 修改 |
| apps/web/src/lib/episode-script-api.ts | 修改 |
| apps/web/src/types/episode-script.ts | 修改 |
| apps/web/src/components/production/NarratorScriptGenerateDialog.tsx | 新增 |
| apps/web/src/components/production/EpisodeScriptsPage.tsx | 修改 |

---

# 2. 每个文件具体改了什么

## 2.1 apps/api/src/pipeline/dto/narrator-script.dto.ts

- **新增** `allowedNarratorReferenceTables` 常量（与 getContext 支持的扩展表一致）。
- **新增** `NarratorScriptPreviewDto`：modelKey、referenceTables、startEpisode、endEpisode、sourceTextCharBudget、userInstruction、allowPromptEdit、promptOverride（均为可选，带校验）。
- **扩展** `NarratorScriptGenerateDraftDto`：在原有字段基础上增加 referenceTables、sourceTextCharBudget、userInstruction、allowPromptEdit、promptOverride（均为可选）。
- 旧参数（targetEpisodeCount、startEpisode、endEpisode、batchSize、modelKey）未删，保持兼容。

## 2.2 apps/api/src/pipeline/pipeline.controller.ts

- **新增** `POST :novelId/narrator-script-preview-prompt`，Body 使用 `NarratorScriptPreviewDto`，调用 `narratorScriptService.previewPrompt(novelId, dto)`。
- 未删除、未修改现有 narrator-script-generate-draft / narrator-script-persist 接口。

## 2.3 apps/api/src/pipeline/pipeline-reference-context.service.ts

- **新增** `buildReferenceSummary(context: PipelineReferenceContext): TableBlockSummary[]`：遍历 context.optionalTables，按表输出 table、label、rowCount、fields，供 narrator preview 返回 referenceSummary。

## 2.4 apps/api/src/pipeline/narrator-script.service.ts

- **新增** `previewPrompt(novelId, dto)`：
  - 使用 `dto.referenceTables ?? NARRATOR_DEFAULT_EXTENSION`、`dto.sourceTextCharBudget ?? WORLDVIEW_CHAR_BUDGET`。
  - 调用 `refContext.getContext(novelId, { startEpisode, endEpisode, requestedTables, optionalTablesCharBudget })`。
  - 构建 episodeLines、worldviewBlock，调用新增的 `buildNarratorUserPrompt(episodeLines, worldviewBlock, dto.userInstruction)` 得到 promptPreview。
  - 调用 `refContext.buildReferenceSummary(context)` 得到 referenceSummary。
  - 返回 `{ promptPreview, usedModelKey, referenceTables, referenceSummary, warnings }`（missingTables 时写入 warnings）。
- **新增** 私有方法 `buildNarratorUserPrompt(episodeLines, worldviewBlock, userInstruction?)`：与原先 generate 内拼装逻辑一致，含任务说明、分集与节奏、世界观设定、JSON 契约、用户附加要求。
- **扩展** `generateDraft`：
  - 使用 `requestedTables = dto.referenceTables?.length ? dto.referenceTables : NARRATOR_DEFAULT_EXTENSION`、`charBudget = dto.sourceTextCharBudget ?? WORLDVIEW_CHAR_BUDGET`。
  - 每批 getContext 时传入 requestedTables、optionalTablesCharBudget。
  - 每批构建 episodeLines、worldviewBlock 后，若 `dto.allowPromptEdit && dto.promptOverride?.trim()` 则 userPrompt = dto.promptOverride，否则 userPrompt = buildNarratorUserPrompt(episodeLines, worldviewBlock, dto.userInstruction)。
  - `generateNarratorScriptsWithLlm` 改为接收 `userPrompt: string`，不再在内部拼装。
- **新增** 私有方法 `validateNarratorDraft(draft)`：轻量校验 scripts 数组、每 script 的 episodeNumber、scenes/shots 结构及必填字段，返回 `string[]` 的 validationWarnings。
- **扩展** generateDraft 返回值：在原有 `{ draftId, draft }` 上增加 `validationWarnings`。
- **未修改** `persistDraft`：写库逻辑、version_no、is_active、四表事务均未改动。

## 2.5 apps/web/src/lib/episode-script-api.ts

- **新增** `narratorScriptApi.previewPrompt(novelId, params?: NarratorScriptPreviewRequest)`，请求 `POST /pipeline/:novelId/narrator-script-preview-prompt`，返回 `Promise<NarratorScriptPreviewResponse>`。
- **扩展** `narratorScriptApi.generateDraft` 的 params 类型为 `NarratorScriptGenerateDraftParams`，包含 referenceTables、sourceTextCharBudget、userInstruction、allowPromptEdit、promptOverride；请求体仍为 JSON，旧调用（不传新字段）兼容。

## 2.6 apps/web/src/types/episode-script.ts

- **新增** `defaultNarratorReferenceTables`（与后端 NARRATOR_DEFAULT_EXTENSION 同序）。
- **新增** `NarratorScriptReferenceSummaryItem`、`NarratorScriptPreviewRequest`、`NarratorScriptPreviewResponse`。
- **新增** `NarratorScriptGenerateDraftParams`。
- **扩展** `NarratorScriptGenerateDraftResponse`：可选字段 usedModelKey、promptPreview、referenceSummary、warnings、validationWarnings。

## 2.7 apps/web/src/components/production/NarratorScriptGenerateDialog.tsx（新增）

- 大对话框组件，UI 风格对齐 PipelineEpisodeScriptDialog。
- 字段：modelKey、batchSize、startEpisode、endEpisode、referenceTables（多选）、sourceTextCharBudget、userInstruction、allowPromptEdit、promptPreview（可编辑当 allowPromptEdit）、referenceSummary、warnings、validationWarnings。
- 按钮：刷新 Prompt 预览、生成草稿、保存草稿、取消。
- 导出 `NARRATOR_REFERENCE_TABLE_OPTIONS`；defaultNarratorReferenceTables 从 types 引入使用。

## 2.8 apps/web/src/components/production/EpisodeScriptsPage.tsx

- **删除** 旧简易弹窗（原 generateDialogOpen 时的 inline div 弹层及 generateParams 状态）。
- **新增** 状态：narratorModelKey、narratorBatchSize、narratorStartEpisode、narratorEndEpisode、narratorReferenceTables、narratorSourceTextCharBudget、narratorUserInstruction、narratorAllowPromptEdit、narratorPromptPreview、narratorReferenceSummary、narratorWarnings、narratorPreviewLoading、narratorValidationWarnings。
- **新增** `handleRefreshPromptPreview`：调用 `narratorScriptApi.previewPrompt`，更新 promptPreview、referenceSummary、warnings。
- **修改** `handleGenerate`：使用上述 narrator 状态构造完整 params（含 referenceTables、sourceTextCharBudget、userInstruction、allowPromptEdit、promptOverride），调用 `narratorScriptApi.generateDraft`；成功后写入 draftId、lastDraft、draftPreview、narratorValidationWarnings；**不关闭对话框**。
- **新增** `toggleNarratorReferenceTable`：勾选/取消参考表。
- **替换** 原弹窗为 `<NarratorScriptGenerateDialog ... />`，传入全部 state 与 onClose、onRefreshPromptPreview、onGenerateDraft、onPersistDraft（persist 仍为原有 handlePersist，含 cache miss 时用 lastDraft 重试）。
- 保留页面级「保存草稿」按钮（draftId 存在时显示）及 handlePersist 的 cache miss fallback 逻辑。

---

# 3. 新增 API 与 DTO 说明

## 3.1 新增接口

| Method | Path | Request Body | Response |
|--------|------|--------------|----------|
| POST | /pipeline/:novelId/narrator-script-preview-prompt | NarratorScriptPreviewDto | { promptPreview, usedModelKey, referenceTables, referenceSummary, warnings } |

## 3.2 扩展接口（请求体新增可选字段）

| Method | Path | 新增可选请求字段 |
|--------|------|------------------|
| POST | /pipeline/:novelId/narrator-script-generate-draft | referenceTables, sourceTextCharBudget, userInstruction, allowPromptEdit, promptOverride |

## 3.3 扩展响应（generate 响应新增可选字段）

- usedModelKey、promptPreview、referenceSummary、warnings、validationWarnings（均为可选）。

---

# 4. 前端交互变化说明

- **入口**：仍为「生成旁白主导脚本初稿」按钮，点击后打开**大对话框**（NarratorScriptGenerateDialog），不再打开简易弹窗。
- **对话框内**：可配置模型 key、每批集数、起始/结束集、素材预算、参考数据多选、用户附加要求、允许编辑 Prompt；可点击「刷新 Prompt 预览」拉取服务端拼装的 prompt 与参考摘要；可编辑 Prompt 后点击「生成草稿」；生成成功后对话框内显示「保存草稿」按钮，可在此或关闭对话框后在页面点击「保存草稿」执行 persist。
- **兼容**：不传 referenceTables 等新参数时，后端仍按 NARRATOR_DEFAULT_EXTENSION 与默认 charBudget 行为不变；persist 仍支持 draftId 优先、cache miss 时前端用 lastDraft 重试。

---

# 5. 回归验证结果

- **编译**：`apps/api` 与 `apps/web` 已通过 build（nest build / next build 退出码 0）。
- **静态检查**：已对修改/新增的前后端文件执行 ReadLints，无报错。
- **建议人工验证**：
  1. preview 能返回 promptPreview / referenceSummary / warnings。
  2. generate 不传新字段时行为与改造前一致（使用默认参考表与预算）。
  3. generate 传 referenceTables 子集时，后端使用该子集拉取 context。
  4. allowPromptEdit + promptOverride 时，generate 使用 override 作为最终 prompt。
  5. persist 仍正确写入四表（episode_script_versions、episode_scenes、episode_shots、episode_shot_prompts）；version_no 递增、is_active 切换正确。
  6. persist 失败且 code === NARRATOR_SCRIPT_DRAFT_CACHE_MISS 时，前端用 lastDraft 再请求一次可成功。

---

# 6. 未完成项 / 风险项

- **未完成**：batchInfo 前端展示、referenceSummary 的 usedChars 等细节美化、对话框组件与 PipelineEpisodeScriptDialog 的进一步抽象复用、多轮 QA 或「标准/严格」模式，均未在本轮实现。
- **风险**：前端 defaultNarratorReferenceTables 与后端 NARRATOR_DEFAULT_EXTENSION 需长期保持一致，若后端扩展表名单变更，需同步更新前端常量。

---

# 7. 是否完全遵守 blueprint.md

- **是**。本轮实现严格按 blueprint 执行：
  - 前端基座采用类 PipelineEpisodeScriptDialog 的大对话框（NarratorScriptGenerateDialog），未复用 episode-script 的 persist。
  - 后端主链路仍为 NarratorScriptService；仅扩展 DTO、新增 previewPrompt、扩展 generateDraft；persistDraft 未改写库逻辑。
  - 持久化仅使用 narrator 四表事务写入，未调用 PipelineEpisodeScriptService.persistDraft，未写 character_visual_profiles。
  - 未写 migration，未删旧接口，仅做兼容扩展。
  - preview / generate / persist 三段式、referenceTables、promptOverride、轻量 QA（validationWarnings）均按 blueprint 落点实现。
