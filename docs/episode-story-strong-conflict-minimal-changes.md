# Episode Story 强冲突最小必要改造说明

在《Episode Story 短剧强冲突审计报告》基础上，完成最小必要改造，使 episode story 流程更稳定地产出具备短剧强冲突的文本。

---

## 一、修改文件清单

| 文件 | 修改类型 |
|------|----------|
| `apps/api/src/pipeline/episode-story-generation.service.ts` | 常量、评估逻辑、Beat/Writer/QA/Rewrite/Persist/Check 全链路 |
| `apps/api/src/pipeline/dto/episode-story-generation.dto.ts` | 新增 `EpisodeStrongConflictAudit`、`StoryCheckReportEpisodeItem.strongConflictAudit` |

---

## 二、每个修改点对应函数/位置

### A. Beat Planner

| 修改点 | 位置 | 说明 |
|--------|------|------|
| Prompt 强冲突四要素 | `BEAT_PLANNER_SYSTEM_PROMPT` 内「CORE INSTRUCTIONS」 | 新增第 3 条：每集必含 antagonist_action（conflict_15s.antagonist_reaction）、protagonist_counteraction（conflict_15s.protagonist_action）、reversal（mid_reversal）、end_hook（tail_hook）；execution_blocks 的 conflict/reversal/climax_tail 块 must_show 与四类内容可定位。 |
| 解析后补默认 / 打 warning | `runBeatPlanner` 内解析有效 beat 后的分支 | 若 antagonist_reaction / protagonist_action 长度 &lt; 4，打 log warning 并注入默认占位文案到 conflict_15s，供 Writer 明确「须在正文中写出」；不新增 schema 字段。 |

### B. Writer

| 修改点 | 位置 | 说明 |
|--------|------|------|
| 强冲突四要素明确要求 | `P2_WRITER_SYSTEM_PROMPT` 内「ABSOLUTE COMMANDMENTS」前 | 新增小节「强冲突四要素（正文必须落出）」：对手在做什么、主角怎么反制、中段转折、结尾钩子；禁止仅用「收到情报/安排部署/气氛紧张」冒充强冲突。 |

### C. QA / Diagnose

| 修改点 | 位置 | 说明 |
|--------|------|------|
| 强冲突规则与返回值 | `evaluateStoryTextForShortDrama` | 新增常量 `ANTAGONIST_ACTION_PATTERNS`、`PROTAGONIST_COUNTERACTION_PATTERNS`、`REVERSAL_PATTERNS`；返回值新增 `antagonistActionOk`、`protagonistCounteractionOk`、`reversalOk`、`endHookOk`、`conflictIntensityLow` 及对应 warnings。 |
| 新增 issue 类型 | `diagnoseEpisode` | 根据 ev 推 issue：`antagonist_action_missing`、`protagonist_counteraction_missing`、`reversal_missing`、`end_hook_missing`（非终局集）、`conflict_intensity_low`，severity 均为 high，参与 needsRewrite。 |
| 规则检查与审计结果 | `runRuleBasedCheck` | 对每集 ev 增加上述 5 类 issue 的 push 与扣分；每集写入 `strongConflictAudit`（hasAntagonistAction/hasProtagonistCounteraction/hasReversal/hasEndHook/conflictIntensityLow）；每集有 ev 或 issues 即输出一项（含 strongConflictAudit）。 |
| 合并报告保留审计 | `mergeRuleAndLlmReport` | 从 ruleReport.episodeIssues 取 `strongConflictAudit` 写入 auditByEp，合并时每集带出 strongConflictAudit。 |

### D. Auto-Rewrite

| 修改点 | 位置 | 说明 |
|--------|------|------|
| REPAIR RULES 强冲突 | `AUTO_REWRITE_SYSTEM_PROMPT` | 新增 antagonist_action_missing、protagonist_counteraction_missing、reversal_missing、end_hook_missing、conflict_intensity_low 的修复策略；STRUCTURAL REWRITE 增加「强冲突补戏」说明。 |
| 按 issue 类型选修复策略 | `runAutoRewrite` | 定义 `strongConflictIssueTypes`，`needsStructuralConflictFix = hasStrongConflictIssue`；当 needsStructuralConflictFix 时使用「补戏核」的 repairInstruction（补对手动作/主角反制/转折/结尾钩子），可与 needsStructuralFinale 叠加；日志 mode 增加 `structural-conflict-fix`。 |

### E. Draft / Check / Persist

| 修改点 | 位置 | 说明 |
|--------|------|------|
| 强冲突门禁 | `assertDraftQualityBeforePersist` | 每集 ev 后增加：若 !antagonistActionOk / !protagonistCounteractionOk / !reversalOk / (非终局 && !endHookOk) / conflictIntensityLow，则 throw BadRequestException，Persist blocked。 |
| Check 返回强冲突审计 | 已满足 | `check(novelId, dto)` 支持 `dto.draftId` 从 `getCachedDraft` 取草稿；`runCheck` → `runRuleBasedCheck` 返回的 `episodeIssues` 每项含 `strongConflictAudit`，merge 时保留；故未保存草稿也可审，且返回每集强冲突审计结果。 |

