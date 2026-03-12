# 生成每集纲要和每集剧本：数据处理策略与日志能力调查报告

## 1. 调查范围

本次仅做取证，不改实现。覆盖以下真实代码链路：

- 前端入口与交互
  - `apps/web/src/components/PipelinePanel.tsx`
  - `apps/web/src/components/pipeline/PipelineEpisodeScriptDialog.tsx`
  - `apps/web/src/lib/pipeline-episode-script-api.ts`
  - `apps/web/src/types/pipeline.ts`
  - `apps/web/src/lib/api.ts`
- 后端入口与核心服务
  - `apps/api/src/pipeline/pipeline.controller.ts`
  - `apps/api/src/pipeline/dto/pipeline-episode-script.dto.ts`
  - `apps/api/src/pipeline/pipeline-episode-script.service.ts`
- 关联下游（证据检索复用）
  - `apps/api/src/source-texts/source-retrieval.service.ts`
- 对照参考（世界观链路）
  - `apps/api/src/pipeline/pipeline-worldview.service.ts`

---

## 2. 入口与调用链

### 2.1 前端调用链

1. 在 `PipelinePanel.tsx` 点击按钮“生成每集纲要和每集剧本”
   - 触发 `handleOpenEpisodeScriptDialog()`
2. 弹窗中点击“刷新 Prompt 预览”
   - 触发 `refreshEpisodeScriptPromptPreview()`
   - 调用 `pipelineEpisodeScriptApi.previewEpisodeScriptPrompt()`
3. 点击“生成草稿”
   - 触发 `handleGenerateEpisodeScriptDraft()`
   - 调用 `pipelineEpisodeScriptApi.generateEpisodeScriptDraft()`
4. 点击“确认写入数据库”
   - 触发 `handlePersistEpisodeScriptDraft()`
   - 调用 `pipelineEpisodeScriptApi.persistEpisodeScriptDraft()`

### 2.2 API 路由链

`pipeline.controller.ts`：

- `POST /pipeline/:novelId/episode-script-preview-prompt` -> `PipelineEpisodeScriptService.previewPrompt()`
- `POST /pipeline/:novelId/episode-script-generate-draft` -> `PipelineEpisodeScriptService.generateDraft()`
- `POST /pipeline/:novelId/episode-script-persist` -> `PipelineEpisodeScriptService.persistDraft()`

### 2.3 Service 主流程链

- 预览：`previewPrompt()`
  - `assertNovelExists()` -> `resolveReferenceTables()` -> `resolveOptionalModelKey()` -> `buildPrompt()`
- 生成：`generateDraft()`
  - 同上到 `buildPrompt()` -> `callLcAiApi()` -> `validateAndNormalizeEpisodePackage()`
- 落库：`persistDraft()`
  - `assertNovelExists()` -> `assertBaseOutputTablesExist()` -> `validateAndNormalizeEpisodePackage()` -> `detectHookRhythmTableIfExists()` -> 事务：
    - `deleteExistingEpisodeScriptData()`
    - `insertEpisodePackage()`

---

## 3. 当前参考数据读取与拼接策略

### 3.1 前端传递的参考表标识

- 由 `PipelineEpisodeScriptDialog.tsx` 的 `referenceTableOptions` 多选产生。
- 实际请求体字段是 `referenceTables: PipelineEpisodeScriptReferenceTable[]`（`PipelinePanel.tsx`）。
- 类型白名单见：
  - 前端：`apps/web/src/types/pipeline.ts`
  - 后端：`apps/api/src/pipeline/dto/pipeline-episode-script.dto.ts` 的 `allowedEpisodeScriptReferenceTables`

### 3.2 后端如何处理参考表选择

- `resolveReferenceTables()`：
  - 若前端未传或为空 -> 使用 `DEFAULT_REFERENCE_TABLES`
  - 只保留在 `allowedEpisodeScriptReferenceTables` 里的表（白名单过滤）
  - 不存在黑名单逻辑

### 3.3 表级优先级与跳过规则

