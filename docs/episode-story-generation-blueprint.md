# Blueprint: 生成完整短剧故事（Episode Story Generation）

本文档为 Cursor 可直接执行的落地 Blueprint，覆盖前端、后端、AI 多阶段、批次策略与 QA 流程。基于 `docs/episode-story-generation-discovery.md` 收敛而成。

---

## 1️⃣ 前端组件结构

| 组件 | 位置 | 功能 |
|------|------|------|
| `StoryTextPanel.tsx` | `apps/web/src/components/story-text/` | 当前 Tab 渲染故事文本列表和按钮；新增 `storyGenerateDialogOpen` state；点击「生成完整故事」弹出 StoryGenerateDialog |
| `StoryGenerateDialog.tsx` | `apps/web/src/components/story-text/` | 高级对话框，仿 `PipelineEpisodeScriptDialog`：模型选择、核心/扩展参考表多选、用户附加说明、allowPromptEdit 与 Prompt 预览、批次状态文案、草稿预览、按钮「生成草稿 / AI 检查 / 确认写入数据库」 |

**Dialog 核心 props：**

- `open: boolean`
- `onClose: () => void`
- `novelId: number`
- 其余为 state 与回调（参考下方 State 清单，由 StoryTextPanel 传入）

---

## 2️⃣ 前端 State 清单

在 **StoryTextPanel.tsx** 中管理：

| State | 类型 | 说明 |
|-------|------|------|
| `storyGenerateDialogOpen` | boolean | 对话框显隐 |
| `storyModels` | AiModelOptionDto[] | 模型列表（来自 pipelineAiApi.listAiModelOptions） |
| `storyLoading` | boolean | 刷新 prompt 预览中 |
| `storyGenerating` | boolean | 生成草稿中 |
| `storyPersisting` | boolean | 写入数据库中 |
| `storySelectedModelKey` | string | 当前选中模型 |
| `storyReferenceTables` | string[] | 扩展参考表（核心三表固定注入，不在此列表勾选） |
| `storyUserInstruction` | string | 用户附加说明 |
| `storyAllowPromptEdit` | boolean | 允许编辑 Prompt |
| `storyPromptPreview` | string | Prompt 预览/编辑内容 |
| `storySourceTextCharBudget` | number | 素材字符预算，默认 30000 |
| `storyReferenceSummary` | ReferenceSummaryItem[] | 参考摘要（preview/generate 返回） |
| `storyDraft` | EpisodeStoryDraft \| null | 当前草稿 |
| `storyDraftId` | string \| undefined | 服务端 cache 的 draftId |
| `storyWarnings` | string[] | 警告列表 |
| `storyGeneratingPhase` | string | 阶段文案（如「正在生成全集规划…」「正在分批生成（Batch 1/13）…」） |
| `storyTargetEpisodeCount` | number | 目标集数，默认 novel_episodes 集数 |
| `storyActualEpisodeCount` | number \| undefined | 实际生成集数 |
| `storyBatchInfo` | BatchInfo[] | 批次信息（可选展示） |
| `storyFinalCompletenessOk` | boolean \| undefined | 草稿是否完整 |
| `storyCheckReport` | StoryCheckReportDto \| null | AI 检查报告（可选） |

---

## 3️⃣ 后端 API 端点

| 方法 | 路径 | 功能 | 请求 DTO | 响应 |
|------|------|------|----------|------|
| POST | `/pipeline/:novelId/episode-story-preview-prompt` | 生成 prompt 预览 | EpisodeStoryPreviewDto | promptPreview, usedModelKey, referenceSummary, warnings |
| POST | `/pipeline/:novelId/episode-story-generate-draft` | 多阶段生成 draft（分批 3–5 集） | EpisodeStoryGenerateDraftDto | EpisodeStoryGenerateDraftResponse |
| POST | `/pipeline/:novelId/episode-story-persist` | 将草稿写入 episode_story_versions | EpisodeStoryPersistDto | EpisodeStoryPersistResponse |
| POST | `/pipeline/:novelId/episode-story-check` | AI 检查草稿或已存 story | EpisodeStoryCheckDto | StoryCheckReportDto |

- 路由注册在 **PipelineController**（`apps/api/src/pipeline/pipeline.controller.ts`），与现有 episode-script、narrator-script 并列。