### F. DTO

| 修改点 | 位置 | 说明 |
|--------|------|------|
| 强冲突审计类型 | `dto/episode-story-generation.dto.ts` | 新增 `EpisodeStrongConflictAudit`（hasAntagonistAction, hasProtagonistCounteraction, hasReversal, hasEndHook, conflictIntensityLow）；`StoryCheckReportEpisodeItem` 增加可选 `strongConflictAudit`。 |

---

## 三、新增 Issue Types、判定逻辑、Severity

| Issue Type | 判定逻辑 | Severity | 触发 Rewrite | 影响 Persist |
|------------|----------|----------|--------------|--------------|
| **antagonist_action_missing** | 正文不匹配 `ANTAGONIST_ACTION_PATTERNS`（调兵/夜袭/密会/截信/陷害/逼宫/开城门/倒戈/传假旨/围攻/伏击/收买/刺探/下毒/夺门/献城/叛变等） | high | 是 | 是（block） |
| **protagonist_counteraction_missing** | 正文不匹配 `PROTAGONIST_COUNTERACTION_PATTERNS`（设局/拦截/揭发/调兵/布防/对质/审问/抓捕/反情报/换防/封门/搜/查/夺下/伏击/密会/呈报/拆开密折/调动援军/拦下/堵住/识破/将计就计/先发制人/拿下/控制/稳住/清剿/肃清等） | high | 是 | 是（block） |
| **reversal_missing** | 正文不匹配 `REVERSAL_PATTERNS`（身份揭露/计划失效/局势反转/倒戈/证据曝光/真相大白/反水/败露/失守/逆转/原来.*竟是/没想到/不料/竟然/突然.*发现/被识破/计划落空/功亏一篑/峰回路转/柳暗花明/局势陡变/形势急转等） | high | 是 | 是（block） |
| **end_hook_missing** | 非终局集（ep &lt; 59）且 `!endHookOk`：endHookOk = 非终局时「非 severeWeakHook 且 (concreteHookOk 或 eventHookOk)」 | high | 是 | 是（block） |
| **conflict_intensity_low** | 四要素（antagonistActionOk, protagonistCounteractionOk, reversalOk, endHookOk）中达标数 &lt; 3 | high | 是 | 是（block） |

- **触发 Rewrite**：diagnoseEpisode 中上述类型均为 severity `high`，`needsRewrite = issues.some(i => i.severity === 'high')`，故会进入 autoRewriteIfNeeded。
- **影响 Persist**：assertDraftQualityBeforePersist 在任一项缺失时 throw BadRequestException，persist 不通过。

---

## 四、为什么这样能直接提升「强冲突」质量

1. **Beat 层**：Prompt 明确要求四要素可定位，解析后缺项会打 warning 并注入占位文案，Writer 拿到的 beat 不会在「对手动作/主角反制」上完全空白。
2. **Writer 层**：指令明确「正文必须落出」四类内容并禁止泛表述冒充，模型有明确写作约束。
3. **QA 层**：规则对正文做关键词/句式级判断（对手动作、主角反制、转折、尾钩），缺项即打 high issue，needsRewrite 为 true，且 check 返回 strongConflictAudit，未保存草稿也能看到哪几集缺哪几项。
4. **Rewrite 层**：强冲突类 issue 不再走「最小化修复」，而是走「补戏核」的结构性修复指令，按缺失类型要求补对手动作/主角反制/转折/结尾钩子，避免只补字数。
5. **Persist 层**：高严重度强冲突缺失时直接 block 写库，倒逼生成与重写阶段产出达标正文。

整体形成闭环：**Evidence → Beat 结构化冲突（含四要素）→ Writer 落戏 → QA 查强冲突 → Rewrite 补戏核 → Check 返回审计 → Persist 门禁**，强冲突从「仅 prompt 要求」变为「有规则校验、有重写补戏、有写库门禁」的机制。

---

## 五、构建结果

- **TypeScript**：`npx tsc --noEmit` 在 `apps/api` 下通过（exit code 0）。
- **Lint**：`episode-story-generation.service.ts`、`dto/episode-story-generation.dto.ts` 无 linter 报错。

---

## 六、使用说明（与现有链路的关系）

- **generate-draft**：仍返回 `draftId`，草稿缓存在服务端（TTL 30 分钟）。
- **episode-story-check**：支持传 `draftId`（或 draft / versionIds）；check 时用规则评估每集，返回 `episodeIssues` 及每项 `strongConflictAudit`，可看到「哪几集缺对手动作/主角反制/转折/钩子」。
- **persist**：写库前会跑与 check 相同的强冲突规则；任一项缺失会 Persist blocked，并给出明确 BadRequest 文案。
- **自动重写**：生成流程中若 diagnose 出强冲突类 issue，会自动进入 runAutoRewrite，并按「补戏核」策略重写，而非仅最小化修补。

建议先对小批量（如 1–5 集或 16–20 集）跑一轮生成 → check（看 strongConflictAudit）→ 必要时人工审阅或再生成，确认四要素被稳定抓住后再放大到 61 集。
