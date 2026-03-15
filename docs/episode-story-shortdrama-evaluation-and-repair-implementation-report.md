# Episode Story 短剧可拍性评估与修复 — 实现报告

本文档对应《Episode Story 短剧可拍性评估标准 + 修复指令》的代码落地结果，仅改动 `episode-story-generation.service.ts`，未改 DTO、SQL、version service/controller、前端及 narrator/episode-script。

---

## 1. 修改文件清单

| 文件 | 变更类型 |
|------|----------|
| `apps/api/src/pipeline/episode-story-generation.service.ts` | 修改 |
| `docs/episode-story-shortdrama-evaluation-and-repair-spec.md` | 已存在（前期产出） |
| `docs/episode-story-shortdrama-evaluation-and-repair-implementation-report.md` | 新增（本报告） |

---

## 2. 新增评估标准文档摘要

已存在规范文档：`docs/episode-story-shortdrama-evaluation-and-repair-spec.md`，包含 8 节：

- **目标定义**：story_text = 短剧连续旁白正文，第一人称、可口播、可承接画面、有节奏与钩子。
- **当前内容问题归类**：视角、爆点、爽点、钩子模板化、中后段重复、可拍性、主线/终局漂移。
- **短剧可拍性评估标准**：视角合规、旁白口播感、开场抓力、推进度、爽点/爆点/尾钩、连续性、阶段与终局一致性（0～5 分说明）。
- **story_text 生成规范**：第一人称、沈照视角、主句式示例、单集结构、语言风格、60/90 秒长度建议。
- **爆点/爽点/钩子标准**：可拍、具体、有对象+动作+结果。
- **终局一致性硬约束**：rewrite_goal；禁止朱棣攻破南京、建文朝覆灭等。
- **修复策略**：QA 评分、第一人称/终局/模板/钩子校验、不合格则拒绝 persist 或 warning。
- **验收清单**：抽查集数、第一人称、终局、钩子、模板重复等。

---

## 3. Prompt 约束改了什么

在 **`runWriterBatch`** 的 `systemMsg` 中，由原先一句概括改为成段强约束，语义包括：

- **storyText 定位**：短剧中的**连续旁白正文**，默认旁白者为**沈照**，**必须使用第一人称**（「我」：我看到/我知道/我不能/我必须/我原以为/可我没想到/这一刻我才明白 等）。
- **禁止**：写成第三人称故事简介；大段使用「沈照如何如何」「她如何如何」作为主句式。
- **必须**：像「我正在经历什么、我发现了什么、我决定怎么做」；有短剧节奏；单集冲突推进；结尾有**具体钩子**（某人/某事/某时），不要仅用「风暴将至」「暗流涌动」「局势紧张」等空泛句收尾。
- **终局**：本项目 rewrite_goal — 沈照改写靖难之役、建文帝守住江山、朱棣不能按历史成功夺位；结局不得出现朱棣攻破南京、建文朝覆灭、建文帝失败、历史未被改写等跑偏内容。

输出格式不变：严格 JSON 数组，每项含 episodeNumber、title、summary、storyText。

---

## 4. 第一人称旁白校验怎么做

- **入口**：私有方法 `evaluateStoryTextForShortDrama(episodeNumber, storyText)`，仅在本 service 内使用。
- **规则**：
  - 取正文前 200 字为 `head`，统计「我」出现次数与「沈照」「她」出现次数。
  - **firstPersonOk**：若前 200 字内至少出现 1 次「我」，或第三人称词出现少于 2 次，则视为通过；否则为不通过，并写入一条 warning（建议使用第一人称旁白）。
- **persist 门禁**：在 `assertDraftQualityBeforePersist` 中，对每集再取前 150 字；若「沈照|她」≥ 2 且「我」= 0，则判定为**明显第三人称摘要**，**阻止 persist**，并打日志 `reason=third_person_summary`。

不做复杂 NLP，仅用正则与计数，规则优先。

---

## 5. 钩子 / 重复 / 终局一致性校验怎么做

- **钩子（弱钩子）**  
  - 取正文最后 80 字为 `tail`。  
  - 若 `tail` 匹配弱钩子短语（`风暴将至|暗流涌动|局势紧张|朝局紧张|危机四伏`），且其中「具体」词（我/你/他/她/沈照/朱棣/李景隆/密折/今晚/明天）少于 2 个，则判为 **weakHook**，并写入一条 warning（结尾钩子过于空泛，建议具体到人/事/时）。

