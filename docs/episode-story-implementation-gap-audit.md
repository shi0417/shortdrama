# Episode Story 质量救火版 — 兑现度审计报告

**审计对象**：`docs/episode-story-quality-rescue-report.md` 及本轮修改总结中声称已完成的改造项  
**对照基准**：当前仓库代码（以代码为准，报告与代码冲突时以代码为准）  
**审计时间**：本报告生成时基于对以下文件的逐行核对。

---

# 1. 审计结论总览

## 已真实落地

- **MaterialSiftingService + DTO 扩展**：`DramaticEvidencePack` 新增 `episodeGoal`、`visualAnchors`、`forbiddenDirections`、`continuity` 且在 `buildEvidencePack` 返回值中写入；source_material 按本集关键词检索 segments、fallback drama_source_text；keyNodes/timelineEvents/activeOpponents 按本集相关性过滤；extension 四字段的构建函数存在且被调用。
- **Beat Planner schema**：`StoryBeatJson` 已新增 `execution_blocks`、`ending_closure`；`BEAT_PLANNER_SYSTEM_PROMPT` 已要求输出 execution_blocks、59-61 的 ending_closure 与 finale tail_hook 约束。
- **Beat Planner 入参**：证据包通过 `packsJson = JSON.stringify(evidencePacks)` 传入，extension 字段在 JSON 中，prompt 中已写明使用证据包中的 episodeGoal、visualAnchors、forbiddenDirections。
- **Writer prompt 与 user message**：P2 Writer 的 system prompt 已要求按 execution_blocks 顺序写、must_show 落段、59-61 兑现 ending_closure；user message 已写明「按 execution_blocks 顺序逐块写」和「若某集有 ending_closure（59-61 集）…」；`beatsJson` 包含完整 beat（含 execution_blocks/ending_closure）。
- **Fallback beat**：当 Beat Planner 返回无效 beat（缺 episode_meta 或 pacing_structure）时，fallback 已为 59-61 注入 `execution_blocks` 与 `ending_closure`。
- **Auto-Rewrite system prompt**：已写明 rewrite_goal_violation/ending_closure_missing 时「允许对结尾 30% 做结构性重写」、终局集优先兑现 ending_closure.required_outcome。
- **2 次重写失败后的 hint 日志**：`autoRewriteIfNeeded` 中在 `attempts >= AUTO_REWRITE_MAX_RETRIES` 且仍 `needsRewrite` 时已打 `this.logger.error`，内容含「beat 设计未约束终局 / writer 未兑现 beat / rewrite 无法补齐结构」的区分说明。
- **Finale 59-61 在 Guard / diagnose**：`buildEndingGuardInstruction` 已含 55-61/59-61 终局收束与禁止大开环；`diagnoseEpisode` 仅在 `episodeNumber >= 59` 时推送 `ending_closure_missing`。

## 部分落地 / 名义落地

- **Beat 解析后 59-61 未补全 execution_blocks/ending_closure**：当模型返回的 beat 有 `episode_meta` 和 `pacing_structure` 但缺少 `execution_blocks` 或 `ending_closure` 时，代码直接 `beats.push(rawBeat)`，不做任何补全。59-61 集可能以「无 ending_closure」进入 Writer，与报告「59-61 必须有 ending_closure」不一致。
- **Writer 对 execution_blocks 仅 prompt 约束、无代码级校验**：报告称「每个 execution block 至少落成一个具体动作段」；代码侧仅通过 prompt 要求，无对 storyText 分段数、must_show 覆盖等的校验或后处理，属名义落地。
- **Auto-Rewrite user message 与 system prompt 矛盾**：system prompt 要求对 rewrite_goal_violation/ending_closure_missing 做「结尾 30% 结构性重写」；而 `runAutoRewrite` 的 user message 仍写「请仅针对 QA 错误报告中指出的问题进行**最小化修复**，保持原文风格和正确部分不变」，易引导模型做最小修补，与报告「允许结尾 30% 结构性重写」部分冲突。

## 报告声称已完成，但代码未落地

