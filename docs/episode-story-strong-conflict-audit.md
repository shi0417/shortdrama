# Episode Story 短剧强冲突审计报告

**审计主题**：当前系统是否真的能自动生成具备短剧强冲突的 storyText。  
**基准**：以当前仓库代码为准，不修改代码，不假设未实现能力存在。  
**说明**：本次为代码级强冲突审计，不是实际生成结果复盘；若未保存的文本无法逐集复盘，以代码与链路逻辑为准。

---

# 1. 总结结论

| 能力项 | 结论 | 说明 |
|--------|------|------|
| **对手动作** | **未落地** | 仅 prompt 要求 conflict_15s.antagonist_reaction、execution_blocks 写「对手动作」；Evidence 无「对手本集正在实施的动作」字段；QA 无 antagonist_action_missing；Writer 输出后无校验。 |
| **主角反制** | **未落地** | 仅 prompt 要求 protagonist_action、反制；无专门 evidence 字段；QA 无 protagonist_counteraction_missing；无代码级校验。 |
| **单集转折** | **名义落地** | Beat 有 mid_reversal；Writer prompt 要求写转折；QA 无 reversal_missing，仅 event_density_low 间接沾边；无「中段是否有局势变化/身份揭露/计划失效」的校验。 |
| **结尾钩子** | **部分落地** | 有弱钩子/问句钩子/终局收束的规则校验（evaluateStoryTextForShortDrama + diagnoseEpisode + persist 门禁）；无「无结尾驱动力」的独立 issue type，仅 severe_weak_hook / question_hook_only。 |
| **强冲突硬门槛** | **未落地** | 无「对手动作 / 主角反制 / 转折 / 强尾钩」任一作为 fail-fast 或 needsRewrite / persist-block 的代码级硬门槛。 |

**结论区分**：

- **代码是否具备自动生成强冲突文本的机制**：仅有「通过 prompt 要求 + 事件密度/尾钩/终局等规则」的间接约束，**没有**针对「对手动作 / 主角反制 / 单集转折」的专门 schema 校验、QA issue type、persist 门禁或 rewrite 补戏逻辑。
- **当前实现是否只是口头要求、没有代码兜底**：Beat/Writer 的「对手动作」「主角反制」「转折」「must_show 落段」**仅写在 prompt**；解析后不校验 beat 是否含非空 antagonist_reaction/protagonist_action；Writer 输出后不校验 storyText 是否写出对手动作/反制/转折；QA 不检查上述维度；Rewrite 不按「补对手动作/补反制/补转折」做差异化修复。因此属**名义落地或未落地**。

---

# 2. 逐层审计表