---

## 4️⃣ 后端 DTO 定义

**文件位置：** `apps/api/src/pipeline/dto/episode-story-generation.dto.ts`（新建）

**Preview / Generate 请求：**

```ts
// 扩展参考表白名单，与 pipeline-reference-context 的 EXTENDED_TABLE_CONFIG 对齐
export const allowedEpisodeStoryReferenceTables = [
  'drama_novels', 'drama_source_text', 'novel_adaptation_strategy', 'adaptation_modes',
  'novel_characters', 'novel_key_nodes', 'novel_timelines', 'novel_explosions',
  'novel_skeleton_topics', 'novel_skeleton_topic_items', 'novel_source_segments',
  'set_core', 'set_payoff_arch', 'set_payoff_lines', 'set_opponent_matrix', 'set_opponents',
  'set_power_ladder', 'set_traitor_system', 'set_traitors', 'set_traitor_stages', 'set_story_phases',
] as const;

export type EpisodeStoryReferenceTable = (typeof allowedEpisodeStoryReferenceTables)[number];

export class EpisodeStoryPreviewDto {
  @IsOptional() @IsString() @MaxLength(100) modelKey?: string;
  @IsArray() @ArrayUnique() @IsIn(allowedEpisodeStoryReferenceTables, { each: true }) referenceTables: EpisodeStoryReferenceTable[];
  @IsOptional() @IsString() @MaxLength(4000) userInstruction?: string;
  @IsOptional() @IsBoolean() allowPromptEdit?: boolean;
  @IsOptional() @IsString() @MaxLength(200000) promptOverride?: string;
  @IsOptional() @IsInt() @Min(1000) @Max(120000) sourceTextCharBudget?: number;
  @IsOptional() @IsInt() @Min(1) @Max(200) targetEpisodeCount?: number;
  @IsOptional() @IsInt() @Min(2) @Max(10) batchSize?: number;
}
```

**Generate 请求：** `EpisodeStoryGenerateDraftDto` 与 `EpisodeStoryPreviewDto` 字段一致（可 extends）。

**草稿与 Generate 响应：**

```ts
export interface EpisodeStoryDraftEpisode {
  episodeNumber: number;
  title?: string;
  summary?: string;
  storyText: string;
}

export interface EpisodeStoryDraft {
  episodes: EpisodeStoryDraftEpisode[];
}

export interface EpisodeStoryGenerateDraftResponse {
  draftId: string;
  draft: EpisodeStoryDraft;
  usedModelKey: string;
  promptPreview?: string;
  referenceSummary?: { table: string; label: string; rowCount: number; fields: string[] }[];
  targetEpisodeCount?: number;
  actualEpisodeCount?: number;
  countMismatchWarning?: string;
  warnings?: string[];
  batchInfo?: { batchIndex: number; range: string; success: boolean; episodeCount: number }[];
  finalCompletenessOk?: boolean;
}
```

**Persist 请求/响应：**

```ts
export class EpisodeStoryPersistDto {
  @IsOptional() @IsString() draftId?: string;
  @IsOptional() @IsObject() draft?: EpisodeStoryDraft;
  @IsOptional() @IsIn(['ai', 'manual']) generationMode?: 'ai' | 'manual';
}

export interface EpisodeStoryPersistResponse {
  ok: true;
  summary: { episodeNumbers: number[]; versionCount: number };
  warnings?: string[];
}
```

**Check 请求/响应：**

```ts
export class EpisodeStoryCheckDto {
  @IsOptional() @IsString() draftId?: string;
  @IsOptional() @IsObject() draft?: EpisodeStoryDraft;
  @IsOptional() @IsArray() @IsInt({ each: true }) versionIds?: number[];
  @IsOptional() @IsArray() referenceTables?: string[];
}

export interface StoryCheckReportDto {
  overallScore: number;
  passed: boolean;
  episodeIssues: {
    episodeNumber: number;
    issues: { type: string; message: string; severity: 'low' | 'medium' | 'high' }[];
  }[];
  suggestions: { episodeNumber?: number; suggestion: string }[];
  warnings?: string[];
}
```

---

## 5️⃣ 后端服务方法（EpisodeStoryGenerationService）