- **Beat 解析后对 59-61 的 execution_blocks/ending_closure 默认补全**：报告与总结隐含「59-61 集必带 ending_closure 进入 Writer」；代码仅在「整条 beat 无效」时用 fallback 补全，**未**在「beat 有效但缺 execution_blocks/ending_closure」时对 59-61 做补全逻辑，故此项未落地。
- **无「finale mode」显式分支保证 beat 带 ending_closure**：报告称「59-61 集自动启用 finale mode」「必须输出 ending_closure」；代码中没有在解析后根据 episode_number 59/60/61 强制为 beat 注入或校验 ending_closure 的分支，仅依赖 prompt 与 fallback，未在流程上强制落地。

---

# 2. 逐项核对表

| 模块 | 报告声称内容 | 代码实际情况 | 结论 | 证据位置（文件 + 关键位置） |
|------|--------------|--------------|------|-----------------------------|
| DTO | DramaticEvidencePack 新增 episodeGoal, visualAnchors, forbiddenDirections, continuity | 接口已定义并用于 pack 构建 | 已落地 | `material-sifting.dto.ts` L187-191, L148-160 EvidencePackExtension |
| MaterialSifting | 基于 outline_content/core_conflict/hooks/cliffhanger 抽关键词 | extractEpisodeKeywords 从 episodeRow 取上述四字段并分词 | 已落地 | `material-sifting.service.ts` L332-352 |
| MaterialSifting | 优先 novel_source_segments，无命中再 fallback drama_source_text | fetchSourceMaterialContext 先 keywords→fetchSourceExcerptByKeywords，有结果则 return，否则查 drama_source_text | 已落地 | `material-sifting.service.ts` L291-330, L354-391 |
| MaterialSifting | keyNodes/timelineEvents 按本集相关性过滤，否则前 2～4 条 | filterKeyNodesByEpisodeRelevance / filterTimelineEventsByEpisodeRelevance 用 episodeRelevanceNeedle 打分，有命中取命中否则 slice(0, KEY_NODES_OR_TIMELINES_TOP) | 已落地 | `material-sifting.service.ts` L392-424, L436-441 |
| MaterialSifting | activeOpponents 筛出 1～3 个 | filterOpponentsByEpisodeRelevance 逻辑同节点过滤，上限 ACTIVE_OPPONENTS_MAX=3 | 已落地 | `material-sifting.service.ts` L443-458 |
| MaterialSifting | 构建 episodeGoal, visualAnchors, forbiddenDirections, continuity | buildEpisodeGoal/buildVisualAnchors/buildForbiddenDirections/buildContinuity 存在且被 buildEvidencePack 调用，结果写入 pack | 已落地 | `material-sifting.service.ts` L102-114, L116-127, L460-514 |
| MaterialSifting | extension 字段参与后续流程 | 证据包经 buildEvidencePack 返回后，在 runBeatPlanner 中 JSON.stringify(evidencePacks) 作为 packsJson 传入 Beat Planner user message | 已落地 | `episode-story-generation.service.ts` L1092-1102 |
| Beat Planner | StoryBeatJson 新增 execution_blocks, ending_closure | 接口定义 execution_blocks?: ExecutionBlockJson[], ending_closure?: EndingClosureJson | 已落地 | `episode-story-generation.service.ts` L73-130 |
| Beat Planner | prompt 要求至少 4 个 execution_blocks，每块 block_no/purpose/must_show/forbidden | BEAT_PLANNER_SYSTEM_PROMPT 中 schema 与 CORE INSTRUCTIONS 明确 | 已落地 | `episode-story-generation.service.ts` L164-198 |
| Beat Planner | 59-61 集必须有 ending_closure.required_outcome，tail_hook 禁止普通大开环 | Prompt 中 Finale Mode 59-61 与 ending_closure 说明已写 | 已落地 | `episode-story-generation.service.ts` L176-186, L189-193 |
| Beat Planner | 解析/fallback 兼容 execution_blocks 与 ending_closure | Fallback beat（无效 beat 时）包含 execution_blocks 与 ending_closure（59-61）；有效 beat 直接 push 不补全 | 部分落地 | `episode-story-generation.service.ts` L1154-1192：仅 invalid 时补全，有效但缺字段时不补全 |
| Beat Planner | 59-61 解析后保证带 ending_closure 进入 Writer | 无：rawBeat 有效但无 ending_closure 时仍原样 push | 未落地 | `episode-story-generation.service.ts` L1189-1191 beats.push(rawBeat) |
| Writer | 按 execution_blocks 顺序写、每 block 至少一段、禁止心理句替代 must_show | P2_WRITER_SYSTEM_PROMPT 与 user message 已写；无代码级校验 | 名义落地 | `episode-story-generation.service.ts` L201-227, L1233-1236 |
| Writer | finale 集必须兑现 ending_closure.required_outcome | Prompt 与 user message 已写；无代码级校验 | 名义落地 | 同上 |
| Writer | execution_blocks/ending_closure 传给模型 | beatsJson = JSON.stringify(beats)，user message 含 beatsJson，故含上述字段 | 已落地 | `episode-story-generation.service.ts` L1214-1236 |
| Auto-Rewrite | rewrite_goal_violation/ending_closure_missing 时允许结尾 30% 结构性重写 | AUTO_REWRITE_SYSTEM_PROMPT 已写；runAutoRewrite 的 user message 仍写「最小化修复」 | 部分落地 | System: L232-251；User: L1440-1451「最小化修复」 |
| Auto-Rewrite | 终局集优先兑现 ending_closure.required_outcome | System prompt 已写；user message 未单独强调 | 部分落地 | `episode-story-generation.service.ts` L240-251 |
| Auto-Rewrite | 2 次失败后日志区分 beat/writer/rewrite | autoRewriteIfNeeded 中 logger.error 含 quality-rescue hint 与 issueTypes | 已落地 | `episode-story-generation.service.ts` L1564-1574 |
| Finale 59-61 | 明确分支：59/60/61 使用 finale mode、强制收束、禁止普通悬念尾钩 | buildEndingGuardInstruction 含 55-61/59-61 文案；diagnoseEpisode 仅 59+ 报 ending_closure_missing；无「若 59-61 则强制 beat 带 ending_closure」的代码分支 | 部分落地 | 有文案与诊断；无解析后强制补全或校验 ending_closure 的分支 |
| Finale 59-61 | writer/rewrite 都识别 finale mode | Writer/rewrite 通过 prompt 与 beat 中的 ending_closure 识别，无单独「finale mode」布尔或分支变量 | 名义落地 | 依赖 beat 内 ending_closure 存在，而 beat 可能缺该字段（见上） |