| 层级 | 目标能力 | 代码实际情况 | 结论 | 证据位置（文件 + 函数/类型 + 关键点） |
|------|----------|--------------|------|--------------------------------------|
| **A. Evidence** | 提供具体对手、对手本集动作、可拍场面锚点 | activeOpponents 为 EvidenceOpponent[]（opponentName, levelName, threatType, detailedDesc），**无「本集正在实施的动作」字段**；visualAnchors 来自 opening/hooks/cliffhanger/keyNodes/timelineEvents，为可拍画面锚点，**不区分对手动作与主角动作**；episodeGoal 为一句目标，**不包含「对手动作+主角反制」结构** | 部分落地 | material-sifting.dto.ts EvidenceOpponent L41-47；material-sifting.service.ts buildVisualAnchors L519-539、buildEpisodeGoal L510-517 |
| **A. Evidence** | 足以支撑单集强冲突（对手动作+反制+转折） | forbiddenDirections、continuity 存在；**无「本集对手具体动作」「本集主角反制动作」的独立字段或结构化描述**，仅依赖 outline_content/core_conflict/hooks 的泛化摘要 | 未落地 | material-sifting.dto.ts DramaticEvidencePack；无 antagonist_action / protagonist_counteraction 等字段 |
| **B. Beat Planner** | 结构化输出「对手动作 / 主角反制 / 转折 / 尾钩」 | Schema 有 conflict_15s.protagonist_action、antagonist_reaction，mid_reversal，tail_hook；execution_blocks 含 purpose=conflict/reversal，**但解析后无校验**；fallback/injected execution_blocks 的 must_show 均为 [] | 名义落地 | episode-story-generation.service.ts StoryBeatJson L104-112、L122-124；runBeatPlanner 中 push rawBeat 或 beatToPush，无对 antagonist_reaction/must_show 非空的检查；createFallbackBeat L1467-1471 must_show: [] |
| **B. Beat Planner** | must_show 明确要求「对手动作/主角反制/转折/hook」 | Prompt 有 MUST_SHOW 具体化约束与示例；**代码中无 parser/validator 检查 must_show 是否含具体人名、动作动词或禁止抽象描述** | 名义落地 | BEAT_PLANNER_SYSTEM_PROMPT L199-214；无 post-parse 校验 must_show 内容 |
| **C. Writer** | 强制按 beat 写成「戏」、每块写成场面 | P2 Writer prompt 要求按 execution_blocks 顺序、每块具体动作、禁止心理句替代 must_show；**Writer 返回 storyText 后，没有任何代码校验**「是否写出 antagonist_reaction」「是否写出 protagonist_action」「是否写出 mid_reversal 对应段落」「must_show 是否逐条落地」 | 名义落地 | P2_WRITER_SYSTEM_PROMPT L220-251；runP2WriterBatch 仅校验 length/placeholder，无强冲突相关校验 |
| **C. Writer** | 校验对手动作/主角反制/转折/尾钩是否写出 | **无**。evaluateStoryTextForShortDrama 只做：字数、第一人称、动作词密度、尾钩强弱（WEAK_HOOK_PHRASES/CONCRETE_HOOK_ENTITIES）、问句钩子、终局收束、改写目标违规 | 未落地 | evaluateStoryTextForShortDrama L653-806；无 antagonist/protagonist/reversal 的字段或正则 |
| **D. QA/Diagnose** | 检查「对手动作缺失」 | **无**。diagnoseEpisode 的 issue types 无 antagonist_action_missing | 未落地 | diagnoseEpisode L1788-1872；issues 仅有 narration_too_short, third_person_summary, event_density_low, severe_weak_hook, question_hook_only, ending_closure_weak, rewrite_goal_violation, ending_closure_missing |
| **D. QA/Diagnose** | 检查「主角反制缺失」 | **无**。无 protagonist_counteraction_missing | 未落地 | 同上 |
| **D. QA/Diagnose** | 检查「单集转折缺失」 | **无**。无 reversal_missing；event_density_low 仅看动作词/心理词数量，不判断「中段是否有局势变化/身份揭露/计划失效」 | 未落地 | evaluateStoryTextForShortDrama L696-704 eventDensityLow/eventDensitySeverelyLow；diagnoseEpisode 无 reversal 相关 type |
| **D. QA/Diagnose** | 检查「结尾钩子缺失/过弱」 | 有。severe_weak_hook（结尾仅抽象词无具体对象）、question_hook_only（仅问句无事件型尾钩）、ending_closure_missing（59+ 无收束） | 部分落地 | diagnoseEpisode L1819-1834；evaluateStoryTextForShortDrama L724-746 |
| **D. QA/Diagnose** | 检查「冲突强度不足」 | **无**。无 conflict_intensity_low 或类似 issue type；LLM check prompt 有 engagementScore/emotionalTensionScore 但为可选、非规则硬门槛 | 未落地 | runRuleBasedCheck L2342-2394；buildStoryCheckPrompt L2396-2407；runStoryCheckLlm L2425 仅提示可打 engagement/emotionalTension |
| **E. Auto-Rewrite** | 能补「对手动作/主角反制/转折/钩子」 | REPAIR RULES 仅有 narration_too_short、third_person_summary、event_density_low、weak_hook、question_hook_only、rewrite_goal_violation、ending_closure_missing 等；**无** antagonist_action_missing、protagonist_counteraction_missing、reversal_missing 的专门修复策略 | 未落地 | AUTO_REWRITE_SYSTEM_PROMPT L262-290；runAutoRewrite 的 repairInstruction 仅对 rewrite_goal_violation/ending_closure_missing 做结构性重写，其余为「最小化修复」 |
| **E. Auto-Rewrite** | 根据 issue type 差异化补戏 | 仅对 rewrite_goal_violation/ending_closure_missing 切换 user message 为「允许结尾 30% 结构性重写」；**未**根据「缺对手动作/缺反制/缺转折」做差异化补戏指令 | 部分落地 | runAutoRewrite L1894-1912 needsStructuralFinale + repairInstruction |
| **F. Persist/Check/Draft** | 未保存也能审 | check(novelId, dto) 支持 dto.draftId，从 getCachedDraft 取草稿；draft 在 generateDraft 后通过 cacheDraft 缓存，TTL 30 分钟 | 已落地 | episode-story-generation.service.ts check L948-976；cacheDraft L2241；getCachedDraft L2257 |
| **F. Persist/Check/Draft** | persist 前强冲突审计 | assertDraftQualityBeforePersist 仅做：占位/极短、55+ 终局违规、第一人称、360 字、severeWeakHook（非终局）、ending_closure_missing（59+）；**无**对手动作/主角反制/转折的 block 条件 | 部分落地 | assertDraftQualityBeforePersist L812 起 |

