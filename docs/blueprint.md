# Stage 1 Blueprint Report

## Task

基于已完成的 Stage 0 Discovery（`docs/discovery.md`），把 `/projects/[novelId]/pipeline/episode-scripts` 页的「生成旁白主导脚本初稿」升级方案细化为可执行的 Blueprint。本轮**不直接改业务代码**，只输出实施蓝图、数据流、接口设计、文件修改计划与风险控制方案。

---

# 0. Blueprint Scope

本轮输出目标：

1. 明确前端新对话框方案
2. 明确后端 narrator 扩展方案
3. 明确 preview / generate / persist 的新请求与响应结构
4. 明确参考表勾选、prompt preview、prompt override 的数据流
5. 明确批处理与 QA 方案
6. 明确哪些文件要修改、哪些类型要新增
7. 形成可直接进入 Stage 3 Implementation 的实施蓝图

本轮禁止：

- 不直接改代码
- 不写 migration
- 不删旧接口
- 不开始实现多轮复杂 agent swarm

---

# 1. Executive Blueprint Summary

## 1.1 方案总述

1. **前端组件形态**：在 episode-scripts 页面用**新的大对话框**替代当前简易弹窗；对话框布局与交互向 `PipelineEpisodeScriptDialog` 靠拢（参考 discovery §11.1、§14），包含：模型、集数范围、batchSize、参考表多选、素材预算、用户附加要求、允许编辑 Prompt、Prompt 预览区、刷新预览、生成草稿、保存草稿。

2. **是否复用 PipelineEpisodeScriptDialog**：**不直接复用同一组件**（因 episode-script 写三表、narrator 写四表，API 与 payload 不同）；**复用其 UI 形态与状态设计**，即新建 `NarratorScriptGenerateDialog`（或 `NarratorScriptDialog`），在 EpisodeScriptsPage 内使用，字段与交互模式对齐。

3. **narrator 后端是否继续作为主入口**：**是**。`NarratorScriptService` 继续作为旁白生成与生产层四表持久化的唯一入口；不引入新的 orchestrator，不混用 `PipelineEpisodeScriptService.persistDraft`（discovery §14）。

4. **preview / generate / persist 是否三段式保留**：**是**。新增 narrator **preview** 接口；**generate**、**persist** 保持现有路径并扩展请求字段；三段式与 episode-script 一致，便于前端统一体验。

5. **参考表如何传递**：前端对话框「参考数据」多选 → `referenceTables: string[]`（或 `requestedTables`）→ 后端 `NarratorScriptGenerateDraftDto.referenceTables` / Preview DTO；后端 `getContext(novelId, { ..., requestedTables: dto.referenceTables ?? NARRATOR_DEFAULT_EXTENSION })`；默认勾选与 `NARRATOR_DEFAULT_EXTENSION` 一致（discovery §4.4、pipeline-reference-context.service.ts §37–46）。

6. **prompt override 如何生效**：与 episode-script 一致：`allowPromptEdit` 为 true 且 `promptOverride` 非空时，generate 使用 `promptOverride` 作为最终 userPrompt，否则使用服务端拼装的 prompt；preview 仅返回服务端拼装结果，不执行 override（discovery §3.5）。

7. **批处理如何执行**：维持现有逻辑（discovery §4.4）：由 startEpisode/endEpisode（或 targetEpisodeCount）得到 episodeNumbers，按 batchSize 切批，每批调用 `getContext` + `buildNarratorPromptContext` + LLM，合并 scripts 后按 episodeNumber 排序，写入 draft cache；不改变单批失败即整次失败的策略；可选在合并后做一轮轻量 QA 再返回。

8. **QA 在什么阶段插入**：**本轮**在 generate 合并 scripts 之后、返回给前端之前做**一轮轻量校验**（结构合法、必填字段、集数连续/完整）；不阻塞返回，以 `warnings` / `validationWarnings` 形式带给前端；persist 前不强制 completenessOk，保留现有「draftId/draft 即可 persist」语义。**后续**可加多轮修复或「标准/严格」模式。

9. **character_visual_profiles 本轮是否纳入自动生成**：**不纳入**。保持独立资源，不默认绑进 narrator 生成与 persist（discovery §14、§6.2）。

10. **最小侵入实现路径**：① 后端扩展 DTO 与 `previewPrompt`、`generateDraft` 参数，不删旧字段；② 新增 `POST :novelId/narrator-script-preview-prompt`；③ 前端新增对话框组件，EpisodeScriptsPage 用其替代简易弹窗；④ 前端 API 层扩展 `narratorScriptApi.previewPrompt`、`generateDraft` 的 params；⑤ 旧调用（只传 batchSize/modelKey/startEpisode/endEpisode）仍合法，后端对缺失的 referenceTables 使用 NARRATOR_DEFAULT_EXTENSION。

---

# 2. Final Target Architecture

## 2.1 Overall Flow

