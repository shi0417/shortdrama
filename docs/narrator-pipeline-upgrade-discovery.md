# Narrator 3 阶段流水线升级 Discovery

## 目标与范围

基于当前 main 分支真实代码的**只读分析**，为将 narrator 单链路生成升级为「可控的 3 阶段生成流水线」提供依据。  
本轮**禁止改代码**，仅输出 discovery 报告。

**任务背景**：当前为单次大 prompt → `generateNarratorScriptsWithLlm` → 严格 JSON 解析 → draft → persist 四表；在 prompt 大、一次 5 集且要求完整 JSON 时易失败。目标升级为：

- **Phase A**：Context/Story Planner + Scene Architect → 输出 episode_script_versions、episode_scenes  
- **Phase B**：Shot Writer → 输出 episode_shots  
- **Phase C**：Prompt Builder + QA/Repair → 输出 episode_shot_prompts，支持定点修复

---

## 一、当前 narrator 单链路必须保留不动的部分

以下逻辑**必须保留**，不可删除或替换为其它写库路径：

| 项目 | 位置与说明 |
|------|------------|
| **Draft cache** | `NarratorScriptService`：`draftCache: Map<string, CachedNarratorScriptDraft>`，`DRAFT_CACHE_TTL_MS`（30min）、`MAX_CACHED_DRAFTS`（50）、`cleanExpiredDrafts()`、`enforceDraftCacheLimit()`、`getCachedDraft(draftId)`。persist 时 draftId 优先，cache miss 时前端可传全量 draft。 |
| **persistDraft** | `NarratorScriptService.persistDraft(novelId, dto)`（约 597–779 行）：resolve draft（draftId 或 dto.draft）→ 校验 novelId、scripts 非空 → **单事务**内按 script 循环：查 novel_episodes 取 source_episode_id、MAX(version_no)+1、UPDATE is_active=0、INSERT episode_script_versions → 每 scene INSERT episode_scenes → 每 shot INSERT episode_shots、episode_shot_prompts。 |
| **version_no / is_active** | 同上事务内：同 novel_id+episode_number 先 `UPDATE episode_script_versions SET is_active = 0`，再 INSERT 新 version 且 is_active=1；version_no 由 `COALESCE(MAX(version_no),0)+1` 得到。 |
| **四表事务写入** | 仅此一处写入生产层四表：episode_script_versions、episode_scenes、episode_shots、episode_shot_prompts。不得在 Phase A/B/C 中另开路径直接写四表（可写中间态或调用现有 persist 入参）。 |
| **页面入口** | `EpisodeScriptsPage`（`apps/web/src/components/production/EpisodeScriptsPage.tsx`）与 `NarratorScriptGenerateDialog`；按钮「生成旁白主导脚本初稿」「保存草稿」；入口路由 `/projects/[novelId]/pipeline/episode-scripts`。 |
| **现有 DTO / API 兼容** | `NarratorScriptGenerateDraftDto`、`NarratorScriptPersistDto`、`NarratorScriptDraftPayload`（scripts: NarratorScriptVersionDraft[]）；POST `:novelId/narrator-script-preview-prompt`、`narrator-script-generate-draft`、`narrator-script-persist`。新链路若仍产出同一 draft 结构，可继续走现有 persist；若改为分阶段落库，需明确是「最终仍组一份 draft 调 persist」还是「分阶段写库 + 仅部分调用 persist」。 |

---

## 二、3 阶段最小侵入拆分点

基于 `narrator-script.service.ts` 当前流程：

