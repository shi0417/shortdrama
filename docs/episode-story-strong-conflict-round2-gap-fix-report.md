# Episode Story 强冲突第二轮补漏实现报告

**范围**：仅针对已落地方案的薄弱点做定点补丁，无大重构、无改动无关模块。  
**基准**：以当前仓库代码为准，先核查再改。

---

## 1. 修改文件清单

| 文件 | 修改类型 |
|------|----------|
| `apps/api/src/pipeline/episode-story-generation.service.ts` | check 取数/错误码/日志；evaluateStoryText 弱动作与尾钩收紧；diagnoseEpisode(beat?) 与 execution_blocks_undershoot；runAutoRewrite 追加指令 |
| `apps/api/src/pipeline/dto/episode-story-generation.dto.ts` | 无改动（strongConflictAudit 已存在） |
| `apps/web/src/types/episode-story.ts` | 新增 `EpisodeStrongConflictAudit`、`StoryCheckReportEpisodeItem.strongConflictAudit` |
| `apps/web/src/components/story-text/StoryGenerateDialog.tsx` | 在 check 结果区域增加每集 strongConflictAudit 一行展示 |

---

## 2. 每个修改点对应函数名

| 修改点 | 函数/位置 |
|--------|-----------|
| check 取数顺序与 source 日志 | `check(novelId, dto)` |
| draftId cache miss 明确错误 | `check()` 内 `dto.draftId && !draft` 时 throw `EPISODE_STORY_DRAFT_CACHE_MISS` |
| draftId novelId 不匹配明确错误 | `check()` 内 `cached.novelId !== novelId` 时 throw `EPISODE_STORY_DRAFT_ID_NOVEL_MISMATCH` |
| 泛化冲突伪达标识别 | `evaluateStoryTextForShortDrama`：新增 `WEAK_FAKE_CONFLICT_PATTERNS`、`STRONG_CONFLICT_ACTION_PATTERNS`，antagonist/protagonist Ok 需同时 hasStrongAction |
| 冲突强度不足收紧 | `evaluateStoryTextForShortDrama`：无强动作且（原命中或弱动作≥2）时强制 `conflictIntensityLow = true` |
| 结尾钩子空泛黑名单 | `evaluateStoryTextForShortDrama`：新增 `WEAK_TAIL_PHRASES`，非终局集尾段仅匹配黑名单且无具体实体/事件钩子时 `endHookOk = false` |
| execution_blocks 落段最小校验 | `diagnoseEpisode(episodeNumber, storyText, beat?)`：beat?.execution_blocks?.length>=4 且段落数<4 时推 `execution_blocks_undershoot`（medium） |
| rewrite 强冲突/落段补写指令 | `runAutoRewrite`：当 `needsStructuralConflictFix` 或 `hasExecutionBlocksUndershoot` 时追加一段；当 `hasExecutionBlocks` 时再追加“按 block 顺序补段、不要把 must_show 改总结句” |
| 前端类型与展示 | `episode-story.ts` 类型定义；`StoryGenerateDialog.tsx` 逐集 strongConflictAudit 一行 |

---

## 3. 核查后确认已存在、未重复开发

- **A. episode-story-check 已支持 dto.draftId**：已支持，`check()` 内首分支 `if (dto.draftId)` 用 `getCachedDraft(dto.draftId)` 取草稿。本轮未改逻辑，仅补错误码与 source 日志。
- **C. StoryCheckReportEpisodeItem 已稳定返回 strongConflictAudit**：后端 `runRuleBasedCheck` 与 `mergeRuleAndLlmReport` 已写入并保留 `strongConflictAudit`，DTO 已含该字段。本轮未改后端返回结构。
- **D. strongConflictAudit 五字段**：`EpisodeStrongConflictAudit` 已含 hasAntagonistAction、hasProtagonistCounteraction、hasReversal、hasEndHook、conflictIntensityLow。未重复定义。
- **5 个强冲突 issue type**：antagonist_action_missing、protagonist_counteraction_missing、reversal_missing、end_hook_missing、conflict_intensity_low 已存在，本轮未新增。
- **Draft cache 机制**：未改 TTL、未改 cache 结构、未重构 getCachedDraft/cacheDraft。
- **Beat Planner schema / finale mode**：未改。
- **AUTO_REWRITE_SYSTEM_PROMPT 主体**：未重写，仅在使用处追加 repairInstruction 片段。

---

## 4. 本轮新增补丁

1. **check 可排查性**  
   - 日志打印 `source=draft-cache | payload-draft | versionIds`。  
   - draftId 有值但缓存未命中且未从 payload/versionIds 拿到 draft 时，抛出 `BadRequestException(..., 'EPISODE_STORY_DRAFT_CACHE_MISS')`。  
   - 缓存命中但 `cached.novelId !== novelId` 时，抛出 `BadRequestException(..., 'EPISODE_STORY_DRAFT_ID_NOVEL_MISMATCH')`。

