# Stage 3 实现报告 + 联调验证清单：生成完整短剧故事

## 1. 修改文件清单

| 类型 | 路径 |
|------|------|
| **新增** | `apps/api/src/pipeline/dto/episode-story-generation.dto.ts` |
| **新增** | `apps/api/src/pipeline/episode-story-generation.service.ts` |
| **修改** | `apps/api/src/pipeline/pipeline.controller.ts` |
| **修改** | `apps/api/src/pipeline/pipeline.module.ts` |
| **新增** | `apps/web/src/types/episode-story.ts` |
| **新增** | `apps/web/src/lib/episode-story-api.ts` |
| **新增** | `apps/web/src/components/story-text/StoryGenerateDialog.tsx` |
| **修改** | `apps/web/src/components/story-text/StoryTextPanel.tsx` |

---

## 2. 每个文件改了什么

### 后端

- **episode-story-generation.dto.ts**（新建）  
  - `allowedEpisodeStoryReferenceTables` 常量（扩展参考表白名单）。  
  - `EpisodeStoryPreviewDto`：modelKey、referenceTables、userInstruction、allowPromptEdit、promptOverride、sourceTextCharBudget、targetEpisodeCount；class-validator。  
  - `EpisodeStoryGenerateDraftDto`：继承预览字段 + batchSize。  
  - `EpisodeStoryPersistDto`：draftId 与 draft 二选一、generationMode；校验与响应类型。  
  - `EpisodeStoryCheckDto`：draftId / draft / versionIds、referenceTables。  
  - 响应类型：PreviewResponse、GenerateDraftResponse（含 draftId、draft、batchInfo、finalCompletenessOk、actualEpisodeCount 等）、PersistResponse、StoryCheckReportDto（overallScore、passed、episodeIssues、suggestions）。  

- **episode-story-generation.service.ts**（新建）  
  - `previewPrompt`：校验 novel、解析 referenceTables → `buildContextBlocks`（getContext + buildNarratorPromptContext + buildReferenceSummary）→ 返回 promptPreview、usedModelKey、referenceSummary、warnings。  
  - `generateDraft`：buildContextBlocks → `runPlanner`（单次 LLM 得到全集规划）→ `splitBatches`(batchSize 默认 5，上限 10) → 循环 `runWriterBatch`（每批 LLM，传入上一批最后一集 summary）→ 合并 allEpisodes → 校验缺集 → `cacheDraft`(draftId = randomUUID) → 返回 draftId、draft、batchInfo、finalCompletenessOk、countMismatchWarning 等。  
  - `persistDraft`：`resolveDraftForPersist`（draftId 优先从 cache 取，否则 dto.draft）→ 逐集调用 `EpisodeStoryVersionService.create(novelId, { episodeNumber, storyType: 'story_text', title, summary, storyText, generationSource: 'ai' })` → 若使用 draftId 则 `deleteCachedDraft`。  
  - `check`：从 draftId/draft/versionIds 解析出 draft，调用 `runCheck`（规则：缺正文、过短扣分），返回 StoryCheckReportDto。  
  - 内部：draft cache 为 `Map<string, CachedStoryDraft>`，TTL 30min、上限 50；getContext 仅传 `requestedTables: referenceTables`（核心三表在 getContext 内已包含）。  

- **pipeline.controller.ts**  
  - 注入 `EpisodeStoryGenerationService`。  
  - 新增 4 个 POST：  
    - `POST /pipeline/:novelId/episode-story-preview-prompt`  
    - `POST /pipeline/:novelId/episode-story-generate-draft`  
    - `POST /pipeline/:novelId/episode-story-persist`  
    - `POST /pipeline/:novelId/episode-story-check`  

- **pipeline.module.ts**  
  - 在 `providers` 中注册 `EpisodeStoryGenerationService`。  

### 前端

- **episode-story.ts**（新建）  
  - EpisodeStoryDraft、EpisodeStoryDraftEpisode、EpisodeStoryReferenceTable、ReferenceSummaryItem、PreviewRequest/Response、GenerateDraftResponse、PersistPayload/Response、CheckRequest、StoryCheckReportDto、EpisodeStoryBatchInfo 等，与后端 DTO 对齐。  

- **episode-story-api.ts**（新建）  
  - `previewPrompt(novelId, payload)`、`generateDraft(novelId, payload)`、`persistDraft(novelId, payload)`、`check(novelId, payload)` 调用上述 4 个端点；`listStoryVersions(novelId)` 调用 `GET /novels/:novelId/episode-story-versions`。  