在 `buildPrompt()` 中存在明确优先级：

- `novel_source_segments` 会被提前到最前处理（`prioritizedTables`）
- 若 `novel_source_segments` 命中数量 `segmentEvidenceCount > 0`，且后续遍历到 `drama_source_text`，则直接跳过并写 warning：
  - `已命中 novel_source_segments 证据，跳过 drama_source_text 直注入`

即：**segments 优先，raw source_text 条件性跳过**。

### 3.4 每张表取哪些字段（字段白名单）

`buildReferenceBlock()` 对每张表都写了明确 SQL 与字段列表，且最终 `serializeRows()` 只输出传入 `fields` 中字段。属于“每表显式字段白名单”。

典型示例：

- `drama_novels`：`id, novels_name, total_chapters, power_up_interval, author, description, status`
- `set_core`：`title, core_text, protagonist_name, protagonist_identity, target_story, rewrite_goal, constraint_text`
- `novel_timelines`：`time_node, event, sort_order`
- `novel_characters`：`name, faction, description, personality`
- `novel_key_nodes`：`category, title, description, timeline_id, sort_order`
- `novel_explosions`：`explosion_type, title, subtitle, scene_restoration, dramatic_quality, adaptability, sort_order`
- `novel_skeleton_topics`：`topic_key, topic_name, topic_type, description, sort_order`
- `novel_skeleton_topic_items`：`topic_id, item_title, content, content_json, sort_order`
- 以及 `set_payoff_* / set_opponent_* / set_power_ladder / set_traitor_* / set_story_phases`

### 3.5 裁剪、排序、去重、摘要、合并

- 排序：多数 SQL 都有 `ORDER BY sort_order ASC, id ASC` 或版本倒序。
- 裁剪：
  - `serializeRows()`：行数最多 `80` 条，字符串字段每项最多 `600` 字（`trimBlock`）
  - `drama_source_text`：按 `charBudget * 0.35` 注入，且设置最小上限逻辑
  - `novel_source_segments`：由 `SourceRetrievalService.buildWorldviewEvidence()` 按预算选段
- 去重：
  - 通用参考表未做跨表去重
  - `novel_source_segments` 的检索服务内部做了相似度去重、章节命中限制
- 摘要：
  - 返回 `referenceSummary`（表名、行数、字段、说明、usedChars）
- 合并：
  - prompt 里是“按表（块）顺序拼接”，不是按主题重构融合

### 3.6 `drama_source_text` vs `novel_source_segments` 的真实策略

- 先处理 `novel_source_segments`。
- 命中后跳过 `drama_source_text`（避免重复注入 raw 文本）。
- `novel_source_segments` 检索本身若不可用/不足，会在其内部 fallback 到少量 raw source_text（来自 `SourceRetrievalService`）。
- 因此当前策略是：**优先 segments，raw 作为补位/回退**，不是二者全量并喂。

---

## 4. 当前 prompt 构造方式分析

### 4.1 拼接方式

`buildPrompt()` 用字符串数组拼装，结构为：

1. 任务定义
2. 生成规则（generationMode、durationMode、targetEpisodeCount 强约束）
3. 节奏模板（60s/90s）
4. 输出 JSON 契约（`getJsonContractTemplate()`）
5. 参考资料（`blocks.join('\n\n')`）
6. 用户附加要求

即：**按板块串接的单次长 prompt**，不是结构化中间状态编排。

### 4.2 是否有预算控制

- 有 `sourceTextCharBudget`（1000~120000）输入和后端 `charBudget` 约束；
- 但预算主要作用于 source 证据块（segments/raw source）；
- 对“全部 blocks 拼接后的总 prompt 长度 / token 估算 / 请求体大小”没有统一硬上限与预截断策略；
- 也没有 token 估算字段回传。

### 4.3 Prompt 设计特征

- 强约束写得多（必须 1..N 集、不得缺失）。
- JSON contract 仅给“单集示例”，要求模型重复 N 次。
- 所有选中参考表直接串接进“参考资料”，没有核心/辅助层级差异化写法。