1. **Phase A 切开点**  
   - **当前**：`generateDraft` → 按批 `getContext` → `buildNarratorUserPrompt`（含任务+分集+世界观+**完整 JSON 契约**：scripts[].scenes[].shots[].prompts）→ `generateNarratorScriptsWithLlm` → `parseNarratorJson` → `normalizeScripts`（含 scenes、shots、prompts）→ 合并进 draft。  
   - **最小侵入**：在「调用 LLM」处切开。Phase A 专用 prompt：**仅要求输出 scripts[].scenes[]**，且 scenes 中 **不包含 shots**（或 shots 为空数组）。即：  
     - 新建或复用 `buildNarratorUserPromptPhaseA(episodeLines, worldviewBlock, userInstruction)`，JSON 契约仅含 episodeNumber、title、summary、scriptType、scenes[]（sceneNo、sceneTitle、locationName、sceneSummary、mainConflict、narratorText、screenSubtitle、estimatedSeconds），**无 shots**。  
     - Phase A 的 LLM 返回解析后，得到 `NarratorScriptVersionDraft[]` 且每 scene 的 `shots` 为空或占位；**只写** episode_script_versions、episode_scenes（可走现有 persist 的「仅 versions+scenes 部分」或先落库再为 Phase B 提供 scene_id）。  
   - **结论**：Phase A 从「单次大 prompt 请求」改为「单次仅版本+场景的 prompt 请求」，输出仅 versions + scenes；写入可由 persist 的现有事务逻辑复用（只喂入带空 shots 的 draft）或拆出「仅写 versions+scenes」的 writer。

2. **Phase B 切开点**  
   - **当前**：同一份 draft 里已有 shots（visualDesc、narratorText、prompts 等）。  
   - **最小侵入**：Phase B 的**输入**为 Phase A 产出的 episode_script_versions + episode_scenes（或等价的 SceneDraft[]）；**输出**为每 scene 下的 episode_shots。  
   - 切开方式：**按 scene 或按 batch 调用 LLM**，输入 = 该 scene 的 scene_title、narrator_text、location 等 + 世界观摘要；输出 = 仅 shots[]（shotNo、shotType、visualDesc、narratorText、dialogueText、subtitleText、durationSec、cameraMovement、emotionTag），**prompts 可为空或占位**。  
   - 写入：调用 `EpisodeShotService.create(sceneId, dto)` 逐条写入 episode_shots；不写 episode_shot_prompts。  
   - **结论**：Phase B 在「已有 versions+scenes」之后执行，从「单次全量 JSON」中拆出「按 scene 生成 shots」的多次小请求；输出只写 episode_shots。

3. **Phase C 切开点**  
   - **当前**：shots 内 prompts 在 `normalizeShot` 中由 LLM 一次产出并落入 draft，persist 时写 episode_shot_prompts。  
   - **最小侵入**：Phase C 的**输入**为 Phase B 产出的 episode_shots（或 ShotDraft[]，含 visualDesc、narratorText 等）；**输出**为每个 shot 的 episode_shot_prompts（prompt_type、prompt_text、negative_prompt 等）。  
   - 切开方式：**按 shot 或按 batch** 生成/补齐 prompt 文本（可 LLM 或模板）；再调用 `EpisodeShotPromptService.create(shotId, dto)` 写入；QA/Repair 仅针对缺失或不合格的 prompt 行做定点修复，不整批重跑 Phase A/B。  
   - **结论**：Phase C 在「已有 versions+scenes+shots」之后执行，只负责生成并写入 episode_shot_prompts，并可做单 shot 维度的校验与修复。

---

## 三、可直接复用的现有 Service