2. **强冲突“伪达标”收紧**  
   - 新增 `WEAK_FAKE_CONFLICT_PATTERNS`、`STRONG_CONFLICT_ACTION_PATTERNS`、`WEAK_TAIL_PHRASES`。  
   - antagonistActionOk / protagonistCounteractionOk 需同时满足原 pattern 命中且 `hasStrongAction`（strong 动作至少 1 次）。  
   - 无强动作且（原 antagonist/protagonist 命中或弱动作≥2）时强制 `conflictIntensityLow = true`。

3. **end hook 再收紧**  
   - 非终局集若尾段（最后约 80 字）命中 `WEAK_TAIL_PHRASES` 且无具体实体、无事件钩子，则 `endHookOk = false`。

4. **execution_blocks 落段最小校验**  
   - `diagnoseEpisode` 增加可选参数 `beat`。  
   - 当 `beat?.execution_blocks?.length >= 4` 且正文按 `\n+` 分段后段落数 < 4 时，推 issue `execution_blocks_undershoot`（severity medium），供 rewrite 使用。  
   - `autoRewriteIfNeeded` 中两处 `diagnoseEpisode` 调用改为传入 `beat`。

5. **rewrite 指令补丁**  
   - 当存在 `conflict_intensity_low` 或 `execution_blocks_undershoot` 时，在 repairInstruction 后追加一段：不要只补环境/心理；必须补对手动作、主角反制、至少一个转折、非终局集结尾具体事件型钩子。  
   - 当 beat 含 execution_blocks 时，再追加：按 block 顺序补段，不要把 must_show 改写成总结句。

6. **前端**  
   - `episode-story.ts` 新增 `EpisodeStrongConflictAudit` 与 `StoryCheckReportEpisodeItem.strongConflictAudit`。  
   - `StoryGenerateDialog` 在“逐集问题”列表中每集增加一行：对手动作/主角反制/转折/结尾钩子/冲突强度不足 的有无或是否。

---

## 5. draftId 未保存审计链路现在如何工作

- **取数顺序**：  
  1. 若 `dto.draftId` 存在，则 `getCachedDraft(dto.draftId)`；若命中且 `cached.novelId === novelId`，则 `draft = cached.draft`，`draftSource = 'draft-cache'`。  
  2. 若缓存命中但 novelId 不一致，则**立即抛出** `EPISODE_STORY_DRAFT_ID_NOVEL_MISMATCH`，不继续。  
  3. 若尚无 draft，则用 `dto.draft?.episodes`（有则 `draftSource = 'payload-draft'`）。  
  4. 若仍无 draft，则用 `dto.versionIds` 查库组 draft（`draftSource = 'versionIds'`）。  
  5. 若 `dto.draftId` 有值但最终仍无 draft，则抛出 `EPISODE_STORY_DRAFT_CACHE_MISS`。  
  6. 若最终无 draft 或 episodes 为空，则抛出“请提供 draftId、draft 或 versionIds”。

- **cache miss 时返回**：`400` + `error: 'EPISODE_STORY_DRAFT_CACHE_MISS'`，文案为“草稿缓存已失效或不存在（可能已过期），请重新生成草稿后再检查。”  
- **novel mismatch 时返回**：`400` + `error: 'EPISODE_STORY_DRAFT_ID_NOVEL_MISMATCH'`，文案说明 draftId 属于其他剧目。

- **日志**：成功取到 draft 后打印 `[episode-story][check] novelId=... source=draft-cache|payload-draft|versionIds episodes=...`，便于排查未保存审计链路。

---

## 6. strongConflictAudit 现在是否能被前端/调用方直接看到

- **后端**：`runRuleBasedCheck` 对每集（有 storyText 且长度达标）写入 `strongConflictAudit`；`mergeRuleAndLlmReport` 从 ruleReport 的 episodeIssues 中保留并合并 `strongConflictAudit`，check 返回的 `StoryCheckReportDto.episodeIssues[].strongConflictAudit` 稳定存在（有则带出）。  
- **前端**：类型已包含 `EpisodeStrongConflictAudit` 与 `StoryCheckReportEpisodeItem.strongConflictAudit`；`StoryGenerateDialog` 在“AI 检查”结果的逐集列表中，每集展示一行：对手动作/主角反制/转折/结尾钩子/冲突强度不足。  
- **结论**：API 返回结构完整，前后端均可直接消费；前端已做最小展示，未改页面结构。

---

## 7. execution_blocks / 强冲突规则新增了哪些最小校验