---

## 5. 当前生成流程是否具备分阶段规划

### 结论（明确回答问题 1/6）

**当前 episode-script 链路未实现真正多阶段规划。**

实际是：

- 单次 prompt -> 单次 `callLcAiApi()` -> 直接期望返回最终 JSON -> 解析/校验 -> 返回草稿。

当前未实现：

- “先全集规划再逐集生成”
- “分批（5~10 集）滚动生成”
- “自动二次修复重试（基于校验结果再次调用模型）”
- “多代理/多轮调用 orchestration”

> 代码中也没有多代理调度器；仅是 prompt 文案层面的要求，不是流程层面的拆阶段执行。

---

## 6. 当前校验、解析、修复、入库流程分析

### 6.1 解析链路

- `callLcAiApi()`：
  - 调上游 chat/completions
  - 校验 HTML 响应与 HTTP 状态
  - 解析上游外层 JSON
  - `extractAiText()`
  - `parseJsonObjectFromText()`（去 markdown fence + 截取 `{...}` + dirty-json 再试）
  - 失败抛：`Episode script JSON parse failed: ...`

### 6.2 校验与归一化

`validateAndNormalizeEpisodePackage()` 会做：

- 根节点校验：必须有 `episodePackage`
- episodes 数组不能为空
- `episodeNumber` 唯一性校验（重复直接异常）
- 缺失字段做默认值归一化（标题、sort、powerLevel、hotLevel 等）
- 关键字段警告（非 fatal）：
  - `outline.coreConflict`
  - `structureTemplate.themeType`
  - `structureTemplate.structureName`
  - `script.fullContent/cliffhanger`（仅非 `outline_only` 模式）
- 若传 `targetEpisodeCount`：
  - 校验长度是否一致（warning）
  - 检查 1..N 缺集（warning）

### 6.3 自动修复能力

- 仅有“脏 JSON 容错解析 + 字段默认值归一化”。
- **没有** parse 失败后二次 AI 修复调用。
- **没有** validator 失败后二次生成流程。

### 6.4 入库前后行为

- `persistDraft()` 再次调用 `validateAndNormalizeEpisodePackage()`（但不传 `targetEpisodeCount`，因此落库时不做目标集数一致性校验）。
- 输出表硬依赖：`novel_episodes`、`drama_structure_template`（缺表直接报错）。
- `novel_hook_rhythm` 是可选：
  - 表不存在：warning 并跳过
  - 字段不兼容：warning 并跳过
- 删除再插入按 episodeNumber 范围覆盖，事务执行。

---

## 7. 当前日志与调试能力分析

### 7.1 前端日志能力

- `PipelinePanel.tsx` 在 episode-script 链路没有参数摘要日志（无 `console`、无埋点）。
- 失败只通过 `alert(err.message)` 向用户展示。
- `apiClient()` 会把后端错误体解析成 `Error` 的 message/warnings/details，但不主动记录请求上下文。

### 7.2 后端日志能力

在 `pipeline-episode-script.service.ts`：

- 无 Nest Logger 注入
- 无 `console.log`
- 无请求耗时统计
- 无 endpoint/model/prompt length/payload size 记录
- 无 fetch start/end、状态码、响应长度结构化日志

仅在异常 message 中嵌入了部分信息（例如 endpoint/status/body 摘要）。

### 7.3 对题目要求项逐条对照

未看到显式记录（当前未实现）：

- `novelId / generationMode / durationMode / targetEpisodeCount / selected referenceTables` 的结构化日志
- prompt 字符数、token 估算、body 大小
- 上游 URL（脱敏）与超时设置（更没有 timeout 机制）
- fetch 开始/结束时间、响应体长度
- parse 失败样本持久化/可检索日志
- validator 失败统计日志
- 最终写入表数量日志（仅通过 API 返回给前端，不写服务端日志）

---

## 8. 对本次 fetch failed / JSON parse failed 的定位能力评估

