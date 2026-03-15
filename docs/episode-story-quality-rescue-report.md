# Episode Story 质量救火版结构改造报告

本文档说明本次「质量救火版」结构改造如何针对三类问题做改动，以及如何提高 persist 通过率；并列出仍未解决的风险。

---

## 一、解决的问题与方案概览

| 问题 | 根因（简要） | 本次改造要点 |
|------|--------------|--------------|
| storyText 动作事件密度不足、像剧情摘要 | 证据包过泛、Writer 只“扩写 beat”无执行约束 | Evidence Pack 本集化 + execution_blocks + Writer 按块写 + must_show 约束 |
| 59-61 集连续 ending_closure_missing | 无终局 schema、尾钩仍大开环 | Beat 增加 ending_closure；59-61 tail_hook 仅 closure_aftermath；Writer/Auto-Rewrite 明确收束 |
| persist 被 overallScore < 60 挡住 | 正文质量不达标导致 QA 低分 | 通过上述改动提升正文密度与终局收束，间接提高得分与通过率 |

---

## 二、Evidence Pack 过泛问题的解决

**目标**：让 `DramaticEvidencePack` 成为「本集专属编剧材料包」，而不是大而泛的背景集合。

### 2.1 source_material_context

- **原状**：直接取 `drama_source_text` 首条前 10000 字。
- **改动**：
  - 优先用本集 `novel_episodes` 的 `outline_content`、`core_conflict`、`hooks`、`cliffhanger` 构造「本集素材检索关键词」。
  - 若存在 `novel_source_segments`，则按关键词（`content_text` / `keyword_text` LIKE 匹配）检索最相关 segments，拼接为 excerpt，总长上限 10000 字。
  - 仅当没有 segments 命中时，才 fallback 到 `drama_source_text` 截断。

**涉及文件**：`material-sifting.service.ts`（`fetchSourceMaterialContext`、`extractEpisodeKeywords`、`fetchSourceExcerptByKeywords`）。

### 2.2 keyNodes / timelineEvents

- **原状**：整表全量给。
- **改动**：实现最小可运行过滤：
  - 优先取与当前集 `outline_content` / `core_conflict` / `hooks` 有关键词重叠的节点/事件；
  - 若无重叠，则只取 `sort_order` 最接近的前 2～4 条。

**涉及**：`filterKeyNodesByEpisodeRelevance`、`filterTimelineEventsByEpisodeRelevance`、`episodeRelevanceNeedle`。

### 2.3 activeOpponents

- **原状**：每集给全部对手。
- **改动**：在已有 `activeOpponents` 基础上筛出本集最相关 1～3 个：
  - 优先与当前 story phase / outline_content / hook 有重叠的；
  - 若无法判断，则只保留前 3 个。

**涉及**：`filterOpponentsByEpisodeRelevance`。

### 2.4 Evidence Pack 新增字段

- **episodeGoal**：从 `core_conflict` / `outline_content` 提炼一句「本集唯一目标」。
- **visualAnchors**：从 opening / hooks / cliffhanger / keyNodes / timelineEvents 提取 5～10 条可拍画面锚点。
- **forbiddenDirections**：至少包含 rewrite_goal 禁止项与终局禁止项（59-61 集禁止大开环尾钩等）。
- **continuity**：提供 `continuityIn` / `continuityOutHint`（如本集 opening、cliffhanger）。

**涉及**：`dto/material-sifting.dto.ts`（新字段与 `EvidencePackExtension`）、`material-sifting.service.ts`（`buildEpisodeGoal`、`buildVisualAnchors`、`buildForbiddenDirections`、`buildContinuity`）。

---

## 三、动作事件密度不足的解决

**目标**：storyText 不再只是「扩写 beat」，而是「按 execution_blocks 逐块写」，每块必须落成具体动作段。

### 3.1 Beat Planner：从策划说明升级为导演执行谱

- **保留**：`episode_meta`、`pacing_structure`。
- **新增**：
  - **execution_blocks** 数组，至少 4 块：hook / conflict / reversal / climax_tail。
  - 每块至少包含：`block_no`、`purpose`、`must_show[]`、`forbidden[]`。
- **Prompt**：要求 Beat Planner 用证据包中的 `episodeGoal`、`visualAnchors`、`forbiddenDirections` 约束输出，并为每块填写「必须拍出的具体动作/画面」与「禁止仅用心理句、总结句替代」。

**涉及**：`episode-story-generation.service.ts` 中 `StoryBeatJson`、`ExecutionBlockJson`、`BEAT_PLANNER_SYSTEM_PROMPT`。

### 3.2 Writer：按 execution_blocks 顺序写

- **明确**：storyText 必须按 `execution_blocks` 顺序展开。
- **每个 execution block** 至少落成一段具体动作；禁止只用心理句、总结句替代 `must_show`。
- **User message**：强调「按 execution_blocks 逐块写，must_show 必须落成具体动作/画面」。

