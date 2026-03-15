# Episode Story 第二轮修复：终局锁死 + 第一人称强化 + 钩子具体化 — 实现报告

本文档为《Episode Story 第二轮修复指令》的落地报告，仅修改 `episode-story-generation.service.ts`，未改 DTO/controller/module/SQL/前端/version/narrator 等。

---

## 1. 修改文件清单

| 文件 | 变更 |
|------|------|
| `apps/api/src/pipeline/episode-story-generation.service.ts` | 修改 |
| `docs/episode-story-round2-ending-guard-and-hook-upgrade-report.md` | 新增（本报告） |

---

## 2. 根因/问题回顾（简述）

- **终局**：55-61 集需彻底锁死 rewrite_goal（建文守江山、朱棣未夺位），避免“历史原结局”“伪开放式失败”等跑偏。
- **第一人称**：不能只满足“偶尔有我”，需由沈照第一人称主导、前段即出现「我」、避免第三人称摘要/百科式说明。
- **钩子**：结尾不能停留在“风暴将至/暗流涌动”等空泛句，需具体到某人/某事/某时点，形成“下一集最想看的具体问题”。

---

## 3. 只读确认：复用/补强关系

| 能力 | 现状 | 本轮关系 |
|------|------|----------|
| extractModelContent | 已存在，用于 planner/writer/check | 复用 |
| runPlanner | 已存在 | 复用 |
| runWriterBatch | 已存在 | 补强：systemMsg 第一人称+结尾具体钩子、注入 ending guard、hook-check 日志 |
| evaluateStoryTextForShortDrama | 已存在 | 补强：第一人称主导率维度、具体钩子/弱钩子分级、55-61 终局违规并入 warnings |
| assertDraftQualityBeforePersist | 已存在 | 补强：55-61 用 evaluateEndingGuardForRewriteGoal；第一人称门禁增加前 120 字无「我」且第三人称明显则拦截 |
| generateDraft warnings 汇总 | 已存在，合并 ev.warnings | 复用；终局/第一人称/钩子新文案由 evaluateStoryTextForShortDrama 产出 |
| first-person / weakHook / rewriteGoalViolation 规则 | 已存在 | 补强：introHasWo、firstPersonLeadOk、thirdPersonSummaryRisk、concreteHookOk、severeWeakHook、ENDING_GUARD 扩展 |
| persist third_person_summary / rewrite_goal_conflict 门禁 | 已存在 | 补强：55-61 用 ending guard 违规检测；第一人称增加“前 120 字无我且第三人称明显”拦截 |

---

## 4. 55-61 集 ending guard 怎么实现

- **buildEndingGuardInstruction(batch)**  
  - 仅当 `batch` 中存在 `episodeNumber >= 55` 时返回一段强约束文本，否则返回空串。  
  - 约束内容：55-61 集属终局收束段；建文朝必须保住皇权；朱棣不得攻破南京/登基/夺位；结局须体现沈照干预有效改变历史；最后 7 集从危机收束/反制/锁定胜局/巩固新秩序推进；禁止时代更替、王朝覆灭、历史按原样发生；禁止空泛口号式胜利，须具体胜利机制或扭转结果。  
  - 该段在 `runWriterBatch` 中拼接到 systemMsg 末尾（仅在本批含 55-61 时生效）。

- **evaluateEndingGuardForRewriteGoal(episodeNumber, storyText)**  
  - 对 55-61 集使用扩展违规列表（见下）；对 &lt;55 集仍用原 REWRITE_GOAL_VIOLATION_PATTERNS。  
  - 返回 `{ violated: boolean, violationType?: string }`。  
  - 违规类型包括：朱棣攻破南京、建文朝覆灭、建文帝失败/失位/出逃、朱棣登基/夺位成功/新朝、历史未被改写、退隐江南/写书传后人/传奇落幕、时代更替/新朝开启等（见常量 ENDING_GUARD_VIOLATION_PATTERNS）。

- **persist 门禁**  
  - 对 55-61 集先调用 `evaluateEndingGuardForRewriteGoal`，若 `violated` 则直接抛 BadRequestException，并打日志 `[episode-story][persist][quality-block] episode=N reason=rewrite_goal_conflict`。

- **generateDraft warnings**  
  - 在 `evaluateStoryTextForShortDrama` 内，对 55-61 集若 ending 违规，向 `warnings` 推入：「第N集：与 rewrite_goal 冲突，属于终局锁死违规，不建议写库。」  
  - 仍通过现有 `warnings` 数组返回，未新增 DTO 字段。

---

## 5. 第一人称主导率如何判定

- **维度（在 evaluateStoryTextForShortDrama 内）**  
  - **introHasWo**：前 120 字至少 1 次「我」。  
  - **firstPersonCount / thirdPersonLeadCount**：前 200 字「我」与「沈照|她」次数。  
  - **firstPersonOk**：沿用“前 200 字有「我」或第三人称&lt;2”的通过条件。  
  - **thirdPersonSummaryRisk**：前 200 字「沈照|她」≥2 且「我」=0。  
  - **firstPersonLeadOk**：introHasWo 且前 200 字「我」≥1 且（第三人称≤1 或 「我」≥第三人称）。

- **warnings 分层**  
  - 一般：第一人称偏弱、建议前段自然出现「我」并保持旁白主导。  
  - 严重：明显第三人称摘要化，建议改为第一人称旁白（沈照视角）。