### 8.1 `fetch failed` 的定位能力

当前能力：**不足**。

原因：

- `callLcAiApi()` 没有 `try/catch` 包裹网络层异常（DNS/连接重置/超时/TLS）。
- 没有错误类型分层（network vs HTTP vs parse）。
- 没有请求上下文日志（model、payload 长度、novelId、referenceTables）。
- 无 retry、无 timeout、无 request id。

因此当出现 “fetch failed” 时，通常只能拿到上游 runtime 抛错文本，难以区分：

- DNS 问题
- 链路超时
- 连接被重置
- 请求体过大
- URL 拼接错误
- API key/网关策略问题

### 8.2 `Episode script JSON parse failed` 的定位能力

当前能力：**中等偏低**。

已有：

- 抛错会附带前 400 字片段，能看到部分坏样本。

不足：

- 没有保存完整原始返回（脱敏后）或关联请求上下文；
- 没有自动 repair / retry；
- 没有 parse 失败原因分型（截断、引号问题、结构不闭合等）统计。

---

## 9. 当前方案的主要风险

以下为最大 5 个风险（明确回答问题 9）：

1. **单次大任务风险**：要求一次输出 1..N（如 61 集）完整 JSON，长度和一致性压力极大，易出现缺集/结构漂移。
2. **输入语义过载风险**：可同时投喂大量表，且存在语义重叠（如 skeleton/key_nodes/explosions/多套 set_*），增加模型混淆概率。
3. **预算不闭环风险**：仅局部 char budget，缺少全局 prompt/token/payload budget，易触发上游限额或性能不稳。
4. **异常可观测性不足**：`fetch failed` 缺乏结构化日志与分层错误，线上定位成本高。
5. **恢复链路薄弱**：parse/validate 失败无自动二次修复流程，导致失败直接返回给用户。

补充风险：

- 落库阶段未强制校验“目标集数完整一致”（persist 不带 `targetEpisodeCount`）。
- `generationMode` 在 persist 使用的是前端当前状态，不是草稿生成时状态（有潜在语义偏差风险）。

---

## 10. 更合理的数据使用与生成规划建议

> 仅建议，不实现（明确回答问题 10）。

### 10.1 参考数据分层（建议）

建议将输入拆为 5 层，按优先级组织 prompt：

1. **核心约束层（必须）**
   - `drama_novels(total_chapters, power_up_interval)`
   - `set_core`
   - `novel_adaptation_strategy` + `adaptation_modes`
2. **剧情骨架层（强相关）**
   - `novel_timelines`
   - `novel_key_nodes`
   - `novel_skeleton_topics`
   - `novel_skeleton_topic_items`
3. **角色与阵营层（中强相关）**
   - `novel_characters`
   - `set_opponent_matrix` / `set_opponents`
   - `set_traitor_system` / `set_traitors` / `set_traitor_stages`
4. **节奏控制层（可选强化）**
   - `novel_explosions`
   - `set_payoff_arch` / `set_payoff_lines`
   - `set_power_ladder` / `set_story_phases`
5. **证据素材层（受预算严格控制）**
   - 优先 `novel_source_segments`
   - `drama_source_text` 仅 fallback/补位

### 10.2 生成流程分阶段（建议）

建议改为：

- 阶段 A：先产出“全集 plan（每集一句/两句结构骨架）”
- 阶段 B：按 5~10 集分批生成详细 episodePackage 片段
- 阶段 C：汇总后做结构化 validator + 自动修复轮

优点：

- 大幅降低单次输出失败率
- 便于精确重试（只重试失败批次）
- 更容易做 token/payload 预算控制

### 10.3 输入压缩与预算（建议）

- 对非核心层默认做更强裁剪（行数/字段/字段字数）
- 引入统一预算：
  - prompt budget（字符）
  - payload budget（HTTP body 大小）
  - token budget（估算）
- 超预算时按层级丢弃低优先级资料并给出 warning。

### 10.4 校验与自动修复（建议）

