# Stage 3 收尾补丁 — 实现报告 + 联调验证清单

## 1. 修改文件清单

| 文件 | 补丁 | 说明 |
|------|------|------|
| `apps/web/src/components/ProjectDetail.tsx` | P1 | 透传 `totalChapters={novel.totalChapters}` 给 StoryTextPanel |
| `apps/api/src/pipeline/dto/episode-story-generation.dto.ts` | P2 | EpisodeStoryCheckDto.referenceTables 白名单校验；新增 modelKey |
| `apps/api/src/pipeline/episode-story-generation.service.ts` | P2 | runCheck 升级为 QA v2：规则检查 + 参考上下文 + LLM 检查 + 合并报告 |
| `apps/web/src/types/episode-story.ts` | P2 | EpisodeStoryCheckRequest 增加 modelKey |
| `apps/web/src/components/story-text/StoryTextPanel.tsx` | P2+P3 | check 请求带 modelKey；getErrorMessage、storyErrorMessage、storySuccessMessage、各 handler 错误/成功反馈 |
| `apps/web/src/components/story-text/StoryGenerateDialog.tsx` | P2+P3 | 检查报告展示增强（type/severity/message、无问题时文案）；errorMessage/successMessage 展示区 |

---

## 2. 每个补丁点具体改了什么

### Patch 1：totalChapters 透传

- **ProjectDetail.tsx**：`<StoryTextPanel ... totalChapters={novel.totalChapters} />`。若 `novel.totalChapters` 为空或 0，StoryTextPanel 内部仍用现有兜底（如 61）。
- **验收**：打开不同项目「故事文本」Tab → 点击「生成完整故事」→ 对话框目标集数默认与 `novel.totalChapters` 一致。

### Patch 2：AI 检查升级为参考表驱动 QA v2

**后端**

- **DTO**：`EpisodeStoryCheckDto.referenceTables` 使用 `@IsIn(allowedEpisodeStoryReferenceTables, { each: true })` 校验；新增可选 `modelKey`（@IsString @MaxLength(100)）。
- **Service**：
  - `check()` 解析 draft 后调用 `runCheck(novelId, draft, refTables, dto.modelKey)`。
  - `runCheck`：先执行 `runRuleBasedCheck(draft)` 得到规则报告；若 `referenceTables.length === 0` 直接返回并带 warnings；否则 `getContext(novelId, { requestedTables, optionalTablesCharBudget: 12000 })` → `buildStoryCheckPrompt(draft, context)` → `runStoryCheckLlm(modelKey, prompt)` → `mergeRuleAndLlmReport(ruleReport, llmReport, true)`。LLM 失败时退回仅规则报告并写 warnings。
  - `buildStoryCheckPrompt`：草稿摘要（每集 title/summary/story 截断）+ 核心三表节选（episodes/structure/hook）+ 扩展参考块（buildNarratorPromptContext 12k 预算），拼成 QA 提示；要求 LLM 输出 JSON（overallScore、episodeIssues、suggestions），issue type 含 outline_mismatch、structure_mismatch、character_inconsistency、continuity_issue、weak_hook、too_short、generic_writing、missing_text。
  - `runStoryCheckLlm`：单次 chat completions，解析 JSON，返回 `{ overallScore, episodeIssues, suggestions }`。
  - `mergeRuleAndLlmReport`：按 episodeNumber 合并规则与 LLM 的 issues（去重 type+message），综合分数取规则与 LLM 平均，合并 suggestions。
- **契约**：`POST /pipeline/:novelId/episode-story-check` 请求体可多传 `modelKey`；响应仍为 `StoryCheckReportDto`，仅 issue 类型更丰富。

**前端**

- **StoryTextPanel**：`handleCheck` 请求 payload 增加 `modelKey: storySelectedModelKey || storyModels[0]?.modelKey`。
- **StoryGenerateDialog**：检查报告区展示「总分 / 通过与否」；逐集问题展示「第 N 集」+ 每条 issue 的 `[severity]`、`type`、`message`；无问题时显示「未发现明显问题，可进入写入步骤。」；展示 `checkReport.warnings`。

### Patch 3：联调期错误可视化 + 持久化成功反馈

**StoryTextPanel**

- 新增 `getErrorMessage(error, fallback)`：优先 `error.payload?.message` 或 `error.response?.data?.message`，否则 `error.message`，否则 fallback。
- 新增 state：`storyErrorMessage`、`storySuccessMessage`。
- 打开弹窗时清空 `storyErrorMessage`、`storySuccessMessage`。
- **Preview 失败**：catch 中 `setStoryErrorMessage('Prompt 预览失败：' + getErrorMessage(err, '刷新预览失败'))`；刷新预览成功时 `setStoryErrorMessage(null)`。
- **Generate 失败**：catch 中 `setStoryErrorMessage('生成草稿失败：' + getErrorMessage(err, '生成草稿失败'))`；成功时 `setStoryErrorMessage(null)`。
- **AI 检查失败**：catch 中 `setStoryErrorMessage('AI 检查失败：' + getErrorMessage(err, 'AI 检查失败'))`；成功时 `setStoryErrorMessage(null)`。
- **Persist 失败**：catch 中根据 message 是否含 draftId/过期/不存在 提示「可尝试不依赖 draftId，直接使用当前草稿再次点击写入」；成功时 `setStorySuccessMessage('已成功写入 N 集故事版本，并刷新列表。')`，关闭弹窗并刷新列表。
- Panel 顶部在「生成完整故事」按钮上方展示绿色成功条（`storySuccessMessage`）。