通过「本集化证据包 + 执行块 + must_show」三重约束，直接提升动作事件密度，减少摘要式写法。

---

## 四、59-61 集 ending_closure_missing 的解决

**目标**：终局集有明确 schema 与收束要求，且不再用普通大开环尾钩。

### 4.1 Beat Planner：Finale Mode

- **59-61 集** 自动启用 finale mode：
  - 必须输出 **ending_closure**：`required = true`，`required_outcome[]` 至少包含：守住南京、稳住朝局、叛党被清/内奸伏法、建文帝权力稳固。
  - **tail_hook** 只能是「胜局后的最后余震」或「收束后的余味」，类型可为 `closure_aftermath`；禁止「还有更大阴谋」等普通开环。
- **Prompt**：明确 59/60/61 的 tail_hook 与 ending_closure 要求；`forbiddenDirections` 中已包含终局禁止项。

### 4.2 Writer：终局集结尾必须写清收束

- 若该集有 `ending_closure`，则最后一段必须兑现 `required_outcome`。
- 59-61 集结尾必须写清：南京是否守住、朝局是否稳住、叛党/内奸是否被清、建文帝是否稳住皇权；禁止使用普通大开环尾钩。

### 4.3 Auto-Rewrite：允许结构性重写结尾

- 若 qa_issues 中存在 **rewrite_goal_violation** 或 **ending_closure_missing**，禁止「最小字面修补」，**允许对结尾约 30% 做结构性重写**。
- 终局集修复目标优先兑现 `ending_closure.required_outcome`。

---

## 五、Persist 通过率的提高

**目标**：减少因 overallScore < 60 导致的「当前草稿无法写入数据库」。

### 5.1 机制说明

- Persist 前会跑 QA（规则 + LLM），得到 `overallScore`；若 `overallScore < 60` 则禁止写入并返回明确错误。
- 本次未改 QA 打分逻辑或阈值，而是通过**提升正文质量**间接提高得分：
  - **动作密度**：evidence 本集化 + execution_blocks + must_show，使正文更可拍、更少摘要化，有利于「事件密度」「字数」等维度。
  - **终局收束**：59-61 有 ending_closure 与 Writer/Auto-Rewrite 的收束要求，减少 ending_closure_missing 类 high 问题，有利于通过 QA 的 high 一票否决。
  - **改写目标**：forbiddenDirections 与 Beat/Writer/Auto-Rewrite 的改写目标约束一致，减少 rewrite_goal_violation，同样有利于通过。

### 5.2 可选的后续优化（未在本次实现）

- 若仍大量卡在 60 分以下，可考虑：微调 QA 权重、对「仅因 narration_too_short / event_density_low 且无 high」的集做放宽策略、或在 persist 前增加一次「仅修字数/密度」的轻量重写。

---

## 六、仍未解决的风险

1. **LLM 服从度**：Beat Planner / Writer / Auto-Rewrite 仍依赖模型严格按 schema 与 prompt 执行；若模型忽略 execution_blocks 或 ending_closure，问题会复现。可加：输出校验、缺字段时自动补 default、或少量 few-shot。
2. **novel_source_segments 质量与覆盖**：若 segments 少或关键词匹配不到，会回退到 drama_source_text 截断，本集化效果打折扣。可考虑：扩充 segments、或引入简单向量/BM25 检索。
3. **keyNodes/timelineEvents 过滤较糙**：当前为关键词重叠或 sort_order 前 2～4；若本集与节点关联弱，可能仍拿到不够贴合的节点。可考虑：按集数/时间线区间过滤，或小模型排序。
4. **overallScore 仍 < 60**：若草稿在风格、一致性、钩子等方面仍不达标，QA 仍可能给低分；本次只做结构侧救火，未改 QA 规则或阈值。
5. **Auto-Rewrite 两次仍失败**：已增加「质量救火 hint」日志（区分 beat 设计 / writer 未兑现 / rewrite 无法修结构），但自动修复能力仍受模型与 token 限制；人工审阅仍是终局集与低分集的兜底。

---

## 七、涉及文件清单

| 文件 | 改动摘要 |
|------|----------|
| `apps/api/src/pipeline/dto/material-sifting.dto.ts` | 新增 EvidencePackExtension；DramaticEvidencePack 增加 episodeGoal、visualAnchors、forbiddenDirections、continuity |
| `apps/api/src/pipeline/material-sifting.service.ts` | source_material 按本集关键词+segments；keyNodes/timelineEvents/opponents 过滤；extension 四字段构建 |
| `apps/api/src/pipeline/episode-story-generation.service.ts` | StoryBeatJson 增加 execution_blocks、ending_closure；Beat/Writer/Auto-Rewrite 的 prompt 与 user message；fallback beat 补 execution_blocks/ending_closure；2 次重写失败时的详细 error 日志 |

---

**报告生成时间**：与本次质量救火版结构改造同步完成。