- 引入“结构化 validator + repair prompt”
- 对缺集、跳号、关键字段缺失触发二次修复调用
- parse 失败时把“错误摘要 + contract + 原输出片段”回喂做一次修复重试

---

## 11. 建议增加的日志点位（只建议，不实现）

以下建议日志为“最小可排障集”，建议先加在 `pipeline-episode-script.service.ts`：

1. `generateDraft()` 入参摘要（不含敏感文本）
   - `novelId, modelKey, generationMode, durationMode, targetEpisodeCount, referenceTables.length/list`
2. `buildPrompt()` 结束后
   - `promptChars, referenceSummary(rowCount/usedChars), skippedTables(如跳过 drama_source_text)`
3. `callLcAiApi()` 请求前
   - `endpoint(host+path), model, bodyBytes, timeoutMs`
4. `callLcAiApi()` 响应后
   - `status, elapsedMs, contentType, responseBytes`
5. `callLcAiApi()` catch 网络异常
   - 错误类型、错误码、endpoint、elapsedMs
6. `parseJsonObjectFromText()/parsePossiblyDirtyJson()` 失败
   - `parseStage, snippetHash/length, snippetPrefix(截断)`
7. `validateAndNormalizeEpisodePackage()` 输出
   - `episodesCount, missingEpisodeCount, warningCount`
8. `persistDraft()` 事务前后
   - `episodeNumbers(range), deletedRows/insertedRows summary, affectedTables/skippedTables`

前端建议（`PipelinePanel.tsx`）：

- 点击“生成草稿”时输出一次调试摘要（开发环境开关）：
  - `novelId, modelKey, generationMode, durationMode, targetEpisodeCount, referenceTables.length`
- 收到响应时输出：
  - `actualEpisodeCount, warningCount, normalizationWarningCount, validationWarningCount`

---

## 12. 待确认项

1. `totalChapters` 是否总是有值：
   - 若为空，当前 prompt 会出现 `目标集数：?`，并弱化约束。
2. 上游网关的 body/token 限额：
   - 当前无统一预算治理，需要确认网关阈值（含超限返回模式）。
3. 是否允许在服务端保存 AI 原始响应（脱敏）用于排障：
   - 涉及合规与成本策略。
4. 业务是否接受“先 plan 再分批生成”：
   - 这将改变当前“一次生成全部”的交互预期。
5. `generationMode` 在 persist 阶段应以“草稿生成时模式”为准还是“当前 UI 模式”为准：
   - 当前实现为后者，建议产品定义清晰。

---

## 必答问题汇总（简答版）

1. **当前是否真有整体步骤规划？**  
   否。当前是单次 prompt 直出最终 JSON，未实现分阶段编排。

2. **哪些表是核心输入，哪些是附加材料？**  
   代码未显式分层；现实上 `drama_novels/set_core/strategy/mode + source evidence`更核心，其余多为补充。

3. **是否存在重复数据/语义重叠？**  
   是。多表可同时注入且无跨表去重。

4. **是否有字段裁剪与摘要机制？**  
   有。每表字段白名单 + 行数/字段长度裁剪 + `referenceSummary`。

5. **是否有 payload/token 大小控制？**  
   部分有（source char budget），但无全局 prompt/token/body 预算闭环。

6. **是否有多阶段生成与质检？**  
   无（episode-script）。仅一次生成 + 归一化校验 warning。

7. **是否有针对 fetch failed 的足够日志？**  
   不足。缺结构化日志、错误分型、耗时与重试信息。

8. **是否有针对 JSON parse failed 的恢复策略？**  
   无自动恢复。只有脏 JSON 容错解析，失败即抛错。

9. **当前 prompt 与数据投喂最大 5 风险？**  
   单次超大输出、输入过载、预算不闭环、可观测性不足、无自动修复。

10. **更合理整体方案？**  
    输入分层 + 先全集 plan + 分批生成 + 汇总校验修复 + 预算治理 + 完整可观测日志。