| Service / 方法 | 复用方式 |
|----------------|----------|
| **EpisodeScriptVersionService** | `create(novelId, dto)`、`getNextVersionNo`、`deactivateOthersForEpisode` 可用于 Phase A 写入 version；`listByNovel`、`getByNovelAndEpisode`、`getActiveByNovelAndEpisode` 用于读取。需传入 `CreateEpisodeScriptVersionDto`（episodeNumber、scriptType、title、summary、sourceEpisodeId 等）。 |
| **EpisodeSceneService** | `create(scriptVersionId, dto)` 用于 Phase A 写入单条 scene；`listByScriptVersion` 用于 Phase B 读取某 version 下所有 scene。需传入 `CreateEpisodeSceneDto`（sceneNo、sceneTitle、locationName、sceneSummary、mainConflict、narratorText、screenSubtitle、estimatedSeconds、sortOrder）。 |
| **EpisodeShotService** | `create(sceneId, dto)` 用于 Phase B 写入单条 shot；`listByScene` 用于 Phase C 读取某 scene 下所有 shot。需传入 `CreateEpisodeShotDto`（shotNo、shotType、visualDesc、narratorText、dialogueText、subtitleText、durationSec、cameraMovement、emotionTag、sortOrder）。 |
| **EpisodeShotPromptService** | `create(shotId, dto)` 用于 Phase C 写入单条 prompt；`listByShot` 用于 QA/展示。需传入 `CreateEpisodeShotPromptDto`（promptType、promptText、negativePrompt、modelName、stylePreset）。 |
| **NarratorScriptService** | `assertNovelExists`、`getNarratorDefaultModel`、`trimStr`、`getLcApiEndpoint`、`getLcApiKey`、`parseOuterResponse`、`extractAiText`、`parseNarratorJson`、`extractTopLevelJson` 可复用；`buildNarratorUserPrompt` 可拆成 Phase A 专用版本（无 shots/prompts 的契约）；`normalizeScripts`/`normalizeOneScript`/`normalizeScene`/`normalizeShot` 可部分复用或仿写用于 Phase A/B 的 JSON 规范化。**persistDraft** 保持不动，可作为「兼容模式」入口：若 3 阶段最终组出与现 draft 同构的 payload，仍可调 persistDraft 一次写四表。 |
| **PipelineReferenceContextService** | `getContext(novelId, options)`、`buildNarratorPromptContext(context, { charBudget })`、`buildReferenceSummary(context)` 完全复用；Phase A/B/C 均可按需传不同 `requestedTables`、`optionalTablesCharBudget`。 |

---

## 四、中间产物 Schema 设计（typed object）

以下为与现有 DTO 对齐的中间结构，便于阶段间传递与校验：

```ts
// Phase A 输出：仅版本 + 场景（无 shots 或 shots 为空）
interface EpisodePlanDraft {
  episodeNumber: number;
  title: string;
  summary: string;
  scriptType: string;
  scenes: SceneDraft[];
}

// 与现有 NarratorScriptSceneDraft 对齐，但 shots 可选或为空
interface SceneDraft {
  sceneNo: number;
  sceneTitle: string;
  locationName?: string;
  sceneSummary?: string;
  mainConflict?: string;
  narratorText?: string;
  screenSubtitle?: string;
  estimatedSeconds?: number;
  shots?: ShotDraft[];  // Phase A 可无；Phase B 产出
}

// 与现有 NarratorScriptShotDraft 对齐
interface ShotDraft {
  shotNo: number;
  shotType?: string;
  visualDesc: string;
  narratorText?: string;
  dialogueText?: string;
  subtitleText?: string;
  durationSec?: number;
  cameraMovement?: string;
  emotionTag?: string;
  prompts?: ShotPromptDraft[];  // Phase B 可无或占位；Phase C 产出
}

// 与现有 NarratorScriptShotPromptDraft 对齐
interface ShotPromptDraft {
  promptType: string;
  promptText: string;
  negativePrompt?: string;
  modelName?: string;
  stylePreset?: string;
}

// 校验/修复用
interface ValidationIssue {
  code: string;
  message: string;
  path?: string;        // 如 "scripts[0].scenes[1].shots[2]"
  episodeNumber?: number;
  sceneNo?: number;
  shotNo?: number;
  promptIndex?: number;
}
```

现有 DTO 已具备：`NarratorScriptVersionDraft`、`NarratorScriptSceneDraft`、`NarratorScriptShotDraft`、`NarratorScriptShotPromptDraft`（`dto/narrator-script.dto.ts`）。Phase A/B/C 的中间产物可直接复用上述 interface，仅在各阶段约定「哪些字段在本阶段必填、哪些可空」。