```text
EpisodeScriptsPage
  -> 点击「生成旁白主导脚本初稿」
  -> 打开 NarratorScriptGenerateDialog
  -> 用户可选：模型、集数范围、batchSize、参考表、预算、用户要求、允许编辑 Prompt
  -> 点击「刷新 Prompt 预览」
  -> NarratorScriptGenerateDialog 调用 narratorScriptApi.previewPrompt(novelId, payload)
  -> POST /pipeline/:novelId/narrator-script-preview-prompt
  -> NarratorScriptService.previewPrompt(novelId, dto)
  -> PipelineReferenceContextService.getContext(novelId, { requestedTables, startEpisode, endEpisode, optionalTablesCharBudget })
  -> buildNarratorPromptContext(context, { charBudget }) + 任务说明 + 用户要求
  -> 返回 { promptPreview, usedModelKey, referenceSummary, referenceTables, warnings }
  -> 前端展示 promptPreview、referenceSummary、warnings

  -> 用户可选编辑 Prompt 文本框（若 allowPromptEdit）
  -> 点击「生成草稿」
  -> narratorScriptApi.generateDraft(novelId, payload)
  -> POST /pipeline/:novelId/narrator-script-generate-draft
  -> NarratorScriptService.generateDraft(novelId, dto)
  -> 解析 episodeNumbers（startEpisode/endEpisode 或 targetEpisodeCount）
  -> 按 batchSize 分批：
      每批 getContext(novelId, { episodeNumbers: batch, requestedTables, optionalTablesCharBudget })
      -> buildNarratorPromptContext
      -> 若 allowPromptEdit && promptOverride 则用 promptOverride 否则用上述 prompt
      -> generateNarratorScriptsWithLlm -> 合并 scripts
  -> （本轮可选）轻量 QA：校验 scripts 结构、必填、集数 -> warnings
  -> 写 draft cache，返回 { draftId, draft, promptPreview, referenceSummary, warnings, batchInfo?, generatedEpisodeNumbers }
  -> 前端展示草稿摘要、保存草稿按钮

  -> 用户点击「保存草稿」
  -> narratorScriptApi.persistDraft(novelId, { draftId, draft? })
  -> POST /pipeline/:novelId/narrator-script-persist
  -> NarratorScriptService.persistDraft(novelId, dto)
  -> getCachedDraft(draftId) 或 dto.draft -> 校验 novelId、scripts 非空
  -> transaction: 每 script -> UPDATE is_active=0 -> INSERT episode_script_versions -> INSERT episode_scenes -> INSERT episode_shots -> INSERT episode_shot_prompts
  -> 返回 { ok: true, summary: { scriptVersions, scenes, shots, prompts, episodeCoverage, batchCount } }
  -> 前端清空 draft 状态、刷新列表、alert 成功
```

## 2.2 核心设计原则

- **不改变 narrator 的持久化主链路**：persistDraft 仍只写 episode_script_versions、episode_scenes、episode_shots、episode_shot_prompts，version_no/is_active/事务逻辑不变。
- **不混用 episode-script 的三表 persist**：不调用 PipelineEpisodeScriptService.persistDraft，不写 novel_episodes、drama_structure_template、novel_hook_rhythm。
- **UI 向 PipelineEpisodeScriptDialog 靠拢**：大对话框、参考表多选、Prompt 预览区、可编辑 Prompt、刷新预览、生成/保存分步。
- **referenceTables 可配置但有默认值**：前端默认勾选与 NARRATOR_DEFAULT_EXTENSION 一致；后端未传时使用 NARRATOR_DEFAULT_EXTENSION。
- **prompt preview 与实际 generate 尽可能一致**：preview 与 generate 共用同一套 getContext + buildNarratorPromptContext + 任务说明拼接；仅 generate 支持 promptOverride 替换全文。
- **保持旧接口兼容**：现有 POST narrator-script-generate-draft 不删字段；旧前端只传 batchSize/modelKey/startEpisode/endEpisode 时行为与现有一致（使用 NARRATOR_DEFAULT_EXTENSION）。

---

# 3. Frontend Blueprint

## 3.1 页面与组件设计

| Component | Action | Responsibility | Reuse / New |
|-----------|--------|----------------|------------|
| EpisodeScriptsPage | modify | 持有对话框 open 状态、draft/draftId、lastDraft、与 narrator 相关的全部 state；渲染「生成旁白主导脚本初稿」按钮、保存草稿按钮、版本列表；打开新对话框替代原简易弹窗 | 修改现有 |
| NarratorScriptGenerateDialog | create | 大对话框：模型、startEpisode、endEpisode、batchSize、参考表多选、sourceTextCharBudget、userInstruction、allowPromptEdit、Prompt 预览/编辑、referenceSummary、warnings、刷新预览、生成草稿、保存草稿；接收 props（open、onClose、params、onParamsChange、draft、draftId、onPreview、onGenerate、onPersist、loading 等） | 新建 |
| PipelineEpisodeScriptDialog | 不修改 | 仅作 UI/交互参考，不直接复用 | 参考 |
| episode-script-api (narratorScriptApi) | modify | 增加 previewPrompt(novelId, payload)；generateDraft 的 params 增加 referenceTables、sourceTextCharBudget、userInstruction、allowPromptEdit、promptOverride | 修改现有 |
| 类型 episode-script.ts / 新增 narrator 类型 | modify | NarratorScriptPreviewRequest、NarratorScriptPreviewResponse、GenerateDraft 请求类型扩展 | 修改/扩展 |

## 3.2 新对话框字段设计

| Field | Type | UI Control | Default | Required | Purpose |
|-------|------|------------|---------|----------|---------|
| modelKey | string | select | 首个可用模型 | 否 | 生成模型 |
| batchSize | number | number input | 5 | 否 | 每批集数 |
| startEpisode | number | number input | 1 | 否 | 起始集（含） |
| endEpisode | number | number input | 5 或 totalChapters | 否 | 结束集（含） |
| referenceTables | string[] | checkboxes | NARRATOR_DEFAULT_EXTENSION 同序列表 | 否 | 参考表，与 getContext requestedTables 一致 |
| sourceTextCharBudget | number | number input | 25000 | 否 | 扩展表总字符预算（optionalTablesCharBudget） |
| userInstruction | string | textarea | '' | 否 | 用户附加要求，拼入 prompt |
| allowPromptEdit | boolean | checkbox | false | 否 | 是否允许编辑 Prompt 并作为 override 提交 |
| promptOverride | string | textarea（可编辑当 allowPromptEdit） | '' | 否 | 用户编辑后的全文，generate 时若存在则替代服务端 prompt |
| generationMode | - | 本轮可不暴露 | - | - | 后续可加 quick/standard/strict |
| preview text | string | textarea 只读或可编辑 | 服务端 preview 结果 | - | 展示 promptPreview |
| warnings | string[] | 只读列表/行 | [] | - | 服务端 warnings |
| referenceSummary | { table, label, rowCount, fields?, usedChars? }[] | 只读列表 | [] | - | 参考摘要，与 episode-script 对齐 |