---

# 3. 关键缺口 Top 10

（按对「短剧不好看」的严重程度排序）

1. **QA 无「对手动作缺失」检查**  
   正文可以完全没有具体敌方角色正在做的动作（只有「局势紧张」「敌军有阴谋」），也不会触发任何 issue，rewrite 与 persist 都不会拦截。  
   **证据**：diagnoseEpisode / runRuleBasedCheck 无 antagonist_action_missing；evaluateStoryTextForShortDrama 无对手动作相关字段。

2. **QA 无「主角反制缺失」检查**  
   正文可以只有「我意识到」「我决定小心」，没有可拍的反制动作（设局、拦截、揭穿、调兵等），不会触发 issue。  
   **证据**：同上，无 protagonist_counteraction_missing。

3. **Writer 输出后无人校验 must_show 落地**  
   Beat 的 execution_blocks.must_show 可在 prompt 里要求「必须拍出的具体画面/动作」，但 storyText 返回后**没有任何代码**检查是否包含这些 must_show 或 conflict_15s 的 protagonist_action/antagonist_reaction。  
   **证据**：runP2WriterBatch 仅校验 length、placeholder、evaluateStoryTextForShortDrama（无 must_show 覆盖逻辑）。

4. **Evidence 不提供「本集对手正在实施的动作」**  
   activeOpponents 只有谁是对手、威胁类型、描述，**没有**「本集该对手正在做什么」的结构化字段，Beat Planner 只能从 outline/core_conflict 泛化理解，难以稳定产出可拍对手动作。  
   **证据**：material-sifting.dto.ts EvidenceOpponent；buildEvidencePack 无 antagonist_action 类字段。

5. **QA 无「单集转折缺失」检查**  
   中后段可以没有局势变化、身份揭露、计划失效、主角反打，仅「又收到一封密报」式信息追加，也不会触发 reversal_missing。  
   **证据**：diagnoseEpisode 无 reversal_missing；evaluateStoryTextForShortDrama 无 reversal 相关指标。

6. **Beat 解析后不校验 antagonist_reaction / protagonist_action 非空**  
   模型可返回 conflict_15s 中 antagonist_reaction 或 protagonist_action 为空字符串，解析层不补全、不告警，Writer 收到的 beat 本身就缺「对手动作/主角反制」的约束。  
   **证据**：runBeatPlanner 中对 rawBeat 仅检查 episode_meta 与 pacing_structure 存在，不检查 conflict_15s 内容或 must_show 非空。

7. **Rewrite 无法针对性补「对手动作/反制/转折」**  
   因 QA 没有对应 issue type，rewrite 不会收到「缺对手动作」等信号；即便有，当前 REPAIR RULES 也没有「补一段对手具体动作」「补一段主角反制动作」的规则。  
   **证据**：AUTO_REWRITE_SYSTEM_PROMPT REPAIR RULES；runAutoRewrite repairInstruction 分支仅区分 structural-finale 与 minimal-fix。

8. **Persist 门禁不包含强冲突维度**  
   persist 前只挡：占位、过短、终局违规、第一人称、severeWeakHook、ending_closure_missing；**不挡**「无对手动作」「无主角反制」「无转折」的正文。  
   **证据**：assertDraftQualityBeforePersist L812 起。

9. **execution_blocks 的 must_show 常为空**  
   Fallback beat 与 59-61 注入的 execution_blocks 的 must_show 均为 []；模型若省略 must_show 也仅 prompt 约束，无解析后默认注入「至少 1 条对手动作/1 条主角反制」的逻辑。  
   **证据**：createFallbackBeat L1467-1471；runBeatPlanner 中 finale-fix 注入的 execution_blocks L1287-1291 must_show: [].