---

# 3. 关键落差 Top 10

按对「动作密度 / 终局收束 / persist 通过率」的影响严重程度排序。

1. **Beat 解析后 59-61 未补全 ending_closure/execution_blocks**  
   模型若返回「有效」beat 但省略 execution_blocks 或 ending_closure，59-61 会以无 ending_closure 进入 Writer，Writer prompt 中的「若某集有 ending_closure」条件不成立，终局收束要求无法被模型执行。  
   **证据**：`episode-story-generation.service.ts` L1189-1191 仅 `beats.push(rawBeat)`，无 59-61 补全逻辑。

2. **Auto-Rewrite user message 仍要求「最小化修复」**  
   与 system prompt「结尾 30% 结构性重写」相反，易导致重写仍只做字面修补，ending_closure_missing/rewrite_goal_violation 难以从结构上修复。  
   **证据**：`episode-story-generation.service.ts` L1451「请仅针对…进行最小化修复，保持原文…不变」。

3. **无「59-61 强制带 ending_closure」的流程保证**  
   报告称「59-61 集自动启用 finale mode」「必须输出 ending_closure」；代码没有在解析后根据 episode_number 强制注入或校验，完全依赖模型输出与 fallback。  
   **证据**：全链路无 `if (episodeNumber >= 59 && episodeNumber <= 61) { 确保 beat 有 ending_closure }` 一类逻辑。

