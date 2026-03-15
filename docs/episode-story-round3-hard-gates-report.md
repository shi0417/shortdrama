# Episode Story 第三轮修复：可拍性硬门槛 — 实现报告

本轮仅修改 `apps/api/src/pipeline/episode-story-generation.service.ts`，新增本报告。未改 DTO/controller/module/SQL/前端/version/narrator 等。

---

## 1. 修改文件清单

| 文件 | 变更 |
|------|------|
| `apps/api/src/pipeline/episode-story-generation.service.ts` | 修改 |
| `docs/episode-story-round3-hard-gates-report.md` | 新增（本报告） |

---

## 2. 第三轮 5 项硬门槛分别如何落地

### （1）planner 必须满 targetCount，否则直接失败

- **位置**：`runPlanner` 内，解析出 `arr` 且 `arr.length > 0` 之后。
- **逻辑**：若 `arr.length !== targetCount`，打日志  
  `[episode-story][planner][quality-block] expected=<targetCount> actual=<arr.length> reason=planner_count_mismatch`，  
  并 `throw new BadRequestException('Episode story planner returned ${arr.length} items, expected ${targetCount}.')`。
- **后续**：不再按 `targetCount` 做 normalize 补齐；`plan` 仅从 `arr` 按实际长度逐项映射生成，保证后续 `splitBatches` / writer 使用的就是目标集数且与 planner 实际输出一致。

### （2）storyText 最小口播字数门槛

- **常量**：`MIN_NARRATION_CHARS_SEVERE = 260`，`MIN_NARRATION_CHARS_WEAK = 360`。
- **评估**：在 `evaluateStoryTextForShortDrama` 内按 `trimmed.length` 得到 `charCount`；  
  - `charCount < 260` → `tooShortForNarration = true`，并追加 warning：「字数过短（xxx chars），不足以稳定支撑短剧旁白口播」。  
  - `260 <= charCount < 360` → `narrationLengthWeak = true`，并追加 warning：「字数偏短，可能更像剧情摘要而非完整短剧旁白稿」。
- **persist 门禁**：在 `assertDraftQualityBeforePersist` 中对该集调用 `evaluateStoryTextForShortDrama`，若 `ev.tooShortForNarration`，则抛 BadRequestException，并打日志  
  `[episode-story][persist][quality-block] episode=<N> reason=narration_too_short chars=<count>`。

### （3）单集事件密度门槛

- **常量**：`ACTION_EVENT_PATTERNS`（正则，动作事件词）、`SUMMARY_ONLY_PATTERNS`（正则，心理摘要词）。
- **评估**：在 `evaluateStoryTextForShortDrama` 内统计 `actionEventHitCount`、`summaryPhraseHitCount`；  
  - `eventDensityLow`：`actionEventHitCount < 2` 或 `(actionEventHitCount === 0 && summaryPhraseHitCount >= 3)`，仅写 warning。  
  - `eventDensitySeverelyLow`：`actionEventHitCount === 0 && summaryPhraseHitCount >= 4`，写「几乎没有可拍动作事件，更接近梗概」类 warning。
- **persist 门禁**：若 `ev.eventDensitySeverelyLow`，则抛 BadRequestException，并打日志  
  `[episode-story][persist][quality-block] episode=<N> reason=event_density_low actionEvents=<x> summaryPhrases=<y>`。

### （4）结尾事件钩子优先，弱化问句钩子

- **Writer prompt**：在 `runWriterBatch` 的 systemMsg 中，在原有「结尾具体钩子」基础上，明确「结尾优先写事件已经发生或即将立刻发生的事件钩子」，并列出优先示例（密折落谁手、某人现身、诏令下达、城门被打开、将领倒戈、内奸暴露等）；问句钩子仅作次优；禁止连续多集都以「谁会……？」「会不会……？」「我要知道……」「我必须确认……」收尾。
- **常量**：`QUESTION_HOOK_PATTERNS`、`EVENT_HOOK_PATTERNS`（对尾部检测）。
- **评估**：在 `evaluateStoryTextForShortDrama` 内对尾部（tail）做 `questionHookHit`、`eventHookHit`；  
  - `eventHookOk = eventHookHit`；  
  - `questionHookOnly = questionHookHit && !eventHookHit` 时追加 warning：「结尾更像问句钩子，缺少已经发生/即将发生的事件钩子，短剧爆点偏弱」。
- **日志**：在现有 `[hook-check]` 中增加 `eventHookOk=<a>/<batchLen>`、`questionHookOnlyCount=<c>`。  
- **persist**：不因问句钩子单独拦截，仅通过 warnings 与日志反馈。

### （5）55–61 集终局收束（59–61 硬门槛）