---

## 五、3 阶段后端 API 设计比较

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| **方案 1：单 generate 接口内同步跑完三阶段** | 保留 POST `narrator-script-generate-draft`，在其内部按顺序执行 Phase A → Phase B → Phase C（或 A→B→C 全部完成后再组 draft 并写 cache，最后仍返回 draftId + draft）。 | 与现有前端一致，无需轮询、无需 task 表；实现上可在 NarratorScriptService 内新增 `generateDraftThreePhase` 或扩展现有 `generateDraft` 的 `generationMode`。 | 请求耗时长，需合理设置 timeout；若某阶段失败需决定是否回滚已写库（Phase A/B 若已落库则需定义「部分成功」策略）。 |
| **方案 2：创建 task、后端异步执行、前端轮询** | 新增 POST 创建「narrator 生成任务」，返回 taskId；前端轮询 GET task 状态与阶段进度；三阶段在 worker/后台跑完后再提供 draft 或直接写四表。 | 可避免 HTTP 长连接与超时；适合大批量（如 61 集）。 | 需引入 task 存储、状态机、幂等与重试；当前代码库无现成 task 队列，实现成本高。 |

**推荐**：**方案 1**。理由：当前项目无 task 基础设施；先实现「单接口内同步三阶段」可最小侵入、复用现有 DTO 与 persist；若后续出现 timeout 或批量需求，再考虑方案 2 或分批调用（如 Phase A 按批、Phase B/C 按 scene/shot 批）。

---

## 六、前端进度提示最小侵入方案比较

| 方案 | 实现 | 侵入度 | 推荐度 |
|------|------|--------|--------|
| 只显示 loading 文案 | 生成中显示「生成中…」，无阶段区分。 | 最低，当前已有。 | 可作为基线保留。 |
| 百分比进度条 | 需后端返回进度百分比或前端按「批数/阶段」估算。若后端不返进度则前端只能估。 | 中；若后端不配合则不准。 | 可选，非最小必需。 |
| 阶段状态 + 文案提示 | 前端根据请求阶段传参或响应中的 `phase` 字段显示「Phase A：生成版本与场景…」「Phase B：生成镜头…」「Phase C：生成提示词…」。单接口同步时可在同一请求内无法分步返回，可用「生成中（共 3 阶段）」或后端用 Server-Sent Events 推送阶段（需改协议）。 | 中；若保持单请求则只能预估文案。 | **推荐**：在不改协议前提下，前端固定展示「生成中（版本与场景 → 镜头 → 提示词）」类文案即可。 |
| task detail 轮询 | 与方案 2 配套：轮询 GET task 返回 currentPhase、progress、message。 | 高，依赖异步 task API。 | 仅在采用方案 2 时使用。 |

**推荐**：在采用**方案 1（单接口同步三阶段）**时，前端**最小侵入**为：保持现有「生成中…」loading，可选增加**静态阶段文案**（如「生成中：版本与场景 → 镜头 → 提示词」），无需后端新增进度字段；若未来改为异步 task，再上 task 轮询与阶段/进度展示。

---

## 七、质量最优时默认参考表分层

基于 `pipeline-reference-context.service.ts` 的 `CORE_REFERENCE_TABLES`（novel_episodes、drama_structure_template、novel_hook_rhythm）与 `NARRATOR_DEFAULT_EXTENSION`（set_core、set_payoff_*、set_opponents、set_power_ladder、set_story_phases、novel_characters、novel_key_nodes、novel_timelines）：

