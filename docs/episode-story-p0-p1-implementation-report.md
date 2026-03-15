# Episode Story P0+P1 最小闭环改造 — 实现报告

本文档对应审计报告中的 P0/P1 六项改造，目标将 `episode_story_versions.story_text` 从「摘要体」提升为「60秒/90秒可拍短剧体」，不推翻现有架构。

---

# 1. 修改文件清单

| 文件 | 变更类型 |
|------|----------|
| `apps/api/src/pipeline/episode-story-generation.service.ts` | 修改 |
| `apps/api/src/pipeline/dto/episode-story-generation.dto.ts` | 修改 |
| `apps/web/src/types/episode-story.ts` | 修改 |
| `docs/episode-story-p0-p1-implementation-report.md` | 新增 |

未修改：`pipeline-reference-context.service.ts`（仅在使用处按 batch 范围调用已有 `getContext(startEpisode/endEpisode)`）、`pipeline.controller.ts`、`episode-story-version.service.ts`（仅接收并写入已有 `storyBeatJson` 字段）。

---

# 2. P0/P1 六项改造分别如何落地

## 1）Writer prompt 增加「60/90秒可拍短剧单元」硬约束

- **位置**：`episode-story-generation.service.ts` 内 `runWriterBatch` 的 `systemMsg` 与 `userMsg`。
- **改动**：
  - System：重写为「本批输出的是 **60秒或90秒可拍短剧故事单元**」，并列出 9 条必须遵守（每集 360–520 字、第一人称、前 3 句强钩子、15 秒内冲突升级、中段反转、事件型尾钩、单集单目标、可视化动作、rewrite_goal + ending guard）。
  - 明确要求「必须兑现 storyBeat 中的开钩/冲突/反转/尾钩，不允许只参考不落实」。
  - User：改为「上一批最后一集结尾片段（用于衔接）」+ 可选上集摘要；并写明「本批为可拍短剧单元」「参考上下文（节选，已按本批集数过滤）」。

## 2）Persist 口播下限从 260 提升到 360（支持可配置）

- **位置**：同文件，常量与 `assertDraftQualityBeforePersist`。
- **改动**：
  - 新增常量 `MIN_NARRATION_CHARS_STRONG = 360`；保留 `MIN_STORY_TEXT_LENGTH_ABSOLUTE = 50`（原 `MIN_STORY_TEXT_LENGTH` 重命名）及 260/360 的评估用常量。
  - Persist 门禁：由「`ev.tooShortForNarration`（<260）」改为「`ev.charCount < MIN_NARRATION_CHARS_STRONG`（<360）」即拦截，错误信息明确为「不足 360 字，不足以支撑 60 秒可拍短剧旁白」。
  - 可配置：当前为常量；若需环境/配置项，可在同处改为读取 `process.env` 或配置服务，默认 360。

## 3）Persist 对弱钩子/仅问句钩子增加硬拦截（非终局集）

- **位置**：`assertDraftQualityBeforePersist` 内，对每集调用 `evaluateStoryTextForShortDrama` 后的分支。
- **改动**：
  - 仅当 `epNum < 59` 时：
    - 若 `ev.severeWeakHook === true`，抛错：「结尾钩子过于空泛（仅抽象词无具体对象），不符合可拍短剧尾钩要求。Persist blocked.」
    - 若 `ev.questionHookOnly === true`，抛错：「结尾仅问句钩子、缺少事件型尾钩，不符合可拍短剧要求。Persist blocked.」
  - 55–61 集终局段不因弱钩子/问句钩子单独拦截（保留原有终局收束与 rewrite_goal 门禁）。

## 4）Batch continuity 改为使用「上一批最后一集 storyText 尾段」

- **位置**：`episode-story-generation.service.ts` 中 `generateDraft` 的循环与 `runWriterBatch` 的参数及 user 消息。
- **改动**：
  - 新增私有方法 `extractStoryTailForContinuation(text: string, maxChars = 200)`：取 `text` 末尾最多 `maxChars` 字，用于衔接。
  - `generateDraft` 循环内：每批结束后更新 `prevTail = extractStoryTailForContinuation(last.storyText, 200)` 与 `prevSummary = last.summary ?? ''`；下一批传入 `runWriterBatch` 的为 `prevTail` 与 `prevSummary`。
  - `runWriterBatch` 签名由 `prevSummary: string` 改为 `prevTail: string, prevSummary: string`；user 消息改为「上一批最后一集结尾片段（用于衔接）：\n{prevTail}\n\n（上集摘要：{prevSummary}）\n\n本批规划：...」，无上一批时仅「本批规划：...」。

## 5）参考表按 batch 集数过滤