4. **Writer 对 execution_blocks/must_show 无代码级约束**  
   「每个 block 至少落成一段」「禁止心理句替代 must_show」仅写在 prompt，无分段数、关键词覆盖等校验，模型忽略时无兜底。  
   **证据**：runP2WriterBatch 仅组 prompt 与 beatsJson，无对返回 storyText 的块数或 must_show 覆盖检查。

5. **有效 beat 缺 execution_blocks 时未补默认 4 块**  
   若模型只返回 episode_meta + pacing_structure 而省略 execution_blocks，Writer 收到的 beat 无执行块，prompt 中的「按 execution_blocks 顺序写」失去依据。  
   **证据**：同 L1189-1191，有效 beat 不补全。

6. **Evidence pack 的 extension 仅通过「整包 JSON」传入 Beat**  
   episodeGoal/visualAnchors/forbiddenDirections 虽在 pack 中，Beat Planner 的 user message 未在文案中单独强调「请优先阅读并遵守 evidence pack 中的 episodeGoal、visualAnchors、forbiddenDirections」，仅 system prompt 提及，模型可能忽略。  
   **证据**：L1102 userMsg 仅「本批各集的戏剧证据包：\n${packsJson.slice(0,50000)}」，无单独列举 extension 字段。

7. **buildEndingGuardInstruction 未引用 execution_closure/required_outcome**  
   终局 Guard 文案与报告中的「required_outcome：守住南京、稳住朝局…」一致，但未明确引用 beat 的 ending_closure.required_outcome，与「导演执行谱」未在 Guard 层对齐。  
   **证据**：`episode-story-generation.service.ts` L569-582 buildEndingGuardInstruction 仅固定字符串，参数只有 batch 的 episodeNumber/title/summary。

8. **runAutoRewrite 未根据 issue 类型改写 user message**  
   当 diagnosis.issues 含 rewrite_goal_violation 或 ending_closure_missing 时，未在 user message 中显式写「本次允许对结尾约 30% 做结构性重写」，仅 system prompt 有说明，易被「最小化修复」主导。  
   **证据**：runAutoRewrite 的 userMsg 构建 L1440-1451 与 diagnosis.issues 内容无关。

9. **Filter 逻辑在 needle 为空时仍可能返回很少节点**  
   episodeRelevanceNeedle 在无 episode/phase 文本时返回 []，filterKeyNodes 中 `if (!needle)` 判断的是 falsy（[] 为 truthy），故会走 scored 分支；所有节点 hit 为 false，最终返回 nodes.slice(0, 4)。逻辑正确，但报告称「最接近当前阶段的前 2～4 条」未区分「按阶段」排序，当前为 sort_order 顺序取前 4，与「当前阶段」的语义有细微偏差。  
   **证据**：`material-sifting.service.ts` L396-398、L436-441；getKeyNodes 按 sort_order 取全表再过滤。

10. **Persist 前无针对 59-61 或 execution_blocks 的专项校验**  
    报告希望通过「正文质量提升」间接提高 overallScore；代码未在 persist 前对 59-61 集做「是否包含收束关键词」或「是否按块写」的预检，未落地任何与「质量救火」直接挂钩的 persist 前校验。  
    **证据**：persist 流程中仅调用现有 QA（overallScore 等），无 59-61/execution_blocks 专项检查。

---

# 4. 这些落差为何会导致当前生成结果仍然差

## 4.1 动作事件密度仍然不足

- **Writer 仅被 prompt 约束「按 execution_blocks 写」「must_show 落段」**，无代码级校验。模型若省略执行块或仍用总结句替代 must_show，不会被拦截。
- **Beat 可能缺 execution_blocks**：若 Beat Planner 未输出 execution_blocks，Writer 收到的 beat 没有「块级」结构，prompt 中的「按 execution_blocks 顺序」失去对象，模型容易退回「按 pacing_structure 泛泛扩写」，动作密度提升有限。
- **Evidence pack 的 visualAnchors/forbiddenDirections** 虽在 JSON 里，若模型未优先解析或未在 must_show 中体现，本集化对「可拍画面」的约束会打折扣。

## 4.2 Finale 仍然 ending_closure_missing