| 阶段 | 建议默认参考表 | 说明 |
|------|----------------|------|
| **Phase A** | 核心三表 + set_core、novel_characters、novel_key_nodes、novel_timelines、set_payoff_arch、set_payoff_lines、set_story_phases | 做「版本+场景」规划，需要集信息、结构、节奏与人物/时间线；**不建议默认带** novel_source_segments、drama_source_text（体量大、易撑爆 prompt、增加 JSON 失败率）。 |
| **Phase B** | 核心三表 + 同上，可略减（如仅 set_core、novel_characters、set_payoff_arch） | 按 scene 生成 shots，上下文可略小于 Phase A；**同样不建议默认** novel_source_segments、drama_source_text。 |
| **Phase C** | 可选：仅 set_core、novel_characters 或空 | 生成单条 prompt 文本，以 shot 的 visualDesc、narratorText 为主；大表**不应默认**进入。 |

**大表（novel_source_segments、drama_source_text）**：不默认进入任何阶段；若用户显式勾选，建议仅在 Phase A 且严格控制 optionalTablesCharBudget（如 8000–15000），并配合较小 batchSize。

---

## 八、单次 JSON 失败的最小缓解措施

| 措施 | 建议 | 依据 |
|------|------|------|
| **batchSize 默认值** | 将 `DEFAULT_BATCH_SIZE`（当前 5）降为 **2 或 3**，减少单次 JSON 体量与 token 上限压力。 | `narrator-script.service.ts` 第 30 行。 |
| **去掉 source_segments / source_text 默认勾选** | 前端 `defaultNarratorOptionalReferenceTables` 与后端 `NARRATOR_DEFAULT_EXTENSION` 中**不包含** novel_source_segments、drama_source_text；用户可选勾选。 | 当前前端默认表见 `episode-script.ts`；后端见 `pipeline-reference-context.service.ts` 第 36–46 行。 |
| **Phase A/B 先不生成 prompts** | 3 阶段拆分后，Phase A 只出 versions+scenes，Phase B 只出 shots（prompts 为空或占位），Phase C 再生成 prompts；单次 LLM 输出体量显著减小。 | 与第二节拆分点一致。 |
| **JSON repair / extraction 层** | 已有 `parseNarratorJson`、`extractTopLevelJson`（括号匹配提取顶层 JSON）；失败时 `logger.warn` 打 snippet。可再增强：对 Phase A/B 的简化 JSON 做更宽松的 strip（多行说明、markdown），或对单阶段输出做「必填字段缺失时占位填充」的 repair，避免整批失败。 | `narrator-script.service.ts` 约 416–473 行。 |

---

## 九、文件级改动清单

| 类型 | 文件路径 | 说明 |
|------|----------|------|
| **必要修改** | `apps/api/src/pipeline/narrator-script.service.ts` | 新增或拆分：Phase A 用 prompt 构建与 LLM 调用（仅 versions+scenes）；Phase B 按 scene 生成 shots 的逻辑与调用；Phase C 按 shot 生成 prompts 的逻辑与调用；或新增 `generateDraftThreePhase` 并在内部串起三阶段；保留现有 `generateDraft`（单链路）、`persistDraft`、draft cache 不变。 |
| **必要修改** | `apps/api/src/pipeline/dto/narrator-script.dto.ts` | 可选：新增 `EpisodePlanDraft`、`ValidationIssue` 等类型；或复用现有 NarratorScriptVersionDraft 等，仅约定各阶段必填字段。若新增 mode 参数（如 `generationMode: 'single' | 'pipeline'`），需在 DTO 中增加字段。 |
| **可选新增** | `apps/api/src/pipeline/narrator-pipeline.service.ts` | 若希望与 NarratorScriptService 解耦，可新增编排类，负责调用 refContext、Phase A/B/C 的 LLM、EpisodeScriptVersionService/EpisodeSceneService/EpisodeShotService/EpisodeShotPromptService 的 create；NarratorScriptService 仅保留 persistDraft、cache、preview。 |
| **可选新增** | `apps/api/src/pipeline/dto/narrator-pipeline.dto.ts` | 三阶段请求/响应的 DTO（如 Phase A 请求、Phase B 输入为 sceneIds 等）。 |
| **可选修改** | `apps/api/src/pipeline/pipeline.controller.ts` | 若新增「三阶段生成」入口，可增加 POST `:novelId/narrator-script-generate-draft-v2` 或通过现有 generate-draft 的 query/body 参数区分 mode。 |
| **可选修改** | `apps/web/src/components/production/EpisodeScriptsPage.tsx`、`NarratorScriptGenerateDialog.tsx` | 若后端支持 pipeline mode，前端可增加「分阶段生成」选项及阶段进度文案；否则无需改。 |
| **明确不改** | `apps/api/src/pipeline/narrator-script.service.ts` 的 `persistDraft` 方法体 | 四表事务、version_no、is_active 逻辑保持原样。 |
| **明确不改** | `apps/api/src/pipeline/episode-script-version.service.ts`、`episode-scene.service.ts`、`episode-shot.service.ts`、`episode-shot-prompt.service.ts` | 仅使用其 create/list/get/update，不改变接口与表结构。 |
| **明确不改** | `apps/api/src/pipeline/episode-script-production.controller.ts` | 生产层 CRUD 路由与行为不变。 |
| **明确不改** | `apps/api/src/pipeline/pipeline-reference-context.service.ts` | 仅调用 getContext、buildNarratorPromptContext、buildReferenceSummary，不修改其实现。 |