## 3.3 前端状态设计

| State Name | Type | Owner | Initial Value | Purpose |
|------------|------|-------|---------------|---------|
| narratorDialogOpen | boolean | EpisodeScriptsPage | false | 对话框显隐 |
| narratorModelKey | string | EpisodeScriptsPage | '' | 选中模型，打开时可从 list 取首个 |
| narratorBatchSize | number | EpisodeScriptsPage | 5 | 每批集数 |
| narratorStartEpisode | number | EpisodeScriptsPage | 1 | 起始集 |
| narratorEndEpisode | number | EpisodeScriptsPage | 5 或 novel.totalChapters | 结束集 |
| narratorReferenceTables | string[] | EpisodeScriptsPage | defaultNarratorReferenceTables | 参考表勾选 |
| narratorSourceTextCharBudget | number | EpisodeScriptsPage | 25000 | 素材预算 |
| narratorUserInstruction | string | EpisodeScriptsPage | '' | 用户附加要求 |
| narratorAllowPromptEdit | boolean | EpisodeScriptsPage | false | 是否允许编辑 Prompt |
| narratorPromptPreview | string | EpisodeScriptsPage | '' | 预览全文 |
| narratorReferenceSummary | array | EpisodeScriptsPage | [] | 参考摘要 |
| narratorWarnings | string[] | EpisodeScriptsPage | [] | 警告信息 |
| narratorPreviewLoading | boolean | EpisodeScriptsPage | false | 刷新预览 loading |
| narratorGenerating | boolean | EpisodeScriptsPage | false | 生成中 |
| narratorPersisting | boolean | EpisodeScriptsPage | false | 保存中 |
| draftId | string \| null | EpisodeScriptsPage | null | 服务端返回的 draftId |
| lastDraft | NarratorScriptDraftPayload \| null | EpisodeScriptsPage | null | 上次生成结果，用于 persist 与 cache miss fallback |
| draftPreview / batchInfo | 可选 | EpisodeScriptsPage | - | 草稿摘要、批次信息（若后端返回） |

## 3.4 前端交互流程

1. **打开对话框**：用户点击「生成旁白主导脚本初稿」→ set narratorDialogOpen true；若有模型列表则 set 默认 modelKey；set 默认 referenceTables（与 NARRATOR_DEFAULT_EXTENSION 一致）、startEpisode=1、endEpisode=totalChapters 或 5、batchSize=5。
2. **加载默认模型/默认参考表**：对话框挂载时或打开时，若尚未拉取模型列表则拉取；默认参考表由前端常量 defaultNarratorReferenceTables（与 NARRATOR_DEFAULT_EXTENSION 同序）提供。
3. **点击刷新 Prompt 预览**：调用 narratorScriptApi.previewPrompt(novelId, { modelKey, referenceTables, startEpisode, endEpisode, sourceTextCharBudget, userInstruction, allowPromptEdit?, promptOverride? })；将返回的 promptPreview、referenceSummary、warnings 写入 state 并展示。
4. **用户编辑 Prompt**：当 allowPromptEdit 为 true 时，用户可编辑 Prompt 文本框；编辑内容在「生成草稿」时作为 promptOverride 传后端。
5. **点击生成草稿**：调用 narratorScriptApi.generateDraft(novelId, { modelKey, batchSize, startEpisode, endEpisode, referenceTables, sourceTextCharBudget, userInstruction, allowPromptEdit, promptOverride })；成功后保存 draftId、lastDraft、promptPreview、referenceSummary、warnings、batchInfo（若有）；展示草稿摘要与「保存草稿」按钮。
6. **展示生成结果摘要**：显示生成的集数、批次信息、warnings；可选显示前若干集标题或条数。
7. **点击保存草稿**：调用 narratorScriptApi.persistDraft(novelId, { draftId, draft: lastDraft })；成功则清空 draftId/lastDraft、刷新版本列表、alert summary；失败若为 NARRATOR_SCRIPT_DRAFT_CACHE_MISS 则用 { draft: lastDraft } 重试一次。
8. **失败 fallback 行为**：与现有一致：persist 返回 code NARRATOR_SCRIPT_DRAFT_CACHE_MISS 时，用全量 lastDraft 再请求 persistDraft(novelId, { draft: lastDraft })。

## 3.5 前端兼容策略

- **旧简易弹窗**：**删除**。用 NarratorScriptGenerateDialog 完全替代，不再保留「仅 batchSize/modelKey/startEpisode/endEpisode」的简易弹窗。
- **旧按钮文案**：主按钮仍为「生成旁白主导脚本初稿」；保存按钮仍为「保存草稿」；无需改文案。
- **旧 narratorScriptApi.generateDraft**：**兼容**。保留现有参数（targetEpisodeCount、startEpisode、endEpisode、batchSize、modelKey）；新增可选参数 referenceTables、sourceTextCharBudget、userInstruction、allowPromptEdit、promptOverride。旧调用（不传新参数）仍合法；后端未传 referenceTables 时使用 NARRATOR_DEFAULT_EXTENSION，未传 promptOverride 时使用服务端拼装 prompt。

---

# 4. Backend Blueprint

## 4.1 Controller 设计

| Endpoint | Method | Keep / New / Extend | Request DTO | Response Type | Purpose |
|----------|--------|---------------------|-------------|---------------|---------|
| POST :novelId/narrator-script-preview-prompt | POST | New | NarratorScriptPreviewDto | NarratorScriptPreviewResponseDto | 返回 prompt 预览与参考摘要 |
| POST :novelId/narrator-script-generate-draft | POST | Extend | NarratorScriptGenerateDraftDto（扩字段） | 现有 + 可选 promptPreview/referenceSummary/warnings/batchInfo | 生成草稿并缓存 |
| POST :novelId/narrator-script-persist | POST | Keep | NarratorScriptPersistDto | 现有 | 不变 |

## 4.2 DTO 设计