**StoryGenerateDialog**

- 新增 props：`errorMessage`、`successMessage`。
- 弹窗内容区顶部：当 `errorMessage` 时显示红色错误块；当 `successMessage` 时显示绿色成功块（与 Panel 成功条一致，便于关闭前瞬间或未关时看到）。

---

## 3. QA v2 的检查维度与 issue types

**检查维度（LLM prompt 中约定）**

1. 提纲一致性：与 novel_episodes 的 episode_title / outline_content / core_conflict 等是否大体一致  
2. 结构节奏一致性：与 drama_structure_template、novel_hook_rhythm 是否明显冲突  
3. 人物与设定一致性：是否违背 set_core、novel_characters  
4. 连续性：当前集与上/下集是否明显断裂  
5. 尾钩有效性：是否保留读者继续阅读欲望  
6. 短剧可读性：是否具备短剧张力而非流水摘要  
7. 正文完整度：是否像完整故事而非几十字梗概  

**Issue types（报告与规则共用）**

- `outline_mismatch`、`structure_mismatch`、`character_inconsistency`、`continuity_issue`、`weak_hook`、`too_short`、`generic_writing`、`missing_text`  
- 规则层继续产出 `missing_text`、`too_short`，与 LLM 结果合并。

---

## 4. 错误可视化如何实现

- 统一用 **getErrorMessage(error, fallback)** 从后端错误中提取文案（payload.message / response.data.message / error.message）。
- 各操作（preview、generate、check、persist）失败时设置 **storyErrorMessage**，在弹窗内顶部以红色块展示，文案为「操作名失败：具体原因」；draftId 失效时额外提示可改用当前草稿再写入。
- 不在控制台替代用户可见提示；不吞掉 JSON 解析错误等关键信息（通过 getErrorMessage 透传后端 message）。

---

## 5. 成功反馈如何实现

- **Persist 成功**：`setStorySuccessMessage('已成功写入 N 集故事版本，并刷新列表。')`，关闭弹窗，调用 `loadStoryVersions()` 刷新「已保存故事版本」列表。
- **Panel**：在「生成完整故事」按钮上方展示绿色成功条（`storySuccessMessage`），打开弹窗时清空，故成功提示在关闭后于 Panel 可见。
- **Dialog**：支持展示 `successMessage`（绿色块），与 Panel 一致；persist 成功后通常先关弹窗，主要反馈在 Panel 成功条。

---

## 6. Build / typecheck 结果

- `npx nx run api:build`：通过（exit code 0）  
- `npx nx run web:build`：通过（exit code 0）  
- 当前无新增 linter 报错。

---

## 7. 人工联调 Checklist

- [ ] **Patch 1**：不同项目打开「故事文本」→「生成完整故事」，目标集数默认等于该项目 `novel.totalChapters`（或为 0 时兜底）。
- [ ] **Patch 2**：生成草稿后点击「AI 检查」，请求体包含当前勾选的 `referenceTables` 与 `modelKey`；返回报告中出现提纲/结构/人物/连续性/尾钩等类型（或规则型 missing_text/too_short）；无问题时显示「未发现明显问题，可进入写入步骤。」；逐集问题展示 type、severity、message。
- [ ] **Patch 2 回退**：断网或 LLM 报错时，检查结果退回仅规则报告，且 warnings 提示「参考表驱动 QA 调用失败，已退回仅规则检查结果。」。
- [ ] **Patch 3 Preview**：故意使预览失败（如错误 novelId 或断网），弹窗内出现「Prompt 预览失败：…」红色块。
- [ ] **Patch 3 Generate**：使生成失败，弹窗内出现「生成草稿失败：…」。
- [ ] **Patch 3 Check**：使检查失败，弹窗内出现「AI 检查失败：…」。
- [ ] **Patch 3 Persist 失败**：draftId 过期后点写入，弹窗内出现「写入数据库失败：…（可尝试不依赖 draftId…）」；其他错误出现「写入数据库失败：…」。
- [ ] **Patch 3 Persist 成功**：写入成功后弹窗关闭，Panel 顶部出现绿色「已成功写入 N 集故事版本，并刷新列表。」，下方「已保存故事版本」列表已更新。

---

*补丁实施完成。*
