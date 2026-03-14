# Stage 3 Patch Fix 实现报告

## 目标

本轮仅做两项修正，不扩散：

1. **模型选择改成真正的下拉框，数据来源接 ai_model_catalog**
2. **把 novel_episodes / drama_structure_template / novel_hook_rhythm 三张核心表补进 UI 与请求语义**

---

# 1. 修改文件清单

| File Path | 修改类型 |
|-----------|----------|
| apps/web/src/types/episode-script.ts | 修改：新增核心表常量、默认扩展表命名与兼容 |
| apps/web/src/components/production/EpisodeScriptsPage.tsx | 修改：拉取模型列表、传入 dialog、使用 defaultNarratorOptionalReferenceTables |
| apps/web/src/components/production/NarratorScriptGenerateDialog.tsx | 修改：models 下拉框、核心参考 / 扩展参考分区展示 |

**未修改**：后端 narrator-script、pipeline-reference-context、pipeline.controller、episode-script-api、persist 逻辑、migration、character_visual_profiles。

---

# 2. 模型下拉框如何复用现有模型来源

- **复用来源**：与「生成每集纲要和每集剧本」等流程一致，使用 **`pipelineAiApi.listAiModelOptions()`**。
- **位置**：`apps/web/src/lib/pipeline-ai-api.ts`，方法 `listAiModelOptions` 请求 `GET /ai-model-catalog/options`，返回 `Promise<AiModelOptionDto[]>`。
- **类型**：`AiModelOptionDto` 定义在 `apps/web/src/types/pipeline.ts`（id, modelKey, displayName, provider, family, modality）。与 PipelinePanel 里 `episodeScriptModels`、PipelineEpisodeScriptDialog 的 `models` 同源。
- **实现**：
  - **EpisodeScriptsPage**：在 `handleOpenGenerateDialog` 内、`setGenerateDialogOpen(true)` 之前，调用 `pipelineAiApi.listAiModelOptions()`，将结果写入 `narratorModels`（state），并传入 `NarratorScriptGenerateDialog` 的 `models={narratorModels}`。
  - **NarratorScriptGenerateDialog**：新增 props `models: AiModelOptionDto[]`；将原「模型 key（可选）」的 `<input type="text">` 改为 `<select>`：第一项 `value=""`、`不填用后端默认`；其余项为 `models.map(m => <option value={m.modelKey}>{m.displayName || m.modelKey}</option>)`；若当前 `modelKey` 不在列表中（例如用户之前手输或接口未返回），则追加一项 `<option value={modelKey}>当前：{modelKey}</option>`，避免丢失当前值。
- **请求**：preview / generate 仍传 `modelKey: string`（空字符串或不传表示后端默认），后端接口与协议未改。

---

# 3. 三张核心表在 UI 上如何展示

- **后端真实语义**（只读确认）：
  - `apps/api/src/pipeline/pipeline-reference-context.service.ts` 中 **CORE_REFERENCE_TABLES** = `['novel_episodes', 'drama_structure_template', 'novel_hook_rhythm']`。
  - **getContext** 中 `tablesToCheck = [...CORE_REFERENCE_TABLES, ...new Set(requestedTables)]`；episodes / structureTemplates / hookRhythms 始终由这三张核心表填充；**requestedTables 仅用于扩展表**（optionalTables）。即：三张核心表**始终参与**，不通过 referenceTables 控制。

- **前端常量**：
  - 在 `apps/web/src/types/episode-script.ts` 中新增 **NARRATOR_CORE_REFERENCE_TABLES**：`Array<{ value: string; label: string }>`，三项分别为 novel_episodes（分集信息）、drama_structure_template（结构模板）、novel_hook_rhythm（钩子节奏）。仅用于 UI 展示，不参与请求体。