| DTO | Field | Type | Required | Default | Validation | Notes |
|-----|-------|------|----------|---------|------------|-------|
| NarratorScriptPreviewDto | modelKey | string | 否 | - | 可选，空则用默认模型 |  |
| NarratorScriptPreviewDto | referenceTables | string[] | 否 | NARRATOR_DEFAULT_EXTENSION | 可选，元素需在 allowedNarratorReferenceTables 内 | 与 getContext requestedTables 一致 |
| NarratorScriptPreviewDto | startEpisode | number | 否 | 1 | Min(1) |  |
| NarratorScriptPreviewDto | endEpisode | number | 否 | - | Min(1) |  |
| NarratorScriptPreviewDto | sourceTextCharBudget | number | 否 | 25000 | Min(1000), Max(120000) | optionalTablesCharBudget |
| NarratorScriptPreviewDto | userInstruction | string | 否 | - | MaxLength(4000) |  |
| NarratorScriptPreviewDto | allowPromptEdit | boolean | 否 | false |  |  |
| NarratorScriptPreviewDto | promptOverride | string | 否 | - | MaxLength(200000) | preview 时仅用于展示占位，不替换；可选 |
| NarratorScriptGenerateDraftDto | （现有全部） | - | - | - | - | 保留 |
| NarratorScriptGenerateDraftDto | referenceTables | string[] | 否 | NARRATOR_DEFAULT_EXTENSION | 同 Preview |  |
| NarratorScriptGenerateDraftDto | sourceTextCharBudget | number | 否 | 25000 | 同 Preview |  |
| NarratorScriptGenerateDraftDto | userInstruction | string | 否 | - | 同 Preview |  |
| NarratorScriptGenerateDraftDto | allowPromptEdit | boolean | 否 | false |  |  |
| NarratorScriptGenerateDraftDto | promptOverride | string | 否 | - | 同 Preview | generate 时若 truthy 则替代服务端 prompt |
| NarratorScriptPersistDto | 无新增 | - | - | - | - | 保持不变 |

后端需定义 **allowedNarratorReferenceTables**（与 EXTENDED_TABLE_CONFIG 或 getContext 支持的扩展表一致），建议至少包含：set_core、set_payoff_arch、set_payoff_lines、set_opponents、set_power_ladder、set_story_phases、novel_characters、novel_key_nodes、novel_timelines、novel_source_segments、drama_source_text、novel_adaptation_strategy、drama_novels 等（与 discovery §5.2、§8.2 一致）；默认勾选与 NARRATOR_DEFAULT_EXTENSION 一致。

## 4.3 Service 设计

| Service | Method | Action | Reason |
|---------|--------|--------|--------|
| NarratorScriptService | previewPrompt(novelId, dto) | 新增 | 供前端「刷新 Prompt 预览」；内部 getContext + buildNarratorPromptContext + 任务说明 + userInstruction，返回 promptPreview、referenceSummary、warnings、usedModelKey、referenceTables |
| NarratorScriptService | generateDraft(novelId, dto) | 扩展 | 支持 dto.referenceTables（否则 NARRATOR_DEFAULT_EXTENSION）、sourceTextCharBudget、userInstruction、allowPromptEdit、promptOverride；每批 getContext 时传 requestedTables；若 allowPromptEdit && promptOverride 则该批用 promptOverride 作为 userPrompt；返回可增加 promptPreview、referenceSummary、warnings、batchInfo、generatedEpisodeNumbers |
| NarratorScriptService | persistDraft(novelId, dto) | 保持不变或微调 | 不改变写库逻辑；仅如需在日志中记录来源（preview/generate 参数）可微调，非必须 |
| PipelineReferenceContextService | getContext、buildNarratorPromptContext | 不修改 | 已支持 requestedTables、optionalTablesCharBudget；narrator 直接复用 |
| （可选）NarratorScriptService 或独立 helper | validateNarratorDraft(draft) | 新增轻量方法 | 本轮可选：校验 scripts 非空、每 script 含 episodeNumber、scenes/shots 结构、必填字段；返回 { ok, warnings }，不抛错，结果挂到 generate 响应 |

---

# 5. Prompt Assembly Blueprint

## 5.1 Prompt 构建职责划分

- **Reference context 获取**：在 **previewPrompt** 与 **generateDraft 每批**内，由 NarratorScriptService 调用 `refContext.getContext(novelId, { startEpisode, endEpisode 或 episodeNumbers, requestedTables: dto.referenceTables ?? NARRATOR_DEFAULT_EXTENSION, optionalTablesCharBudget: dto.sourceTextCharBudget ?? 25000 })`。
- **Prompt skeleton 拼装**：在 NarratorScriptService 内完成：任务说明（旁白主导脚本、JSON 契约等）+ `refContext.buildNarratorPromptContext(context, { charBudget })` 得到的世界观块 + 本批 episode 信息（episodeMap/structureMap/hookMap，与现有 generateNarratorScriptsWithLlm 一致）+ `userInstruction`。
- **Override 替换**：仅在 **generateDraft** 中：若 `dto.allowPromptEdit && normalizeText(dto.promptOverride)` 存在，则最终发给 LLM 的 userPrompt = dto.promptOverride；否则为上述拼装结果。**previewPrompt** 不执行 override，只返回服务端拼装结果。
- **Preview 与 generate 共用**：共用 getContext、buildNarratorPromptContext、任务说明与 userInstruction 的拼接逻辑；preview 不调 LLM；generate 每批拼装方式与 preview 一致，仅多出「若 override 则替换」一步。

## 5.2 参考表策略