- **位置**：同上，新增 `buildContextBlockForWriterBatch`，`generateDraft` 每批调用。
- **改动**：
  - 新增私有方法 `buildContextBlockForWriterBatch(novelId, referenceTables, batchStartEp, batchEndEp, charBudget)`：
    - 调用 `refContext.getContext(novelId, { requestedTables, startEpisode: batchStartEp, endEpisode: batchEndEp, ... })`，使核心三表中的 `novel_episodes`、`novel_hook_rhythm` 已按集数范围过滤。
    - 对 `context.optionalTables` 中 `set_payoff_lines`、`set_story_phases` 按行过滤：仅保留 `start_ep <= batchEndEp && end_ep >= batchStartEp` 的行（字段兼容 `start_ep`/`end_ep`）。
    - 用过滤后的 context 拼出与 `buildContextBlocks` 同格式的「核心参考 + 扩展参考」字符串并返回。
  - `generateDraft` 每批调用 `buildContextBlockForWriterBatch(novelId, referenceTables, startEp, endEp, sourceTextCharBudget)`，将返回的字符串传入 `runWriterBatch` 的 `contextBlock`，不再使用全集的 `promptPreview` 作为 writer 上下文。

## 6）Persist 前强制跑一次 QA，QA 不通过禁止写库

- **位置**：`persistDraft` 流程；`runRuleBasedCheck` 逻辑。
- **改动**：
  - **强化 runRuleBasedCheck**：对每集若有正文则调用 `evaluateStoryTextForShortDrama`，按结果追加 `episodeIssues`（含 type/message/severity），并扣分：缺正文/过短、口播不足 360、第三人称/第一人称不足、事件密度极低、非终局集严重弱钩子/仅问句钩子、59+ 缺收束、rewrite_goal 违规等，使总分可低于 60；`passed` 定义为 `overallScore >= 60 && 不存在任意 high severity issue`。
  - **persistDraft**：在 `resolveDraftForPersist` 之后、`assertDraftQualityBeforePersist` 之前，调用 `runRuleBasedCheck(draft)`：
    - 若 `qaReport.overallScore < 60`，抛 `BadRequestException`：「QA 未通过：综合评分为 xx，低于 60，禁止写入。请根据检查结果修订草稿后再试。」
    - 若存在任意 `severity === 'high'` 的 issue，抛 `BadRequestException`：「QA 未通过：第 x、y、z 集存在高严重度问题（如尾钩过弱、事件密度不足、第一人称不足等），禁止写入。请修订后再试。」
  - 通过 QA 后再执行原有 `assertDraftQualityBeforePersist` 及逐条 `create`。

---

# 3. Writer prompt 改造前后对比

- **改造前**：系统提示为「短剧故事正文写作助手」，3 条必须遵守（第一人称、结尾事件钩子优先、rewrite_goal）+ ending guard；user 为「上一批最后一集摘要」+ 本批规划 + 参考上下文（全集节选）。
- **改造后**：
  - **系统**：明确「本批输出的是 **60秒或90秒可拍短剧故事单元**」，并增加：每集 360–520 字、前 3 句强钩子、15 秒内冲突升级、中段反转、事件型尾钩、单集单目标、可视化动作；强调「必须兑现 storyBeat 中的开钩/冲突/反转/尾钩」；保留第一人称、rewrite_goal 与 ending guard。
  - **User**：「上一批最后一集结尾片段（用于衔接）」+ 可选上集摘要；「本批为可拍短剧单元」；「参考上下文（节选，已按本批集数过滤）」。

---

# 4. Persist 新硬门槛说明

以下情况会被拒绝写库（并返回明确错误信息）：

| 条件 | 错误说明 |
|------|----------|
| 占位或正文非字符串 | Episode story draft contains placeholder or too-short storyText. Persist blocked. |
| 正文 trim 后长度 < 50 | 同上 |
| 正文为占位串模板 | 同上 |
| 55+ 集终局违规（rewrite_goal） | 第 N 集内容与改写目标不符（不得出现朱棣攻破南京、建文朝覆灭等结局）。Persist blocked. |
| 前 120 字无「我」且「沈照/她」≥2 | 第 N 集 storyText 前段无第一人称且第三人称明显，请改为第一人称旁白（沈照视角）。Persist blocked. |
| 前 200 字第三人称主导且无「我」 | 第 N 集 storyText 为第三人称摘要式，请改为第一人称旁白（沈照视角）。Persist blocked. |
| **字数 < 360** | 第 N 集 storyText 字数过短（xx 字），不足 360 字，不足以支撑 60 秒可拍短剧旁白。Persist blocked. |
| **非终局集（<59）且 severeWeakHook** | 第 N 集 结尾钩子过于空泛（仅抽象词无具体对象），不符合可拍短剧尾钩要求。Persist blocked. |
| **非终局集（<59）且 questionHookOnly** | 第 N 集 结尾仅问句钩子、缺少事件型尾钩，不符合可拍短剧要求。Persist blocked. |
| 事件密度极低（eventDensitySeverelyLow） | 第 N 集 动作事件密度严重不足，更接近梗概而非成片旁白稿。Persist blocked. |
| 59–61 集缺收束（endingClosureMissing） | 第 N 集 终局阶段缺少明确收束结果。Persist blocked. |
| **QA 综合评分 < 60** | QA 未通过：综合评分为 xx，低于 60，禁止写入。请根据检查结果修订草稿后再试。 |
| **QA 存在 high 严重度问题** | QA 未通过：第 x、y、z 集存在高严重度问题（如尾钩过弱、事件密度不足、第一人称不足等），禁止写入。请修订后再试。 |