- **persist 门禁（补强）**  
  - 前 120 字无「我」且「沈照|她」≥2 → 拦截，reason=third_person_summary。  
  - 前 200 字「沈照|她」≥2 且「我」=0 → 拦截，reason=third_person_summary。  
  - 日志格式不变：`[episode-story][persist][quality-block] episode=N reason=third_person_summary`。

---

## 6. 具体钩子如何判定

- **尾部范围**：最后 80 字 + 最后 120 字（80 字用于弱句检测，120 字用于具体实体计数）。

- **tailWeakPhraseHit**：末 80 字是否命中 WEAK_HOOK_PHRASES（风暴将至|暗流涌动|局势紧张|朝局紧张|危机四伏）。

- **tailSpecificEntityCount**：末 120 字命中 CONCRETE_HOOK_ENTITIES 的次数。实体包括：人名（沈照、朱允炆、朱棣、李景隆、齐泰、黄子澄、耿炳文、盛庸、铁铉、姚广孝）、事件/物件（密折、城门、金川门、诏令、奏折、兵符、内线、夜袭、起兵、守城、削藩）、时点（今晚、今夜、明日、天亮前、三日内、下一刻、此刻）。

- **concreteHookOk**：tailSpecificEntityCount ≥ 1。  
- **weakHook**：tailWeakPhraseHit 且 tailSpecificEntityCount &lt; 2。  
- **severeWeakHook**：tailWeakPhraseHit 且 tailSpecificEntityCount === 0。

- **persist**：不因 weakHook 直接拦截；55-61 集若同时弱钩子+终局空泛，仅通过现有 warnings 反馈；硬门禁仍为 rewrite_goal 与 third_person。

---

## 7. persist 门禁新增/补强

- **55-61 集**：一律先调用 `evaluateEndingGuardForRewriteGoal`，violated 则必拦，日志 `reason=rewrite_goal_conflict`。  
- **第一人称**：新增“前 120 字无「我」且「沈照|她」≥2”即拦；保留“前 200 字第三人称≥2 且「我」=0”即拦；日志均为 `reason=third_person_summary`。  
- **保留**：占位、过短、非字符串等 P0 门禁未改动。

---

## 8. 新增日志点

- `[episode-story][writer] prompt uses first-person + ending guard + concrete hook constraints`  
  - 每批 writer 调用前一条，表示已启用第一人称 + 终局锁死 + 具体钩子约束。  
- `[episode-story][writer][batch i/total][narration-check] firstPersonOk=x/y weakHookCount=z`  
  - 保留，未改格式。  
- `[episode-story][writer][batch i/total][hook-check] concreteHookOk=x/y weakHookCount=z severeWeakHookCount=k`  
  - 新增，每批 writer 成功后一条。  
- `[episode-story][persist][quality-block] episode=N reason=rewrite_goal_conflict`  
  - 保留。  
- `[episode-story][persist][quality-block] episode=N reason=third_person_summary`  
  - 保留。

---

## 9. Build 结果

- 命令：`npx nx run api:build`  
- 结果：**通过**（exit code 0）。  
- 未改 DTO/controller/module，无新增 API 或响应结构变更。

---

## 10. 人工联调 Checklist

- [ ] **Ending guard**：本批含 55-61 时，writer 日志出现 “ending guard + concrete hook”；生成内容中 55-61 集无朱棣攻破南京、建文朝覆灭等；若故意写入违规句，persist 被拒且日志 reason=rewrite_goal_conflict。
- [ ] **第一人称**：抽查多集前两句/前 120 字是否出现「我」；前 200 字是否以「我」为主、无连续多句「沈照/她」；若故意写成第三人称摘要，persist 被拒且 reason=third_person_summary。
- [ ] **具体钩子**：抽查多集结尾 120 字是否含具体人名/事件/时点；warnings 中是否出现“结尾钩子过于空泛/仅抽象词无具体对象”；hook-check 中 concreteHookOk、weakHookCount、severeWeakHookCount 与预期一致。
- [ ] **generateDraft warnings**：55-61 集若违规，是否出现“与 rewrite_goal 冲突，属于终局锁死违规，不建议写库”；第一人称问题是否出现“明显第三人称摘要化”或“第一人称偏弱”。

---

## 交付摘要（按要求）

- **A. 修改文件清单**：见第 1 节。  
- **B. 每个改动点摘要**：  
  - 常量：ENDING_GUARD_VIOLATION_PATTERNS、CONCRETE_HOOK_ENTITIES。  
  - buildEndingGuardInstruction：仅 batch 含 55-61 时返回终局锁死约束块。  
  - evaluateEndingGuardForRewriteGoal：55-61 扩展违规类型，&lt;55 沿用原规则。  
  - evaluateStoryTextForShortDrama：增加第一人称主导率与具体钩子/弱钩子分级，55-61 终局违规写入 warnings。  
  - runWriterBatch：systemMsg 第一人称+结尾具体钩子+ending guard 拼接；hook-check 日志。  
  - assertDraftQualityBeforePersist：55-61 用 ending 违规检测；第一人称增加前 120 字门禁。  
- **C. 新增/补强规则**：终局 7 类违规、前 120/200 字第一人称门禁、结尾 80/120 字弱钩子与具体实体规则、firstPersonLeadOk/introHasWo/thirdPersonSummaryRisk。  
- **D. 新增日志点**：见第 8 节。  
- **E. Build**：通过。  
- **F. 风险提示**：规则基于正则与字数窗口，无法覆盖所有语义表述；终局/第一人称/钩子的边界 case 仍可能需人工抽检或后续迭代规则/模型 prompt。