| Table | Role | Default Selected? | Priority | Size Risk | Handling Strategy |
|-------|------|-------------------|----------|-----------|-------------------|
| novel_episodes | 核心 | 必选（getContext 核心三表） | 1 | 中 | 始终拉取，按 startEpisode/endEpisode 过滤 |
| drama_structure_template | 核心 | 必选 | 1 | 中 | 同上 |
| novel_hook_rhythm | 核心 | 必选 | 1 | 中 | 同上 |
| set_core | 扩展 | 是 | 2 | 低 | NARRATOR_DEFAULT_EXTENSION，optionalTablesCharBudget 截断 |
| set_payoff_arch | 扩展 | 是 | 2 | 低 | 同上 |
| set_payoff_lines | 扩展 | 是 | 2 | 低 | 同上 |
| set_opponents | 扩展 | 是 | 2 | 低 | 同上 |
| set_power_ladder | 扩展 | 是 | 2 | 低 | 同上 |
| set_story_phases | 扩展 | 是 | 2 | 低 | 同上 |
| novel_characters | 扩展 | 是 | 2 | 中 | 同上 |
| novel_key_nodes | 扩展 | 是 | 2 | 低 | 同上 |
| novel_timelines | 扩展 | 是 | 2 | 低 | 同上 |
| novel_source_segments | 扩展 | 否 | 3 | 高 | 可选勾选，预算内截断 |
| drama_source_text | 扩展 | 否 | 3 | 高 | 同上 |
| drama_novels | 扩展 | 可选 | 2 | 低 | 项目主信息 |
| novel_adaptation_strategy | 扩展 | 可选 | 2 | 低 | 改编策略 |

## 5.3 默认参考表建议

- **默认勾选**：与 `NARRATOR_DEFAULT_EXTENSION` 一致，即 set_core、set_payoff_arch、set_payoff_lines、set_opponents、set_power_ladder、set_story_phases、novel_characters、novel_key_nodes、novel_timelines。保证与当前 narrator 行为一致且体量可控。
- **不默认勾选**：novel_source_segments、drama_source_text（体量大）；drama_novels、novel_adaptation_strategy、adaptation_modes 等可按需勾选。前端可选表名单与后端 allowedNarratorReferenceTables 一致，并带简单说明或「推荐」标记。

---

# 6. Batch Generation Blueprint

## 6.1 批处理算法

- **episodeNumbers**：由 startEpisode、endEpisode 决定；若未传则可由 targetEpisodeCount 与 novel 总集数推断 1..targetEpisodeCount；与现有 narrator 逻辑一致（discovery §4.4）。
- **batchSize**：每批集数，默认 5；将 episodeNumbers 按 batchSize 切分为多个 batch。
- **每批 LLM**：对每个 batch 调用 getContext(novelId, { episodeNumbers: batch, requestedTables, optionalTablesCharBudget }) → buildNarratorPromptContext → 若 override 则用 promptOverride 否则用拼装 prompt → generateNarratorScriptsWithLlm(batch, context, prompt, modelKey)。
- **合并与排序**：将各批返回的 scripts 数组合并，按 episodeNumber 升序排序；去重按 episodeNumber（同一集只保留一条，以最后一批为准或约定顺序）。
- **连续与完整**：不强制 episode_number 必须 1..N 连续；若某批失败则整次 generate 失败，不返回部分成功（与现有一致）。

## 6.2 响应结构（Generate）

建议返回给前端的字段：

| Field | Type | Purpose |
|-------|------|---------|
| draftId | string | 缓存 key，persist 时必传 |
| draft | NarratorScriptDraftPayload | scripts + meta |
| usedModelKey | string | 实际使用的模型 |
| promptPreview | string | 可选，最后一批或拼装结果，便于前端展示 |
| referenceTables | string[] | 实际使用的参考表 |
| referenceSummary | TableBlockSummary[] | 可选，与 episode-script 对齐 |
| warnings | string[] | 通用警告 |
| batchInfo | { batchIndex, range, success, episodeCount, elapsedMs }[] | 可选，每批摘要 |
| generatedEpisodeNumbers | number[] | 实际生成的集号列表 |
| validationWarnings | string[] | 本轮轻量 QA 产生的警告，不阻塞返回 |

## 6.3 失败策略

- **单批失败**：当前实现为整次 generate 失败，抛错返回；不返回部分 scripts。本轮保持该策略。
- **是否允许部分成功**：不允许；要么全部成功并合并，要么失败。
- **persist 前是否必须 completenessOk**：不必须；persist 只校验 draftId 或 draft 存在、novelId 一致、scripts 非空；不强制要求 generatedEpisodeNumbers 与目标集数完全一致。

---

# 7. QA / Validation Blueprint

## 7.1 本轮建议的 QA 层级

1. **Structure validation（本轮）**：校验 draft.scripts 为数组、每项含 episodeNumber、scenes 数组、每 scene 含 shots 数组等。
2. **Required field validation（本轮）**：校验每 script 至少 title、scriptType；每 scene 至少 sceneNo、sceneTitle；每 shot 至少 shotNo、visualDesc；每 prompt 至少 promptType、promptText。
3. **Episode completeness validation（本轮）**：校验 generatedEpisodeNumbers 与请求的 episodeNumbers 是否一致，若缺集则写入 validationWarnings，不阻塞。
4. **Optional content quality validation（后续）**：如时长总和、情绪标签、画面一致性等，后续再做。

## 7.2 QA 输出格式

| Field | Type | Purpose |
|-------|------|---------|
| ok | boolean | 结构是否通过（必填是否齐全） |
| warnings | string[] | 非致命提示，如「第 3 集缺少 scene」 |
| errors | string[] | 致命错误，若存在则 generate 可考虑抛错或仍返回 draft 并带 errors |
| affectedEpisodes | number[] | 实际参与校验的集号 |
| repairable | boolean | 后续可扩展：是否可自动修复 |

本轮可简化：仅输出 validationWarnings: string[] 挂到 generate 响应，不单独返回 QA 对象。

## 7.3 QA 插入点

- **Preview**：不做 QA。
- **Generate 后**：在合并 scripts、写 cache 之前，调用轻量 validateNarratorDraft(draft)；将结果中的 warnings 放入响应 validationWarnings；不因校验失败而抛错或拒绝返回 draft。
- **Persist 前**：不再次做完整 QA；仅现有校验（draft 存在、novelId、scripts 非空）。
- **Persist 是否拒绝不完整 draft**：不拒绝；persist 不检查 completenessOk 或 validationWarnings。