10. **Check 的规则维度不包含强冲突**  
    runRuleBasedCheck 的 episodeIssues 仅：missing_text, too_short, narration_too_short, third_person_summary, event_density_low, weak_hook, ending_closure_missing, rewrite_goal_violation；**无** antagonist_action_missing、protagonist_counteraction_missing、reversal_missing、conflict_intensity_low。  
    **证据**：runRuleBasedCheck L2342-2394。

---

# 4. 为什么当前系统会生成「有字数但没爆点」的文本

从代码机制角度说明，而非仅归因「模型不听话」：

1. **Evidence 不提供「本集对手动作」**  
   Beat Planner 拿到的证据包只有对手是谁、本集目标、视觉锚点、禁止项，**没有**「本集对手正在做的具体事」。模型容易产出 antagonist_goal 或 conflict_15s.antagonist_reaction 的泛化表述（如「搅动朝局」「威胁稳固」），而不是可拍动作（如「李景隆夜调金川门守军」「密信被截」）。

2. **Beat 产出质量无代码兜底**  
   解析后不校验 antagonist_reaction/protagonist_action/must_show 是否非空、是否具体。Writer 拿到的 beat 可能 conflict 块本身就是空或抽象，Writer 只能「按抽象 beat 扩写」，自然容易写成摘要式。

3. **Writer 输出无强冲突校验**  
   即便 Beat 里写了具体对手动作与反制，Writer 是否在 storyText 里写出来**无人检查**。没有「storyText 中是否出现 antagonist_reaction 对应内容」「是否出现 protagonist_action 对应内容」的校验，也没有 must_show 逐条覆盖检查，模型用「局势紧张」「我意识到」替代也不会被拦截。

4. **QA 不查「对手/反制/转折」**  
   diagnoseEpisode 与 runRuleBasedCheck 只查字数、第一人称、动作词密度、尾钩强弱、终局收束、改写目标；**不查**「是否有具体对手动作」「是否有主角反制」「中段是否有转折」。因此「有字数但没爆点」的稿子不会被打上 high 问题，也不会触发 rewrite 或 persist 拦截。

5. **Rewrite 补的是「字数/人称/尾钩」而非「戏」**  
   event_density_low 时 prompt 要求用具体动作替换心理句，但**不**要求「补一段对手正在做的具体事」或「补一段主角反制」。缺少 QA 的强冲突 issue，rewrite 既不知道要补什么，也没有针对「补对手动作/补反制/补转折」的规则，结果仍是补表面密度而非补冲突结构。

6. **Persist 门禁不包含强冲突**  
   只要字数够、第一人称够、尾钩不 severe weak、59+ 有收束、无改写目标违规，就可以写库。**没有**「无对手动作/无主角反制/无转折则禁止写库」的条件，因此「有字数但没爆点」的正文可以完整通过并落库。

---

# 5. 最小改造清单

（只列最小必要改造，不直接改代码。）

## Prompt 层

- Beat Planner：在 user message 或 system 中**显式要求**每集 conflict 块必须写出「本集对手正在做的一件具体事」和「主角的一次具体反制动作」，且 must_show 中至少 2 条与「对手动作/主角反制」相关。
- Writer：在 user message 中**显式要求**「正文中必须出现 beat 里 conflict_15s.antagonist_reaction 与 protagonist_action 的对应场面，不得用概括句替代」；可选要求「中段必须出现与 mid_reversal 对应的具体转折事件」。
- 以上仍为「口头约束」，若不配合下面 schema/QA/rewrite，效果有限。

## Beat schema 层

- 解析后校验：若 conflict_15s.antagonist_reaction 或 protagonist_action 为空或过短（如 &lt; 5 字），对该集注入默认提示或打 warn，并考虑注入一条默认 must_show（如「对手有一次具体动作」「主角有一次具体反制」）避免 Writer 拿到空冲突。
- 可选：要求 execution_blocks 中 purpose=conflict 的块 must_show 至少 1 条，否则解析后补一条默认。

## QA 层

- 新增 issue types（建议）：**antagonist_action_missing**（正文中无具体对手动作或仅有抽象威胁）、**protagonist_counteraction_missing**（正文中无主角可拍反制动作或仅有「我决定/我意识到」）、**reversal_missing**（中后段无明确局势变化/身份揭露/计划失效/反转）、**weak_end_hook**（已有，可保留）、**conflict_intensity_low**（综合：对手动作+主角反制+转折均不足）。
- 在 evaluateStoryTextForShortDrama 或独立函数中实现：基于正则/关键词或简单规则判断「是否出现至少一处对手具体动作」「是否出现至少一处主角反制动作」「中段是否出现转折类关键词/结构」；若否则推对应 issue，severity=high。
- runRuleBasedCheck 与 diagnoseEpisode 中接入上述检查，使 check 与 autoRewrite 能收到这些 issue。