- **execution_blocks 落段**：在 **diagnose** 阶段（仅当传入 beat 时）：若 `beat.execution_blocks.length >= 4` 且正文按 `\n+` 分段后段落数 < 4，则推 issue `execution_blocks_undershoot`（medium）。不阻断生成，不抛异常，供 rewrite 使用。  
- **强冲突**：在 **evaluateStoryTextForShortDrama** 中：  
  - antagonistActionOk / protagonistCounteractionOk 需原 pattern 命中且全文至少 1 次 `STRONG_CONFLICT_ACTION_PATTERNS`。  
  - 若无强动作且（原命中或弱动作≥2）则强制 `conflictIntensityLow = true`。  
- **end hook**：非终局集尾段若仅匹配 `WEAK_TAIL_PHRASES` 且无具体实体/事件钩子，则 `endHookOk = false`。

以上均为轻量规则，无复杂 NLP，未新增表或大改 QA 体系。

---

## 8. end hook / conflict_intensity_low 这轮具体如何收紧

- **end hook**：  
  - 新增 `WEAK_TAIL_PHRASES`（加强戒备、风雨欲来、我心中一沉、我知道更大的危机要来了、夜色更深了、夜色沉沉、事情不妙、更大的危机、暗流涌动、风暴将至等）。  
  - 非终局集在原有 `endHookOk` 计算后，若尾段约 80 字匹配该黑名单且无具体实体、无事件钩子，则置 `endHookOk = false`。

- **conflict_intensity_low**：  
  - 保留原有“四要素达标数 < 3”即 low。  
  - 新增：若全文无 `STRONG_CONFLICT_ACTION_PATTERNS` 命中，且（原 antagonist/protagonist 有命中或 `WEAK_FAKE_CONFLICT_PATTERNS` 命中≥2），则强制 `conflictIntensityLow = true`，避免“收到情报/安排部署/气氛紧张”等仅靠弱动作被判达标。

---

## 9. rewrite 指令这轮如何避免“只补字数不补冲突”

- 当 QA 含 **conflict_intensity_low** 或 **execution_blocks_undershoot** 时，在 `repairInstruction` 后追加固定一句：  
  “不要只补环境描写和心理描写。必须补出一个正在发生的对手动作；必须补出主角针对该动作的反制；必须补出至少一个局势变化/中段转折；非终局集最后必须落一个具体事件型钩子。”  
- 当当前 episode 的 **beat 含 execution_blocks** 时，再追加：  
  “若 story_beat_json 含 execution_blocks，请按 block 顺序补段，不要把 must_show 改写成总结句。”  
- 现有 structural-finale / structural-conflict-fix 分支与 finale 收束逻辑未删未改。

---

## 10. 本轮仍未解决的问题

- **execution_blocks 落段校验仅在 diagnose 路径**：仅当调用 `diagnoseEpisode(..., beat)` 时（即 autoRewriteIfNeeded 内）才会产生 `execution_blocks_undershoot`；纯 check 路径（runRuleBasedCheck）没有 beat，故不会做段落数 vs execution_blocks 的校验。若希望 check 也报“落段不足”，需要 check 能拿到每集 beat（例如 draft 中存 storyBeat 或由前端传入），当前未做。
- **强冲突规则仍为关键词/正则**：弱/强动作、尾钩黑名单仍依赖固定 pattern，对未覆盖表述可能误判；未做语义或向量判断。
- **execution_blocks_undershoot 为 medium**：不触发 needsRewrite（仅 high 触发），rewrite 是否处理依赖是否同时存在其他 high；若希望“仅落段不足”也触发一次重写，需改为 high 或单独策略，本轮未改。
- **前端 strongConflictAudit**：仅在有 episodeIssues 的列表中展示（前 20 集）；若某集无 issues 但有 strongConflictAudit，因当前 runRuleBasedCheck 对“无 issues 但有 audit”的集也 push 一项，故会展示。若后端某路径未带 strongConflictAudit，前端该集不展示该行，属预期。

---

## 交付摘要

- **修改文件**：`episode-story-generation.service.ts`、`apps/web/src/types/episode-story.ts`、`apps/web/src/components/story-text/StoryGenerateDialog.tsx`。  
- **关键 diff 摘要**：check 内 draftId 分支补 source 与两种明确错误码；evaluateStoryText 增加弱/强动作与尾钩黑名单并收紧 antagonist/protagonist/endHook/conflictIntensityLow；diagnoseEpisode 增加可选 beat 与 execution_blocks_undershoot；runAutoRewrite 按 conflict_intensity_low / execution_blocks_undershoot / execution_blocks 存在追加两段 repairInstruction；前端类型与 Dialog 中 strongConflictAudit 展示。  
- **构建结果**：`apps/api` 下 `npx tsc --noEmit` 通过；相关文件无 linter 报错。  
- **实现报告路径**：`docs/episode-story-strong-conflict-round2-gap-fix-report.md`。