---

# 8. Data Persistence Blueprint

## 8.1 Persist 策略

- **继续使用 narrator 的 persistDraft**：逻辑不变，仍为 getCachedDraft(draftId) 或 dto.draft → 校验 → transaction 内按 script 写四表。
- **version_no / is_active**：语义不变；同 novel_id+episode_number 先 UPDATE is_active=0，再 INSERT 新 version，version_no = MAX(version_no)+1。
- **character_visual_profiles**：本轮不在此链路自动写入；不增加参数、不增加分支。

## 8.2 本轮不做的事

- 不改 episode-script 三表 persist。
- 不把 episode_shot_prompts 做成顶层 resource。
- 不默认生成或写入 character_visual_profiles。
- 不做复杂跨批次 agent 协同记忆或多轮 swarm。

---

# 9. File-Level Change Plan

## 9.1 必改文件

| File Path | Change Type | What To Change | Why |
|-----------|-------------|----------------|-----|
| apps/api/src/pipeline/dto/narrator-script.dto.ts | modify | 新增 NarratorScriptPreviewDto；NarratorScriptGenerateDraftDto 增加 referenceTables、sourceTextCharBudget、userInstruction、allowPromptEdit、promptOverride；定义 allowedNarratorReferenceTables（或引用 pipeline-reference-context 的常量） | 支持 preview 与扩展 generate 参数 |
| apps/api/src/pipeline/narrator-script.service.ts | modify | 新增 previewPrompt(novelId, dto)；generateDraft 内使用 dto.referenceTables ?? NARRATOR_DEFAULT_EXTENSION、sourceTextCharBudget、userInstruction、allowPromptEdit、promptOverride；可选 validateNarratorDraft 并挂 validationWarnings | 实现 preview 与可配置参考表/override |
| apps/api/src/pipeline/pipeline.controller.ts | modify | 新增 POST :novelId/narrator-script-preview-prompt，调用 narratorScriptService.previewPrompt | 暴露 preview API |
| apps/web/src/components/production/EpisodeScriptsPage.tsx | modify | 移除简易弹窗；新增 NarratorScriptGenerateDialog 及上述 state；实现 onPreview、onGenerate、onPersist；保留保存草稿与 cache miss fallback | 升级为高级对话框入口与状态 |
| apps/web/src/lib/episode-script-api.ts | modify | narratorScriptApi 增加 previewPrompt(novelId, payload)；generateDraft 的 params 类型与调用增加 referenceTables、sourceTextCharBudget、userInstruction、allowPromptEdit、promptOverride | 前端 API 与后端对齐 |
| apps/web/src/types/episode-script.ts | modify | 增加 NarratorScriptPreviewRequest、NarratorScriptPreviewResponse（promptPreview、usedModelKey、referenceSummary、referenceTables、warnings）；GenerateDraft 请求类型扩展 | 类型与后端一致 |

## 9.2 可选新增文件

| File Path | New File Purpose | Why Useful |
|-----------|------------------|------------|
| apps/web/src/components/production/NarratorScriptGenerateDialog.tsx | 独立对话框组件 | 与 EpisodeScriptsPage 解耦，便于复用布局与后续在 Pipeline 页复用；若倾向少文件可先内联在 EpisodeScriptsPage |
| apps/web/src/components/pipeline/NarratorScriptDialog.tsx | 同上，放在 pipeline 目录 | 若希望与 PipelineEpisodeScriptDialog 同目录统一管理 |

## 9.3 明确不改文件