---

## 十、最终推荐实施顺序

1. **Discovery**（本轮）— 完成。  
2. **Blueprint** — 输出 3 阶段详细设计：Phase A/B/C 的入参、出参、调用链、错误与回滚策略、与现有 persist 的衔接方式。  
3. **Phase A 落地** — 实现「仅版本+场景」的 prompt 与 LLM 解析；可写 episode_script_versions + episode_scenes（或产出 draft 仅含 scenes 无 shots，再调现有 persist 只写前两表逻辑/或新写「仅 versions+scenes」的 writer）；保证与现有单链路兼容（如通过 generationMode 切换）。  
4. **Phase B 落地** — 基于 Phase A 产出的 scenes，按 scene 或小批调用 LLM 生成 shots；写入 episode_shots；不写 episode_shot_prompts。  
5. **Phase C 落地** — 基于 Phase B 产出的 shots，按 shot 或小批生成 prompt 文本；写入 episode_shot_prompts；可选实现轻量 QA（必填、长度）与单条 repair。  
6. **UI 进度提示** — 在现有「生成中…」基础上，增加静态阶段文案或（若后端返回 phase）简单阶段状态展示。  
7. **QA/Repair 增强** — 定点修复、重试策略、ValidationIssue 上报与展示；可选。

---

## 十一、未确认项与已确认项

**已确认**：`persistDraft`（约 689–715 行）对 `script.scenes || []` 与 `scene.shots || []` 做循环；当 `scene.shots` 为空或未定义时，内层循环不执行，会正常写入 episode_script_versions 与 episode_scenes，shots/prompts 计数为 0，无外键或业务异常。因此 **Phase A 可以产出「仅含 versions+scenes、shots 为空」的 draft，并调用现有 persistDraft 一次写入前两表**。Phase B 则必须基于已写入的 episode_scenes 的 id，通过 `EpisodeShotService.create(sceneId, dto)` 逐条写入 episode_shots，不能再次用同一份「全量 draft」调 persist（persist 会新建 version，不会对已有 version 追加 shots）。

| 问题 | 影响 | 建议下一步 |
|------|------|------------|
| lc_api 的 timeout 配置与三阶段总时长 | 若三阶段串行总时长超过网关/客户端 timeout，需考虑分批请求或异步 task。 | 未确认当前 env 中 lc_api 超时与 HTTP 网关限制。 |
| Phase A 写库后，Phase B 失败是否回滚 Phase A？ | 决定是「全成功才提交」还是「分阶段提交、部分成功可接受」。 | Blueprint 阶段明确事务边界与补偿策略。 |

---

*Discovery 基于 main 分支现状，仅读代码未做任何修改。*