- **StoryGenerateDialog.tsx**（新建）  
  - 弹窗 UI：模型下拉、核心参考只读文案、扩展参考多选（EXTENSION_REFERENCE_OPTIONS）、用户附加要求、allowPromptEdit、Prompt 预览与刷新、参考摘要、草稿预览（前 8 集）、批次状态、warnings、AI 检查报告区块、generatingPhase 文案、四个按钮（取消 / 生成草稿 / AI 检查 / 确认写入数据库）。全部由 props 控制，无内部 state。  

- **StoryTextPanel.tsx**（修改）  
  - 新增 props：`totalChapters?: number`（用于目标集数）。  
  - 状态：storyGenerateDialogOpen、storyModels、storyLoading、storyGenerating、storyPersisting、storyChecking、storySelectedModelKey、storyReferenceTables、storyUserInstruction、storyAllowPromptEdit、storyPromptPreview、storySourceTextCharBudget、storyReferenceSummary、storyDraft、storyDraftId、storyWarnings、storyGeneratingPhase、storyTargetEpisodeCount、storyActualEpisodeCount、storyBatchInfo、storyFinalCompletenessOk、storyCheckReport、storyVersionList。  
  - 点击「生成完整故事」→ `setStoryGenerateDialogOpen(true)`，若有 totalChapters 则更新 storyTargetEpisodeCount；打开时拉 `pipelineAiApi.listAiModelOptions()` 赋 storyModels，默认 storyReferenceTables 为保守子集（不含 novel_source_segments/drama_source_text）。  
  - 实现：刷新 Prompt 预览（`episodeStoryApi.previewPrompt`）、生成草稿（`episodeStoryApi.generateDraft`）、AI 检查（`episodeStoryApi.check`）、确认写入（`episodeStoryApi.persistDraft`，优先传 draftId）。  
  - 阶段状态文案：调用 generateDraft 前启动定时器，15s 显示「正在生成全集规划…」，之后每约 25s 推进「正在分批生成（Batch x / y）…」，最后「正在合并与校验…」；请求返回后清空 phase。  
  - persist 成功后：alert 成功、关闭弹窗、调用 `episodeStoryApi.listStoryVersions` 刷新 storyVersionList。  
  - 已保存故事版本列表展示（前 30 条）。  

---