---

# 5. QA 与 persist 如何耦合

- **顺序**：`persistDraft` 内先 `resolveDraftForPersist`，再 `runRuleBasedCheck(draft)`，再根据 QA 结果决定是否继续：
  - 若 `overallScore < 60` → 抛错，不执行 `assertDraftQualityBeforePersist` 与 `create`。
  - 若存在任意 `severity === 'high'` 的 episode issue → 抛错，同样不写库。
- **runRuleBasedCheck** 与 persist 硬门槛对齐：对每集调用 `evaluateStoryTextForShortDrama`，将口播不足 360、第一人称/第三人称、事件密度、非终局集弱钩子/问句钩子、59+ 收束、rewrite_goal 等转化为 episodeIssues 与扣分，使「禁止写库」的条件在 QA 阶段即可提前暴露。
- 通过 QA 后仍执行 `assertDraftQualityBeforePersist`，形成双重门禁（QA 综合/高严重度 + 逐条硬门槛）。

---

# 6. Batch continuity 如何修复

- **上一批信息**：每批 writer 完成后，取该批最后一集的 `storyText` 与 `summary`。
- **尾段提取**：`prevTail = extractStoryTailForContinuation(last.storyText, 200)`（取末尾最多 200 字）；`prevSummary = last.summary ?? ''`。
- **传入下一批**：`runWriterBatch(..., prevTail, prevSummary, contextBlockForBatch, ...)`；user 消息中首段为「上一批最后一集结尾片段（用于衔接）：\n{prevTail}\n\n（上集摘要：{prevSummary}）」（无上一批时无此段），再接「本批为可拍短剧单元…」「本批规划：…」。
- 无上一批时 `prevTail`、`prevSummary` 为空，文案为「（无）」或省略，不影响首批生成。

---

# 7. 参考表范围过滤如何实现

- **Planner**：仍使用全集（或 target 集数范围）的 `buildContextBlocks` 产出 `promptPreview`，不做按批过滤。
- **Writer 每批**：调用 `buildContextBlockForWriterBatch(novelId, referenceTables, batchStartEp, batchEndEp, charBudget)`：
  - **novel_episodes**：`getContext` 的 `startEpisode`/`endEpisode` 已过滤，仅含本批集数。
  - **novel_hook_rhythm**：同上，仅含本批集数。
  - **drama_structure_template**：仍为全集（未按集字段过滤），字符量通过 slice(0,50) 控制。
  - **optionalTables**：`set_payoff_lines`、`set_story_phases` 在内存中按行过滤，保留 `start_ep <= batchEndEp && end_ep >= batchStartEp`（字段名兼容 `start_ep`/`end_ep`）；其余表（如 set_core、novel_characters 等）仍为全集节选，由 charBudget 控制。

---

# 8. 风险与后续建议

- **Planner 仍未完全结构化**：当前 planner 仍输出 title/summary/storyBeat 文本，未强制输出 60s/90s 节拍结构（如 hook_3s、conflict_15s、mid_reversal、tail_hook）；后续可做 P2「Beat Planner」与 `story_beat_json` 结构化 schema。
- **自动重写代理**：本次未实现「QA 不通过时自动重写一次再 QA」；可在 persist 前增加可选重试链路。
- **story_beat_json**：当前 persist 时若 draft 中存在 `storyBeat`（字符串），则写入 `story_beat_json = { storyBeat: "..." }`，为兼容写法；未要求 planner 输出结构化 beat，也未在 writer 中强制消费结构化 beat。
- **MIN_NARRATION_CHARS_STRONG**：目前为常量 360；若需按 60s/90s 或环境区分，可改为配置项或环境变量。
- **前端**：未改接口与主交互；仅类型增加 `storyBeat?`，兼容现有请求/响应。

---

# 涉及文件与核心 diff 摘要

- **episode-story-generation.service.ts**：常量与重命名；`extractStoryTailForContinuation`、`buildContextBlockForWriterBatch` 新增；`generateDraft` 循环改为按批拉取 context、传 prevTail/prevSummary；`runWriterBatch` 签名与 system/user prompt 重写；`assertDraftQualityBeforePersist` 增加 360 字与弱钩子/问句钩子门禁；`runRuleBasedCheck` 强化并与 persist 门禁对齐；`persistDraft` 先 QA 再门禁、create 时传入 `storyBeatJson`。
- **dto/episode-story-generation.dto.ts**：`EpisodeStoryDraftEpisode` 增加 `storyBeat?: string`。
- **web/types/episode-story.ts**：`EpisodeStoryDraftEpisode` 增加 `storyBeat?: string`。

验证建议：对同一 novel 执行「生成草稿 → AI 检查 → 确认写入」；故意构造字数 <360 或仅问句尾钩的草稿再点写入，应被 QA 或 assert 门禁拦截并看到上述错误信息；正常通过门禁的草稿应成功写入且 `story_beat_json` 含 `storyBeat`（若 planner 有输出）。