- **常量**：`ENDING_RESOLUTION_PATTERNS`（收束关键词）、`ENDING_OPEN_LOOP_PATTERNS`（仍开环/继续预警）。
- **评估**：仅对 `episodeNumber >= 55` 生效；统计 `endingResolutionHitCount`、`endingOpenLoopHitCount`。  
  - `endingClosureWeak`：`endingResolutionHitCount === 0 && endingOpenLoopHitCount >= 1`，写「已进入终局段，仍以继续预警/铺悬念为主，缺少终局收束」类 warning。  
  - 对 59–61 集：若 `endingResolutionHitCount === 0` 则 `endingClosureMissing = true`，写「终局阶段缺少明确收束结果，不像大结局段」类 warning。
- **persist 门禁**：仅对 **59–61 集**，若 `ev.endingClosureMissing`，则抛 BadRequestException，并打日志  
  `[episode-story][persist][quality-block] episode=<N> reason=ending_closure_missing`。
- **Writer prompt**：在 `buildEndingGuardInstruction` 中补强：55–61 集必须逐步形成终局收束；59–61 集必须出现明确的稳局/反制/清算/定局/巩固结果；禁止把第 61 集写成「新的更大风暴前夜」；最后一集须体现阶段性胜利闭环，而不是继续中段式吊悬念。

---

## 3. 新增常量 / 方法

- **常量**  
  - `MIN_NARRATION_CHARS_SEVERE`（260）、`MIN_NARRATION_CHARS_WEAK`（360）  
  - `ACTION_EVENT_PATTERNS`、`SUMMARY_ONLY_PATTERNS`  
  - `QUESTION_HOOK_PATTERNS`、`EVENT_HOOK_PATTERNS`  
  - `ENDING_RESOLUTION_PATTERNS`、`ENDING_OPEN_LOOP_PATTERNS`
- **方法**  
  - 无新增独立方法；口播字数、事件密度、问句/事件钩子、终局收束均并入现有 `evaluateStoryTextForShortDrama`，并扩展其返回值与 `warnings`。  
  - `buildEndingGuardInstruction` 仅补强文案；`runPlanner` 增加数量校验与提前抛错；`assertDraftQualityBeforePersist` 增加上述 4 类门禁调用。

---

## 4. persist 新增阻断条件

在 `assertDraftQualityBeforePersist` 中，对每集在通过既有 P0 与第一人称/终局违规校验后，再调用 `evaluateStoryTextForShortDrama`，并新增：

1. **narration_too_short**：`ev.tooShortForNarration`（即 `charCount < 260`）→ 抛 BadRequestException，日志 `reason=narration_too_short chars=<count>`。  
2. **event_density_low**：`ev.eventDensitySeverelyLow` → 抛 BadRequestException，日志 `reason=event_density_low actionEvents=<x> summaryPhrases=<y>`。  
3. **ending_closure_missing**：仅当 `episodeNumber >= 59` 且 `ev.endingClosureMissing` → 抛 BadRequestException，日志 `reason=ending_closure_missing`。

---

## 5. 新增日志点

- **Planner**  
  - `[episode-story][planner][quality-block] expected=<target> actual=<actual> reason=planner_count_mismatch`  
    （仅当 `arr.length !== targetCount` 时）
- **Writer hook-check（扩展）**  
  - 在原有 `concreteHookOk`、`weakHookCount`、`severeWeakHookCount` 基础上，增加：  
    `eventHookOk=<a>/<batchLen>`、`questionHookOnlyCount=<c>`  
    即：  
    `[episode-story][writer][batch i/total][hook-check] ... eventHookOk=a/b questionHookOnlyCount=c`
- **Persist quality-block**  
  - `reason=narration_too_short chars=<count>`  
  - `reason=event_density_low actionEvents=<x> summaryPhrases=<y>`  
  - `reason=ending_closure_missing`

---

## 6. Build 结果

- 命令：`npx nx run api:build`  
- 结果：**通过**（exit code 0）。

---

## 7. 风险与后续建议

- **Planner 数量**：硬性要求与 targetCount 一致后，若模型经常只出 48 集等，会直接失败，需在业务上考虑重试或调整 planner prompt/模型，而不是在代码内再次 normalize 补齐。  
- **口播字数**：260/360 为固定阈值，未区分 60 秒/90 秒模式；若后续要分档，可改为配置或常量扩展。  
- **事件密度**：依赖关键词正则，存在漏判/误判；若出现新的动作或心理句式，需维护 `ACTION_EVENT_PATTERNS` / `SUMMARY_ONLY_PATTERNS`。  
- **问句/事件钩子**：仅做尾部模式匹配，未做多集连续问句检测；「事件钩子」示例列表可根据实际成片再扩充。  
- **终局收束**：59–61 集以「是否出现收束关键词」为硬门槛，若模型用同义表述可能被判缺收束，可后续补充更多 `ENDING_RESOLUTION_PATTERNS` 或适度放宽仅对 61 集做硬拦。