**文件位置：** `apps/api/src/pipeline/episode-story-generation.service.ts`（新建）

| 方法 | 输入 | 输出 | 描述 |
|------|------|------|------|
| `previewPrompt(novelId, dto)` | EpisodeStoryPreviewDto | { promptPreview, usedModelKey, referenceSummary, warnings? } | 仅拼 prompt，不调 LLM |
| `generateDraft(novelId, dto)` | EpisodeStoryGenerateDraftDto | EpisodeStoryGenerateDraftResponse | 多阶段：Context → Planner → Writer 分批 → Merge → Validate → Cache |
| `persistDraft(novelId, dto)` | EpisodeStoryPersistDto | EpisodeStoryPersistResponse | 从 draftId 或 draft 解析，循环 EpisodeStoryVersionService.create 写 episode_story_versions |
| `check(novelId, dto)` | EpisodeStoryCheckDto | StoryCheckReportDto | AI 检查草稿或已存 version，返回评分与逐集问题 |

**内部方法（同一 Service 内）：**

- `buildContextBlocks(novelId, referenceTables, options)`：调用 PipelineReferenceContextService.getContext + 构建故事用 context 块（核心三表 + 扩展表）。
- `buildPlanPrompt(context, targetEpisodeCount, userInstruction)`：拼 Planner 的 prompt。
- `runPlanner(modelKey, planPrompt)`：单次 LLM 调用，输出 61 集骨架 plan（episodeNumber, title, summary, storyBeat）。
- `splitBatches(plan, batchSize)`：将 plan 按 batchSize（默认 5）拆成多批。
- `runWriterBatch(batch, context, planSummary, prevBatchSummary?)`：单批 LLM 生成 story_text。
- `mergeDraft(batchResults)`：合并各批结果为 EpisodeStoryDraft。
- `validateDraft(draft, targetEpisodeCount)`：校验集数、必填字段，返回 finalCompletenessOk、countMismatchWarning。
- `cacheDraft(draftId, entry)` / `getCachedDraft(draftId)`：内存 Map + TTL（如 30min）、上限 50 条，与 episode-script 一致。
- `resolveDraftForPersist(dto)`：draftId 优先从 cache 取，否则用 dto.draft；校验 novelId。
- `persistToStoryVersions(novelId, draft)`：循环 draft.episodes，每集调用 EpisodeStoryVersionService.create(novelId, { episodeNumber, title, summary, storyText, storyType: 'story_text', ... })，事务内或逐条写。

---

## 6️⃣ 生成批次策略（61 集）

- **核心三表始终注入**：novel_episodes、drama_structure_template、novel_hook_rhythm（不占用户勾选，getContext 时固定包含）。
- **Story Planner**：一次 LLM 调用，生成 61 集骨架 plan（episodeNumber、title、summary、storyBeat）；可 repair 缺集。
- **Story Writer**：按批（batchSize 默认 5，可 3–5）调用 LLM；每批 prompt 含：plan 摘要 + 本批 plan 条目 + 上一批最后一集 summary（保持连续性）+ 参考 context 块。
- **Draft Cache**：全部批次合并、校验后，生成 draftId，cacheDraft(draftId, { novelId, draft, createdAt })；persist 时再按 draftId 取或用 payload.draft。
- **批次示意：**

```ts
const plan = await this.runPlanner(usedModelKey, planPrompt);
const batches = this.splitBatches(plan.episodes, dto.batchSize ?? 5);
let merged: EpisodeStoryDraftEpisode[] = [];
let prevSummary = '';
for (const batch of batches) {
  const batchDraft = await this.runWriterBatch(batch, context, planSummary, prevSummary);
  merged = merged.concat(batchDraft);
  prevSummary = getLastEpisodeSummary(batchDraft);
}
const draft = { episodes: merged };
this.validateDraft(draft, targetEpisodeCount);
const draftId = this.generateDraftId();
this.cacheDraft(draftId, { novelId, draft, createdAt: Date.now() });
return { draftId, draft, ... };
```

---

## 7️⃣ AI 检查与 Story Repair