- **59-61 的 beat 可能根本没有 ending_closure**：解析逻辑只在「整条 beat 无效」时用 fallback 注入；模型若返回有效 beat 但省掉 ending_closure，59-61 集会带着「无 ending_closure」进入 Writer。Writer prompt 中的「若该集有 ending_closure，则最后一段必须…」条件不成立，模型不会收到「必须写清守住南京、稳住朝局…」的明确指令。
- **Auto-Rewrite** 的 user message 强调「最小化修复」，模型倾向于小改，难以对结尾 30% 做结构性重写以补足收束结果，ending_closure_missing 易持续存在。
- **diagnoseEpisode** 仅在 59+ 报 ending_closure_missing，但修复链路（rewrite）未在指令上明确「可大改结尾」，闭环不足。

## 4.3 Persist 仍然 overallScore < 60

- **正文密度与终局收束不足**会直接拉低 QA 的事件密度、字数、终局收束等维度，进而拉低 overallScore；上述「动作密度」「ending_closure」的落差会传导到分数。
- **无 persist 前专项校验**：未对 59-61 或 execution_blocks 落地做任何预检，无法在写入前发现「缺收束」「缺块」并拦截或重试，只能依赖现有 QA 总分，通过率提升有限。

---

# 5. 最小修复清单

以下仅列出「最小必要」的修复方向，不直接改代码。

## 5.1 DTO 层

- **无**：extension 四字段已在 DTO 与 pack 中落地，无需在 DTO 层补项。

## 5.2 Prompt 层

- **Beat Planner user message**：在「本批各集的戏剧证据包」后增加一句，明确「证据包中每集含 episodeGoal、visualAnchors、forbiddenDirections、continuity，请据此填写 single_goal 与 execution_blocks 的 must_show/forbidden」。
- **Auto-Rewrite user message**：当 `diagnosis.issues` 中存在 `rewrite_goal_violation` 或 `ending_closure_missing` 时，将「最小化修复」改为「允许对全文最后约 30% 做结构性重写，优先兑现 ending_closure.required_outcome」；其余 issue 类型仍可保留「最小化修复」表述。
- **runAutoRewrite**：根据 `diagnosis.issues` 的 type 动态拼接 user message 中「修复策略」一句，与 system prompt 一致。

## 5.3 Service 流程层

- **Beat 解析后 59-61 补全**：在 `runBeatPlanner` 的 for 循环中，对 `rawBeat` 有效（有 episode_meta 与 pacing_structure）但 `episode_meta.episode_number` 为 59/60/61 时：若缺少 `ending_closure`，注入默认 `ending_closure: { required: true, required_outcome: ['守住南京','稳住朝局','叛党被清或内奸伏法','建文帝权力稳固'] }`；若缺少 `execution_blocks`，注入默认 4 块。保证 59-61 进入 Writer 的 beat 一定带 ending_closure 与 execution_blocks。
- **（可选）有效 beat 缺 execution_blocks 时通用补全**：对任意集，若 rawBeat 有效但无 `execution_blocks`，注入 4 块默认结构，避免 Writer 收到「无块」的 beat。

## 5.4 Fallback / Parser / Rewrite 层

- **Fallback**：已落地；无需改动。
- **Parser**：同上，在「解析后」对 59-61（及可选地对所有集）做 execution_blocks/ending_closure 补全，即算 parser 层跟上。
- **Rewrite**：user message 按 issue 类型区分「最小化修复」与「允许结尾 30% 结构性重写」，见 5.2。

## 5.5 可选增强（非最小必要）

- Writer 输出后对 storyText 做简单校验（如 59-61 是否含收束关键词、段落数是否不少于 4）并打 warning，不阻塞流程。
- Persist 前对 59-61 集做「收束关键词」或「ending_closure 相关」的轻量预检，仅打日志或 warning，便于排查 overallScore < 60 原因。

---

**审计说明**：本报告所有结论均以当前仓库代码为准；凡「未落地」「部分落地」「名义落地」均已在第 2 节给出具体文件与行号或函数名作为证据。未对任何业务代码进行修改。