## Rewrite 层

- 当 issue 含 antagonist_action_missing、protagonist_counteraction_missing、reversal_missing 时，在 user message 中**明确写**「本次需补戏：补出 beat 中对手正在做的具体事、主角的具体反制、以及中段转折事件」，并允许对冲突段（如中 30%+ 尾 30%）做结构性改写，而非仅最小字面修补。
- REPAIR RULES 中增加上述三种 issue 的修复策略（补对手动作、补主角反制、补转折场面）。

## Persist / Draft 层

- 可选：在 assertDraftQualityBeforePersist 中增加「强冲突最低线」：例如当 evaluateStoryTextForShortDrama 扩展出 antagonist_action_ok、protagonist_counteraction_ok、reversal_ok 时，若三者皆 false 则打 warn 并可选 block（或仅 block 部分集数），避免「无爆点」正文直接写库。
- Draft 与 Check 已支持 draftId 审未保存草稿，无需改；若需「persist 前自动跑强冲突审计」，可在 persist 入口先调一次 runCheck 的规则分支并合并强冲突 issue，再决定是否放行。

---

# 6. 哪些规则应该升级为硬门槛

建议新增或强化的 **issue types** 与使用方式：

| 建议 issue type | 含义 | 建议 severity | 建议用途 |
|-----------------|------|---------------|----------|
| **antagonist_action_missing** | 正文中无具体对手动作（仅有「敌军有阴谋」「局势紧张」等泛表述） | high | diagnoseEpisode、runRuleBasedCheck；needsRewrite；persist 可选 block |
| **protagonist_counteraction_missing** | 正文中无主角可拍反制（仅有「我意识到」「我决定小心」等） | high | 同上 |
| **reversal_missing** | 中后段无明确转折（无局势变化/身份揭露/计划失效/主角反打等） | high 或 medium | 同上；可先 medium，观察后再调 high |
| **weak_end_hook** | 已有，结尾钩子过弱 | high | 保持现状 |
| **conflict_intensity_low** | 综合：对手动作+主角反制+转折均不足，单集缺乏强冲突 | high | 可作为「总开关」，当上述三项多数缺失时触发 |

**Block 条件建议**：

- **needsRewrite**：当 diagnoseEpisode 推得 antagonist_action_missing、protagonist_counteraction_missing、reversal_missing 任一为 high 时，needsRewrite=true，触发 autoRewrite。
- **Persist-block**：当 assertDraftQualityBeforePersist 中某集存在 antagonist_action_missing 或 protagonist_counteraction_missing（若实现为规则检查）时，可选择 block 该集或整稿；或先不 block，仅打 warn 并记录，待观察后再设为硬 block。

**Rewrite 触发条件**：

- 当 diagnosis.issues 含 antagonist_action_missing、protagonist_counteraction_missing、reversal_missing 时，runAutoRewrite 的 user message 应切换为「允许对冲突段与结尾段做结构性补戏（补对手动作、补主角反制、补转折）」，与 structural-finale 类似，而非仅 minimal-fix。

---

# 7. 结论必须区分的两件事

- **「代码是否具备自动生成强冲突文本的机制」**  
  当前**不具备**。具备的仅是：通过 prompt 要求 Beat/Writer 写对手动作、主角反制、转折、尾钩；通过事件密度、尾钩强弱、终局收束、第一人称等规则做 QA 与 persist 门禁。**没有**针对「对手动作 / 主角反制 / 单集转折」的 schema 校验、QA issue、rewrite 补戏规则或 persist 硬门槛。

- **「当前实现是否只是口头要求，没有代码兜底」**  
  **是**。Beat 与 Writer 的「对手动作」「主角反制」「转折」「must_show 落段」仅写在 prompt；解析不校验、Writer 输出不校验、QA 不检查、Rewrite 不按这些维度补戏、Persist 不挡。因此「短剧强冲突」在代码层面**名义落地或未落地**，无法保证系统自动产出具备强冲突的 storyText。

---

**审计完成。未修改任何业务代码。**