## 3. 4 个新端点说明

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/pipeline/:novelId/episode-story-preview-prompt` | 预览 Prompt：根据 modelKey、referenceTables、userInstruction 等构建上下文并返回 promptPreview、referenceSummary、warnings。不调 LLM。 |
| POST | `/pipeline/:novelId/episode-story-generate-draft` | 生成草稿：Context → Planner → 分批 Writer → 合并与校验 → 写入内存 cache，返回 draftId、draft、batchInfo、finalCompletenessOk 等。 |
| POST | `/pipeline/:novelId/episode-story-persist` | 持久化：根据 draftId 或 draft 解析出完整 draft，逐集调用 EpisodeStoryVersionService.create 写入 episode_story_versions.story_text；成功后若为 draftId 则删除 cache。 |
| POST | `/pipeline/:novelId/episode-story-check` | AI 检查：根据 draftId / draft / versionIds 解析出 draft，执行规则检查（缺正文、过短等），返回 StoryCheckReportDto（overallScore、passed、episodeIssues、suggestions）。仅检查，不修复。 |

---

## 4. 分阶段流水线如何实现

1. **Context Planner**  
   - `buildContextBlocks`：调用 `PipelineReferenceContextService.getContext(novelId, { requestedTables: referenceTables, ... })`（核心三表在 getContext 内已包含），再 `buildNarratorPromptContext`、`buildReferenceSummary`，拼出 promptPreview。  

2. **Story Planner**  
   - `runPlanner`：单次 LLM 请求，系统提示为“短剧故事规划助手”，用户提示为“请为以下短剧生成 N 集的规划（每集含 episodeNumber、title、summary、storyBeat）”，返回 JSON 数组，补全为 targetCount 条。  

3. **Story Writer（分批）**  
   - `splitBatches(plan, batchSize)`：按 batchSize（默认 5）将 plan 切成多批。  
   - 循环每批调用 `runWriterBatch`：传入本批规划、上一批最后一集 summary、context 节选、userInstruction；LLM 返回每集的 episodeNumber、title、summary、storyText；合并到 allEpisodes，更新 prevSummary。  

4. **Merge / Validate**  
   - 合并 allEpisodes 为 `draft.episodes`；`findMissingEpisodeNumbers` 检查缺集；得到 finalCompletenessOk、countMismatchWarning。  

5. **Draft Cache**  
   - `generateDraftId()` 使用 `randomUUID()`；`cacheDraft(draftId, { novelId, draft, createdAt })` 写入 Map；TTL 30min、上限 50，超限删最旧。  

---

## 5. Draft cache 如何实现

- 结构：`private readonly draftCache = new Map<string, CachedStoryDraft>()`，`CachedStoryDraft = { novelId, draft, createdAt }`。  
- 写入：generateDraft 结尾调用 `cacheDraft(draftId, entry)`；写入前 `cleanExpiredDrafts()`，若 size ≥ 50 则删创建时间最早的一条再 set。  
- 读取：getCachedDraft(draftId) 检查存在且未过期（Date.now() - createdAt ≤ 30min），否则 delete 并返回 null。  
- 删除：persist 成功且请求带 draftId 时调用 `deleteCachedDraft(draftId)`。  

---

## 6. Persist 如何写入 episode_story_versions

- 通过且仅通过 `EpisodeStoryVersionService.create(novelId, dto)` 写入。  
- `resolveDraftForPersist` 得到 draft 后，对 `draft.episodes` 逐条：  
  - `create(novelId, { episodeNumber, storyType: 'story_text', title: ep.title || 默认, summary: ep.summary ?? null, storyText: ep.storyText, generationSource: 'ai' })`。  
- 不修改 episode_story_versions 表结构，不新增 migration，不改动 narrator 四表 persist 逻辑。  

---

## 7. 前端交互变化

- 项目详情页「故事文本」Tab：原有「生成完整故事」按钮，点击后打开 **StoryGenerateDialog**。  
- 对话框内：选择模型、勾选扩展参考、填写用户附加要求、可选允许编辑 Prompt 并编辑预览区、点击「刷新预览」拉取最新 promptPreview 与 referenceSummary。  
- 点击「生成草稿」：显示阶段文案（正在生成全集规划… → 正在分批生成（Batch x / y）… → 正在合并与校验…），请求返回后展示草稿预览（前 8 集）、batchInfo、finalCompletenessOk、warnings。  
- 点击「AI 检查」：请求 check 端点，展示 overallScore、passed、episodeIssues、suggestions。  
- 点击「确认写入数据库」：请求 persist（优先传 draftId），成功后 alert、关闭弹窗、刷新「已保存故事版本」列表。  
- 若父组件传入 `totalChapters`，则打开弹窗时用其作为目标集数。  

---

## 8. 构建结果

- 后端：`npx nx run api:build` 已通过（此前对话中已确认）。  
- 前端：建议执行 `npx nx run web:build` 验证无 TypeScript 与 lint 错误。  

---

## 9. 人工联调验证清单

- [ ] **环境**：API 配置 `lc_api_url`、`lc_api_key`；数据库存在目标 novel 及 novel_episodes、drama_structure_template、novel_hook_rhythm 等数据。  
- [ ] **故事文本 Tab**：进入项目详情 → 故事文本，点击「生成完整故事」，弹窗打开。  
- [ ] **模型与参考**：模型下拉有选项；扩展参考多选可勾选；核心参考为只读文案。  
- [ ] **预览**：点击「刷新预览」，promptPreview 与 referenceSummary 有内容，无报错。  
- [ ] **生成草稿**：点击「生成草稿」，阶段文案依次出现，请求成功后草稿区显示前 8 集、batchInfo 与完整性状态。  
- [ ] **AI 检查**：生成草稿后点击「AI 检查」，返回 overallScore、passed、episodeIssues/suggestions 并展示。  
- [ ] **持久化**：点击「确认写入数据库」，请求成功、alert 成功、弹窗关闭；故事文本区「已保存故事版本」列表刷新，且数据库 `episode_story_versions` 表有对应 novel_id、episode_number、story_text 等。  
- [ ] **draftId 优先**：同一草稿先 persist 用 draftId，应成功；若 30 分钟后或用另一进程清 cache 后再用同一 draftId persist，应提示 draftId 过期或不存在（或前端改传 draft 仍可成功）。  
- [ ] **无扩散**：未改 narrator 四表逻辑、未改 episode_story_versions 表结构、未做 Story Repair Agent、未引入 migration。  

---

*Stage 3 实现报告与联调清单完成。*