| File Path | Why Not Change |
|-----------|----------------|
| apps/api/src/pipeline/pipeline-episode-script.service.ts | 写三表、另一条链路；不混用 |
| apps/api/src/pipeline/episode-script-version.service.ts、episode-scene.service.ts、episode-shot.service.ts、episode-shot-prompt.service.ts | 仅 CRUD/读；persist 仍由 narrator 写 |
| apps/api/src/pipeline/pipeline-resource.service.ts | character_visual_profiles 已接入；本轮不绑进 narrator |
| apps/web/src/components/pipeline/PipelineEpisodeScriptDialog.tsx、PipelinePanel.tsx | 每集纲要/剧本用；不改为 narrator 入口 |
| apps/api/sql/* | 不写 migration |

---

# 10. Type Design Blueprint

## 10.1 前端类型

| Type Name | File | Fields | Purpose |
|-----------|------|--------|---------|
| NarratorScriptPreviewRequest | episode-script.ts 或 pipeline.ts | modelKey?, referenceTables?, startEpisode?, endEpisode?, sourceTextCharBudget?, userInstruction?, allowPromptEdit?, promptOverride? | preview API 请求 |
| NarratorScriptPreviewResponse | episode-script.ts | promptPreview, usedModelKey, referenceSummary?, referenceTables?, warnings? | preview API 响应 |
| NarratorScriptGenerateDraftRequest | episode-script.ts（扩展现有） | 现有 + referenceTables?, sourceTextCharBudget?, userInstruction?, allowPromptEdit?, promptOverride? | generate API 请求 |
| NarratorScriptGenerateDraftResponse | 现有 | draftId?, draft, usedModelKey?; 可选 promptPreview?, referenceSummary?, warnings?, batchInfo?, generatedEpisodeNumbers?, validationWarnings? | generate API 响应 |
| defaultNarratorReferenceTables | 常量 | string[]，与 NARRATOR_DEFAULT_EXTENSION 同序 | 默认勾选参考表 |

## 10.2 后端类型

| Type Name | File | Fields | Purpose |
|-----------|------|--------|---------|
| NarratorScriptPreviewDto | narrator-script.dto.ts | 见 §4.2 | preview 请求校验 |
| NarratorScriptPreviewResponseDto | narrator-script.dto.ts 或同名 | promptPreview, usedModelKey, referenceSummary?, referenceTables?, warnings? | preview 响应 |
| allowedNarratorReferenceTables | narrator-script.dto.ts 或 pipeline-reference-context | string[] 或 readonly | 参考表白名单，校验用 |

## 10.3 中间产物类型

| Type Name | Layer | Key Fields | Why Needed |
|-----------|--------|------------|------------|
| PipelineReferenceContext | 已有 | novel, episodes, structureTemplates, hookRhythms, optionalTables, meta | getContext 返回，buildNarratorPromptContext 输入 |
| TableBlockSummary | 已有 | table, label, rowCount, fields, usedChars? | referenceSummary 单项，与 episode-script 对齐 |
| NarratorScriptDraftPayload | 已有 | scripts, meta? | draft 缓存与 persist  payload |

---

# 11. API Contract Blueprint

## 11.1 Preview API

**Request**（POST /pipeline/:novelId/narrator-script-preview-prompt）

```json
{
  "modelKey": "",
  "referenceTables": ["set_core", "set_payoff_arch", "..."],
  "startEpisode": 1,
  "endEpisode": 5,
  "sourceTextCharBudget": 25000,
  "userInstruction": "",
  "allowPromptEdit": false,
  "promptOverride": ""
}
```

**Response**

```json
{
  "promptPreview": "...",
  "usedModelKey": "xxx",
  "referenceTables": ["set_core", "..."],
  "referenceSummary": [
    { "table": "set_core", "label": "核心设定", "rowCount": 1, "fields": ["..."], "usedChars": 1200 }
  ],
  "warnings": []
}
```

## 11.2 Generate API

**Request**（POST /pipeline/:novelId/narrator-script-generate-draft）

```json
{
  "targetEpisodeCount": 10,
  "startEpisode": 1,
  "endEpisode": 5,
  "batchSize": 5,
  "modelKey": "",
  "referenceTables": ["set_core", "..."],
  "sourceTextCharBudget": 25000,
  "userInstruction": "",
  "allowPromptEdit": false,
  "promptOverride": ""
}
```

**Response**（兼容现有，新增可选字段）

```json
{
  "draftId": "uuid",
  "draft": { "scripts": [...], "meta": { "batchCount": 2 } },
  "usedModelKey": "xxx",
  "promptPreview": "...",
  "referenceTables": ["..."],
  "referenceSummary": [...],
  "warnings": [],
  "batchInfo": [{ "batchIndex": 0, "range": "1-5", "success": true, "episodeCount": 5, "elapsedMs": 3000 }],
  "generatedEpisodeNumbers": [1, 2, 3, 4, 5],
  "validationWarnings": []
}
```

## 11.3 Persist API

**Request**（POST /pipeline/:novelId/narrator-script-persist）— 不变

```json
{
  "draftId": "uuid",
  "draft": { "scripts": [...], "meta": {} }
}
```

**Response** — 不变

```json
{
  "ok": true,
  "summary": {
    "scriptVersions": 5,
    "scenes": 20,
    "shots": 80,
    "prompts": 160,
    "episodeCoverage": 5,
    "batchCount": 2
  }
}
```

- 字段命名与现有风格一致；referenceTables、promptPreview、referenceSummary、warnings、batchInfo、validationWarnings 为**新增可选**；旧前端不传新参数时行为不变。

---

# 12. Implementation Order

## 12.1 分步实施顺序

1. **扩展 DTO 与类型**：后端 NarratorScriptPreviewDto、allowedNarratorReferenceTables；NarratorScriptGenerateDraftDto 扩字段。前端 NarratorScriptPreviewRequest/Response、GenerateDraft 请求扩展、defaultNarratorReferenceTables。
2. **新增 narrator previewPrompt**：NarratorScriptService.previewPrompt；PipelineController POST narrator-script-preview-prompt。
3. **扩展 narrator generateDraft**：支持 referenceTables、sourceTextCharBudget、userInstruction、allowPromptEdit、promptOverride；每批 getContext 使用 dto.referenceTables；override 替换逻辑。
4. **可选：轻量 QA**：validateNarratorDraft(draft) 挂 validationWarnings 到 generate 响应。
5. **前端 API 层**：narratorScriptApi.previewPrompt；generateDraft params 扩展。
6. **前端对话框组件**：新建 NarratorScriptGenerateDialog，实现字段、预览、生成、保存、loading/error。
7. **EpisodeScriptsPage 集成**：移除简易弹窗，挂载 NarratorScriptGenerateDialog，接好 state 与 onPreview/onGenerate/onPersist、cache miss fallback。
8. **联调与回归**：preview → generate → persist 全链路；旧调用（仅 batchSize/modelKey/startEpisode/endEpisode）回归。

## 12.2 每一步的验收标准

| Step | Acceptance Criteria |
|------|---------------------|
| 1 | DTO 校验通过；前端类型无报错；allowed 与默认表与 NARRATOR_DEFAULT_EXTENSION 一致 |
| 2 | POST preview 返回 promptPreview、referenceSummary、warnings；与 generate 拼装一致（无 override 时） |
| 3 | generate 传 referenceTables 时 getContext 使用该列表；传 promptOverride 时 LLM 收到 override；返回含 draftId、draft、可选 promptPreview/referenceSummary/warnings |
| 4 | generate 响应含 validationWarnings（可为空数组） |
| 5 | 前端可调 previewPrompt、generateDraft 带新参数；旧调用仍可用 |
| 6 | 对话框可打开、可刷新预览、可编辑 Prompt（当允许）、可生成、可保存；UI 与 PipelineEpisodeScriptDialog 风格一致 |
| 7 | 从 episode-scripts 页完成「预览 → 生成 → 保存」；保存失败 cache miss 时用 lastDraft 重试成功 |
| 8 | 旧参数 generate 仍成功；新参数 generate 与 preview 一致；persist 写四表正确、version_no/is_active 正确 |

---

# 13. Testing Blueprint

## 13.1 后端测试点

- referenceTables 传子集时 getContext 仅拉取该子集；未传时使用 NARRATOR_DEFAULT_EXTENSION。
- promptOverride 传非空时 generate 使用 override 作为 userPrompt；否则使用拼装 prompt。
- preview 返回的 promptPreview 与 generate 未 override 时首批拼装结果一致（或同源逻辑）。
- draft cache：generate 返回 draftId，persist 用 draftId 可成功；过期或错 novelId 返回 NARRATOR_SCRIPT_DRAFT_CACHE_MISS / NARRATOR_SCRIPT_DRAFT_ID_NOVEL_MISMATCH。
- cache miss 时 persist 传 draft 可成功。
- version_no 同集递增；is_active 同集仅新 version 为 1。
- batch generation：多批合并后 episodeNumber 有序、无重复；单批失败整次失败。

## 13.2 前端测试点

- 对话框打开时默认模型与默认参考表正确。
- 刷新 Prompt 预览：请求带 referenceTables、startEpisode、endEpisode 等；展示 promptPreview、referenceSummary、warnings。
- 允许编辑 Prompt 时文本框可编辑；生成时传 promptOverride。
- 生成草稿：请求带新参数；成功后有 draftId、保存草稿按钮；展示摘要或 batchInfo。
- 保存草稿：优先 draftId；成功则清空状态、刷新列表。
- cache miss 时用 lastDraft 重试 persist 成功。

---

# 14. Risks and Safeguards

## 14.1 实施风险

- **参考表名单不一致**：前端 defaultNarratorReferenceTables 与后端 NARRATOR_DEFAULT_EXTENSION 或 allowedNarratorReferenceTables 不一致，导致默认行为与预期不符。  
  **Safeguard**：后端导出 NARRATOR_DEFAULT_EXTENSION 或统一常量；前端从 API 或共享常量读取默认表，或文档明确写死与后端一致。
- **preview 与 generate 拼装不一致**：preview 与 generate 使用不同逻辑导致用户看到的预览与实际发送不符。  
  **Safeguard**：preview 与 generate 共用同一套 getContext + buildNarratorPromptContext + 任务说明 + userInstruction；仅 generate 多一步 override 替换。
- **旧前端或脚本仍只传旧参数**：兼容性没问题，但若新前端误传空 referenceTables 数组，后端应视为「用默认」而非「无扩展表」。  
  **Safeguard**：后端对 referenceTables 做规范化：空数组或未传 => NARRATOR_DEFAULT_EXTENSION。
- **对话框状态过多导致难以维护**：EpisodeScriptsPage 状态膨胀。  
  **Safeguard**：将对话框状态集中为单一 object 或 useReducer，或抽成 useNarratorDialogState hook。
- **轻量 QA 误判导致误报 warnings**：校验过严把合法 draft 标为 warning。  
  **Safeguard**：本轮 QA 仅做明显缺失（如无 scripts、无 episodeNumber），不做内容质量判断；validationWarnings 不阻塞返回。

## 14.2 防护措施（汇总）

- 参考表默认值由后端常量统一；前端默认与之后端一致。
- Preview 与 generate 共用 prompt 拼装代码路径；override 仅 generate 一处替换。
- 后端 referenceTables 空/未传 => NARRATOR_DEFAULT_EXTENSION。
- 对话框状态可抽 hook 或单对象，便于维护。
- QA 仅做结构/必填/集数完整性；不阻塞 persist。

---

# 15. Final Blueprint Recommendation

## Final Blueprint Recommendation

- **推荐 UI 方案**：在 episode-scripts 页面用**新大对话框**（NarratorScriptGenerateDialog）替代简易弹窗；布局与交互对齐 PipelineEpisodeScriptDialog（模型、集数、batchSize、参考表多选、预算、用户要求、Prompt 预览与可编辑、刷新预览、生成/保存）；状态由 EpisodeScriptsPage 管理或抽成 hook。
- **推荐 API 方案**：新增 POST narrator-script-preview-prompt；扩展 POST narrator-script-generate-draft 请求体（referenceTables、sourceTextCharBudget、userInstruction、allowPromptEdit、promptOverride）；POST narrator-script-persist 保持不变。
- **推荐 DTO 扩展**：NarratorScriptPreviewDto（含上述 preview 字段）；NarratorScriptGenerateDraftDto 增加 referenceTables、sourceTextCharBudget、userInstruction、allowPromptEdit、promptOverride；定义 allowedNarratorReferenceTables，默认与 NARRATOR_DEFAULT_EXTENSION 一致。
- **推荐服务扩展**：NarratorScriptService 新增 previewPrompt；generateDraft 使用 dto.referenceTables ?? NARRATOR_DEFAULT_EXTENSION、sourceTextCharBudget、userInstruction、allowPromptEdit、promptOverride；可选 validateNarratorDraft 挂 validationWarnings；persistDraft 不变。
- **推荐批处理策略**：维持现有按 batchSize 分批、每批 getContext + buildNarratorPromptContext + LLM、合并后排序；单批失败整次失败；不部分成功。
- **推荐 QA 范围**：本轮仅做轻量校验（结构、必填、集数完整），结果以 validationWarnings 返回，不阻塞 generate 与 persist。
- **推荐持久化策略**：仅使用 NarratorScriptService.persistDraft，写四表、version_no、is_active、事务；不写 character_visual_profiles，不碰 episode-script 三表。
- **本轮明确不做**：不实现多轮 agent swarm；不写 migration；不删旧接口；不把 episode_shot_prompts 做成顶层 resource；不默认生成 character_visual_profiles；不强制 persist 前 completenessOk。
- **进入 Stage 3 的前提条件**：本 Blueprint 已评审通过；Discovery 与 Blueprint 中约定的默认参考表、API 契约、文件修改清单与实施顺序无异议；前后端可并行开发（先 DTO/类型 → 后端 preview + generate 扩展 → 前端 API → 前端对话框 → 集成联调）。

---

*Blueprint 完成；未修改任何业务代码。*