- **AI 检查按钮**：在 StoryGenerateDialog 草稿预览区下方或与「确认写入」并列；仅当有 draft 或已选 versionIds 时可点。
- **请求**：POST `/pipeline/:novelId/episode-story-check`，Body：draftId 或 draft 或 versionIds + referenceTables（核心+扩展）。
- **响应**：StoryCheckReportDto（overallScore、passed、episodeIssues、suggestions、warnings）。
- **前端**：展示总评分、逐集问题列表、建议；不自动修复。
- **Story Repair Agent**：可选后续迭代；用户勾选问题集 → 调用修复接口 → 返回修复后 draft → 再 persist 或 update 指定 version。

---

## 8️⃣ 前端流程

1. 用户点击「生成完整故事」→ `setStoryGenerateDialogOpen(true)`；Dialog 打开时拉取 storyModels（pipelineAiApi.listAiModelOptions），若无可选参考表则设默认 storyReferenceTables。
2. 用户选择模型、参考表、填写 userInstruction、可选勾选 allowPromptEdit → 点击「刷新 Prompt 预览」→ 调 `previewPrompt` → 展示 storyPromptPreview、storyReferenceSummary。
3. 用户点击「生成草稿」→ 调 `generateDraft`；前端用定时器推进 `storyGeneratingPhase`（如 15s 规划、每 25s 推进一批），请求返回后展示 draft、draftId、storyBatchInfo、storyFinalCompletenessOk。
4. 用户点击「确认写入数据库」→ 调 `persistDraft(draftId 或 draft)` → 成功后提示并关闭 Dialog 或刷新列表。
5. 用户点击「AI 检查」→ 调 `check` → 展示 storyCheckReport（总评分、逐集问题、建议）。

---

## 9️⃣ 实施顺序（Cursor 可执行顺序）

1. **后端 DTO + 占位 API**：新建 `dto/episode-story-generation.dto.ts`；在 PipelineController 增加四条 POST 路由；新建 `EpisodeStoryGenerationService` 的 skeleton（previewPrompt 返回占位、generateDraft 返回假 draft、persistDraft 空实现、check 返回占位报告）；PipelineModule 注册 Service。
2. **Context + Planner**：在 Service 内实现 buildContextBlocks（复用 PipelineReferenceContextService）、buildPlanPrompt、runPlanner（单次 LLM），generateDraft 只跑到 plan，暂不写 Writer。
3. **Writer 分批 + Merge + Cache**：实现 splitBatches、runWriterBatch、mergeDraft、validateDraft、cacheDraft/getCachedDraft；generateDraft 全流程跑通，返回真实 draftId + draft。
4. **Persist 写库**：resolveDraftForPersist + persistToStoryVersions（循环 EpisodeStoryVersionService.create），事务可选。
5. **前端 API + 类型**：新建 `apps/web/src/lib/episode-story-api.ts`（或 pipeline-episode-story-api.ts）与 `types/episode-story.ts`（EpisodeStoryDraft、请求/响应类型）。
6. **前端 StoryGenerateDialog + StoryTextPanel state**：实现 Dialog 布局与表单项、StoryTextPanel 中 state 与打开/关闭/刷新预览/生成/写入/检查回调；对接上述 API。
7. **阶段状态文案**：生成草稿时用 setTimeout 推进 storyGeneratingPhase 文案（与 episode-script 一致）。
8. **AI 检查**：后端 check 方法调 LLM 或规则生成 StoryCheckReportDto；前端展示报告。
9. **Story Repair Agent**：可选，后续按需实现。

---

## ✅ 约束与说明

- **不修改**现有 `EpisodeStoryVersionService`、`EpisodeStoryVersionController`、`dto/episode-story-version.dto.ts`；仅通过 `EpisodeStoryVersionService.create` 写库。
- **核心三表**始终注入：novel_episodes、drama_structure_template、novel_hook_rhythm。
- **批次生成**保证 61 集连续性，避免单次大 prompt；每批 3–5 集，默认 5。
- **draft cache + persist** 解耦生成与写库；persist 支持 draftId 优先、draft 兜底。
- **AI 检查**首轮只做读（返回报告），不自动修复。
- **前端进度**采用阶段状态文案 + 定时器估算，最小侵入。

---

*Blueprint 版本：1.0，可与 `docs/episode-story-generation-discovery.md` 对照使用。*