- **重复模板句**  
  - 对全文统计以下短语出现次数之和：`局势骤然紧张`、`暗流涌动`、`风暴将至`、`朝局紧张`、`危机四伏`。  
  - 若合计 ≥ 2，则写入一条 warning（模板句重复较多，建议换用具体描写）。  
  - 当前仅做 warning，不阻塞 persist。

- **终局一致性**  
  - 对全文做正则匹配：`朱棣.*攻破南京|建文朝覆灭|建文帝.*失败|历史.*未.*改写|朱棣.*夺位|南京.*陷落|燕军.*进京`。  
  - 若匹配则 **rewriteGoalViolation = true**，并写入 warning。  
  - 在 **persist 门禁**中：对 **第 55～61 集**（episodeNumber ≥ 55），若本集 **rewriteGoalViolation**，则**必须阻止 persist**，并打日志 `reason=rewrite_goal_conflict`。

---

## 6. persist 前新增了哪些门禁

在原有「占位 / 过短 / 非字符串」门禁之后，新增：

1. **终局一致性（硬拦截）**  
   - 对每集调用 `evaluateStoryTextForShortDrama`；若 `episodeNumber >= 55` 且 `rewriteGoalViolation === true`，则抛出 `BadRequestException`，并打日志：  
     `[episode-story][persist][quality-block] episode=<N> reason=rewrite_goal_conflict`。

2. **第三人称摘要（硬拦截）**  
   - 对每集正文前 150 字统计「沈照|她」与「我」；若「沈照|她」≥ 2 且「我」= 0，则抛出 `BadRequestException`，并打日志：  
     `[episode-story][persist][quality-block] episode=<N> reason=third_person_summary`。

未新增表结构、未改 DTO；未对「模板句重复」或「弱钩子」做 persist 阻断，仅通过 `evaluateStoryTextForShortDrama` 的 warnings 反馈到 generateDraft 的 `warnings` 中。

---

## 7. 日志点新增了哪些

- **Writer 批**  
  - 每批调用 writer 前：`[episode-story][writer] prompt uses first-person narration and rewrite_goal constraints`（单条，表示已启用新约束）。  
  - 每批 writer 返回并校验通过后：  
    `[episode-story][writer][batch <i>/<total>][narration-check] firstPersonOk=<n>/<batchLen> weakHookCount=<m>`  
    表示本批中第一人称通过条数及弱钩子条数。

- **Persist**  
  - 终局一致性拦截：`[episode-story][persist][quality-block] episode=<N> reason=rewrite_goal_conflict`。  
  - 第三人称摘要拦截：`[episode-story][persist][quality-block] episode=<N> reason=third_person_summary`。

沿用现有 `[episode-story]` 前缀，无其它模块日志侵入。

---

## 8. Build 结果

- 命令：`npx nx run api:build`  
- 结果：**通过**（exit code 0）。  
- 未改 DTO / 其他模块，未新增 lint 报错。

---

## 9. 人工联调 Checklist

建议联调时至少覆盖：

- [ ] **Writer 约束**：重新生成一版 draft，抽查第 1、5、7、14、21、36、50、61 集的 storyText，是否以第一人称（沈照「我」）为主、是否减少「她/沈照」主句式。
- [ ] **generateDraft warnings**：同一 draft 的返回值中 `warnings` 是否包含「第一人称建议」「结尾钩子空泛」「模板句重复」「终局与改写目标不符」等（视生成为准）。
- [ ] **终局门禁**：若某集（尤其 55–61 集）正文含「朱棣攻破南京」「建文朝覆灭」等，persist 是否被拒并打出 `reason=rewrite_goal_conflict`。
- [ ] **第三人称门禁**：若某集前 150 字大量「沈照/她」且无「我」，persist 是否被拒并打出 `reason=third_person_summary`。
- [ ] **日志**：writer 批是否出现 `[narration-check] firstPersonOk=... weakHookCount=...`；拦截时是否出现 `[persist][quality-block] episode=... reason=...`。
- [ ] **20 集以后**：抽查中后段是否仍出现大面积模板句重复（通过 warnings 或人工浏览）。

---

**变更边界**：仅修改 `apps/api/src/pipeline/episode-story-generation.service.ts`；未改 SQL/migration、episode-story-version、前端、narrator、episode-script。第一人称与终局约束已写入 writer prompt，并在 persist 前通过规则校验与门禁落地。