- **UI 分区**（NarratorScriptGenerateDialog）：
  - **核心参考（始终包含）**：单独一块，浅蓝背景（#f0f9ff）、边框 #e6f7ff；标题「核心参考（始终包含）」；副文案「生成时始终包含以下三表，无需勾选」；下方用只读标签展示 NARRATOR_CORE_REFERENCE_TABLES 三项（✓ + label），**不可勾选、不可取消**。
  - **扩展参考（多选）**：原「参考数据（多选）」改名为「扩展参考（多选）」；选项列表改为 **NARRATOR_OPTIONAL_REFERENCE_TABLE_OPTIONS**（原 NARRATOR_REFERENCE_TABLE_OPTIONS 重命名），仍为 set_core、set_payoff_*、novel_characters、novel_key_nodes、novel_timelines、novel_source_segments、drama_source_text、novel_adaptation_strategy、drama_novels 等；勾选逻辑与原来一致，仅作用于扩展表。

---

# 4. referenceTables 请求语义如何修正

- **修正前**：前端 `narratorReferenceTables` 的默认值来自 `defaultNarratorReferenceTables`，内容本身**仅包含扩展表**（无 novel_episodes 等三张），preview/generate 请求中的 `referenceTables` 也只传该数组。
- **修正后**：
  - **语义**：`referenceTables` 仅表示「扩展参考表」选择；三张核心表**不进入** referenceTables，后端始终按 CORE_REFERENCE_TABLES 读取。
  - **实现**：将默认常量改名为 **defaultNarratorOptionalReferenceTables**（`apps/web/src/types/episode-script.ts`），内容不变；保留 **defaultNarratorReferenceTables** 为 `defaultNarratorOptionalReferenceTables` 的别名并标记 @deprecated，避免破坏已有引用。
  - **EpisodeScriptsPage**：初始 state 与 `handleOpenGenerateDialog` 中的重置均使用 **defaultNarratorOptionalReferenceTables**；`handleRefreshPromptPreview` / `handleGenerate` 中仍传 `referenceTables: narratorReferenceTables`（即仅扩展表），**未**把核心表加入请求体。
- **结论**：请求体 referenceTables 仅传扩展表子集；核心表不传、不改后端语义。

---

# 5. 是否改动了后端接口语义

- **未改动**。未修改任何后端文件。
- 后端 getContext 仍按 CORE_REFERENCE_TABLES 固定拉取三张核心表；requestedTables（对应前端的 referenceTables）仍只用于扩展表；preview/generate 的 DTO、persist 四表逻辑、character_visual_profiles 均未动。

---

# 6. 联调结果

- **静态**：对修改过的 TS/TSX 与 episode-script 类型文件执行 ReadLints，无报错。
- **建议人工验证**：
  1. 打开 episode-scripts 页，点击「生成旁白主导脚本初稿」，对话框内为**模型下拉框**（非文本输入框）。
  2. 下拉框第一项为「不填用后端默认」；其余项来自 ai-model-catalog（与 Pipeline 其他弹窗一致）。
  3. 参考区域分为「核心参考（始终包含）」三表只读展示，以及「扩展参考（多选）」可勾选。
  4. 选择模型后执行「刷新 Prompt 预览」→ preview 请求成功；执行「生成草稿」→ generate 请求成功。
  5. 不选模型（空值）时，preview/generate 不传或传空 modelKey，后端使用默认模型。
  6. persist 行为与之前一致，不受本次补丁影响。

---

# 7. 风险点 / 未完成项

- **风险**：若打开对话框时 `listAiModelOptions()` 失败，当前实现将 `narratorModels` 置为 `[]`，下拉框仅剩「不填用后端默认」与可能存在的「当前：xxx」。不影响 preview/generate 使用后端默认或已有 modelKey，但若依赖列表展示，需考虑错误提示或重试。
- **未完成**：未做 batchInfo 展示、未做参考表/提示文案的进一步美化、未做多 agent、未改 persist、未写 migration、未动 character_visual_profiles；严格按「只修两项、不扩散」执行。

---

# 8. 结论与约束符合性

- **Patch A**：模型选择已改为基于 `pipelineAiApi.listAiModelOptions()`（ai-model-catalog）的下拉框，并保留「不填用后端默认」与当前值不在列表时的展示。
- **Patch B**：三张核心表以「核心参考（始终包含）」在 UI 固定展示；扩展参考单独成区且仅扩展表参与勾选与 referenceTables 请求；defaultNarratorOptionalReferenceTables 与请求语义一致。
- **未违反**：narrator 四表 persist、episode-script 三表 persist、多 agent、migration、character_visual_profiles、无关组件重构均未改动。
