# Episode Story 占位数据根因报告（Placeholder Root Cause Report）

基于当前 main 分支代码的只读分析，不涉及代码修改。

---

## 1. Executive Summary

1. **story_text 写入路径**：前端「生成草稿」→ `episodeStoryApi.generateDraft` → `POST /pipeline/:novelId/episode-story-generate-draft` → `EpisodeStoryGenerationService.generateDraft` → `runPlanner` → 多轮 `runWriterBatch` → 合并 `allEpisodes` → 缓存；用户点「确认写入」→ `persistDraft` → `EpisodeStoryVersionService.create` 逐条 INSERT，写入 `episode_story_versions.story_text`。

2. **占位串唯一来源**：`apps/api/src/pipeline/episode-story-generation.service.ts` 中 **`runWriterBatch`** 方法，约第 **363 行**：`storyText: typeof one.storyText === 'string' ? one.storyText : (one.story_text ?? \`第${epNum}集故事正文。\`) as string`。当 `one.storyText` 非字符串且 `one.story_text` 为 null/undefined 时，使用该 fallback。

3. **触发条件**：Writer 的 LLM 返回经 `parseJsonFromText` 解析后得到 **空数组** 或 **元素中无有效 `storyText`/`story_text`**（如 key 名不符、值为 null）。此时 `arr[i]` 为 undefined 或无效对象，`one = {}`，必然走占位。

4. **整批触发**：`runWriterBatch` 按 `for (let i = 0; i < batch.length; i++)` 循环，**不检查** `arr.length`；若 `arr = []`，则对每个 `i` 都有 `arr[i] === undefined`，该批每集都得到占位。

5. **61 集全部触发**：13 批 × 每批 5 集，每批 Writer 若都返回空/无效结构，则 13 批均整批占位，合并后 61 集全部为「第N集故事正文。」。

6. **为何被当成成功**：`generateDraft` 仅用 `findMissingEpisodeNumbers` 判断缺集，`finalCompletenessOk = missing.length === 0`；不校验 storyText 是否占位或过短。`persistDraft` 无任何质量门禁，有 `episodeNumber` 和 `storyText` 即写库。

7. **title = 第N集**：`persistDraft` 第 181 行 `title: ep.title || \`第${ep.episodeNumber}集\``。Writer 占位时 title 取自 `one.title ?? batch[i]?.title`，planner 解析失败时多为 undefined，persist 层 fallback 为「第N集」。

8. **summary = NULL**：Writer 占位分支 `summary: one.summary ?? batch[i]?.summary` 为空；persist 传 `summary: ep.summary ?? null`，故库中为 NULL。

9. **word_count = 8/9**：`EpisodeStoryVersionService.create` 中 `wordCount = dto.wordCount != null ? dto.wordCount : (dto.storyText?.length ?? 0)`（约第 78–79 行）。未传 wordCount 时用 storyText 长度，「第N集故事正文。」长度为 8（N 个位）或 9（N 十位），与现象一致。

10. **根因归类**：解析/模型输出与预期不符时**静默走兜底**（runWriterBatch 用占位补全且不抛错），且 **persist 前无质量门禁**，导致占位数据被当作正常 draft 写入。

11. **现有日志**：story generation 主链路中仅 `check` 的 QA v2 失败处有一处 `this.logger.warn`（约第 474 行）；generateDraft / runPlanner / runWriterBatch / persistDraft **无任何日志**，无法看到 planner/writer 原始输出与 parse 结果。

12. **建议**：P0 必须做——runWriterBatch 在解析结果空或明显无效时抛错而非静默占位；persistDraft 前增加占位/过短正文门禁。P1 建议——按下文「建议日志设计」补足日志，便于联调。

---

## 2. Actual Call Chain

从前端点击「生成草稿」到 DB 写入的完整调用链：

```
【生成草稿】
  StoryTextPanel.handleGenerateDraft (apps/web/src/components/story-text/StoryTextPanel.tsx)
    → episodeStoryApi.generateDraft(novelId, payload) (apps/web/src/lib/episode-story-api.ts, POST /pipeline/:novelId/episode-story-generate-draft)
  PipelineController.generateEpisodeStoryDraft (apps/api/src/pipeline/pipeline.controller.ts, 约 172–177 行)
    → EpisodeStoryGenerationService.generateDraft(novelId, dto) (episode-story-generation.service.ts, 86–168 行)
        → buildContextBlocks(...)
        → runPlanner(usedModelKey, novelId, targetCount, promptPreview, ...)  → 单次 LLM，得到 plan[]
        → splitBatches(plan, batchSize)  → 如 61 集拆成 13 批
        → for each batch: runWriterBatch(...)  → 每批一次 LLM，parse 后得到本批 draft 项（此处产生占位）
        → allEpisodes = 各批 batchDraft 合并
        → findMissingEpisodeNumbers(...) → finalCompletenessOk = (missing.length === 0)
        → cacheDraft(draftId, draft)
        → return { draftId, draft, batchInfo, finalCompletenessOk, ... }

【确认写入数据库】
  StoryTextPanel.handlePersistDraft (StoryTextPanel.tsx)
    → episodeStoryApi.persistDraft(novelId, payload) (episode-story-api.ts, POST /pipeline/:novelId/episode-story-persist)
  PipelineController.persistEpisodeStoryDraft (pipeline.controller.ts, 179–185 行)
    → EpisodeStoryGenerationService.persistDraft(novelId, dto) (episode-story-generation.service.ts, 171–195 行)
        → resolveDraftForPersist(...)  → 从 cache 或 dto.draft 取 draft
        → for each ep in draft.episodes:
            EpisodeStoryVersionService.create(novelId, { episodeNumber, storyType, title, summary, storyText, ... })
              (apps/api/src/pipeline/episode-story-version.service.ts, 67–103 行)
              → INSERT INTO episode_story_versions (..., title, summary, story_text, word_count, ...)
```

---

## 3. Placeholder Source

### 3.1 “第N集故事正文。” 从哪里来

- **文件**：`apps/api/src/pipeline/episode-story-generation.service.ts`
- **方法**：`runWriterBatch`
- **位置**：约第 **363 行**（`out.push` 内）

```typescript
storyText: typeof one.storyText === 'string' ? one.storyText : (one.story_text ?? `第${epNum}集故事正文。`) as string,
```

### 3.2 触发条件

- `one` 来自 `(arr[i] || {}) as WriterItemLike`，`arr` 来自 `parseJsonFromText(raw)` 解析 Writer LLM 返回后的数组（或 `parsed?.episodes ?? []`）。
- 当以下任一成立时走 fallback：
  - `arr` 为空数组，则 `arr[i]` 为 undefined，`one = {}`，`one.storyText` 与 `one.story_text` 均无效；
  - `arr[i]` 存在但无 `storyText`/`story_text` 或两者均非非空字符串（如 key 为 `content`/`text`、或值为 null）。

### 3.3 为什么会整批触发

- 循环为 `for (let i = 0; i < batch.length; i++)`，**产出条数恒为 batch.length**，不依赖 `arr.length`。
- 若 `arr = []`（例如 LLM 返回 `[]`、`{}`、`{ "episodes": [] }`），对任意 `i` 有 `arr[i] === undefined`，本批每一集都走占位。

### 3.4 为什么会导致 61 集全部触发

- 61 集按 batchSize=5 拆成多批（如 13 批）。若**每一批** Writer 返回都被解析为空或无效数组，则每一批的 5 集全部占位，合并后 61 集均为「第N集故事正文。」。

---

## 4. Why It Was Treated As Success

### 4.1 generateDraft 为什么没拦住

- **成功判定**：仅依赖 `findMissingEpisodeNumbers(allEpisodes.map(e => e.episodeNumber), targetCount)`；`finalCompletenessOk = missing.length === 0`（约第 143–147 行）。
- **不做的校验**：不检查 `storyText` 是否为空、是否为占位串、是否过短；没有 `validateDraft` 或“正文质量”逻辑。
- 因此 61 条占位 draft 集数齐全，`finalCompletenessOk === true`，接口仍返回成功。

### 4.2 persistDraft 为什么没拦住

- **逻辑**：`resolveDraftForPersist` 取到 draft 后，对 `draft.episodes` 逐条 `EpisodeStoryVersionService.create`，传入 `ep.storyText` 等，**无任何校验**（约 176–186 行）。
- 不检查 storyText 长度、是否等于「第N集故事正文。」、是否为空；有字段即写库。

### 4.3 前端为什么允许继续写入

- **StoryTextPanel.handlePersistDraft**（约 277–302 行）：仅校验 `storyDraft?.episodes?.length` 存在即可点「确认写入数据库」；不根据 `finalCompletenessOk` 或正文内容禁止写入。
- 按钮 disabled 条件为 `!draft?.episodes?.length || persisting || generating`，与占位/质量无关。

---

## 5. Planner / Writer Expected JSON vs Actual Risk

### 5.1 Planner 期待与 parse

- **期待**：LLM 返回**严格 JSON 数组**，元素含 `episodeNumber`/`episode_number`、`title`/`episodeTitle`、`summary`、`storyBeat`（prompt 见 runPlanner 277–279 行）。
- **parse**：`parseJsonFromText(raw)`；`arr = Array.isArray(planLike) ? planLike : planLike?.episodes ?? planLike?.plan ?? []`（295–297 行）。
- **补齐**：循环 `for (let i = 0; i < (targetCount || 61); i++)`，用 `arr[i]` 填 plan；若 `arr` 不足或为空，缺失项为 undefined，仍产出 targetCount 条 plan。
- **若返回 [] / {} / { episodes: [] }**：`arr = []`，plan 为 61 条“空规划”（仅 episodeNumber 有 i+1，title/summary/storyBeat 均为 undefined），Writer 仍会按此执行 13 批；若 Writer 再返回空，则 61 集全部占位。

### 5.2 Writer 期待与 parse

- **期待**：每项含 `episodeNumber`/`episode_number`、`title`、`summary`、`storyText`/`story_text`（prompt 334–335 行）。
- **parse**：`arr = Array.isArray(withEpisodes) ? withEpisodes : withEpisodes?.episodes ?? []`（353–354 行）；按 `batch.length` 循环，`one = (arr[i] || {}) as WriterItemLike`（356–357 行）。
- **若返回 [] / {} / { episodes: [] }**：`arr = []`，本批每集 `one = {}`，storyText 必为占位。
- **key 不匹配导致 storyText 丢失**：代码只认 `storyText`（camel）和 `story_text`（snake）。若模型返回 `content`、`text`、`body` 等，不会被使用，该项会走占位。

### 5.3 parseJsonFromText 行为

- 从 raw 中提取第一个 `{...}` 或 `[...]`，或 `[ firstIndexOf('[') .. lastIndexOf(']') ]` 再 parse（601–617 行）。
- 无法解析时 **throw BadRequestException('AI 返回不是有效 JSON')**，不会静默返回。因此占位只会在 **parse 成功但结构/内容不符合预期** 时发生（如 parse 出 `[]` 或元素缺 storyText）。

---

## 6. Probability Ranking of Root Causes

按概率从高到低：

1. **Writer LLM 每次返回体被解析为空或“无有效 storyText 的数组”**  
   - 例如返回 `[]`、`{}`、`{ "episodes": [] }`，或数组元素只有说明没有 storyText。  
   - 依据：61 集全部占位且 word_count 8/9 一致，说明 runWriterBatch 每批都走了同一 fallback；parse 若失败会抛错，用户会看到失败，故 parse 成功但内容无效的概率最高。

2. **Writer 返回的 key 与代码不一致**  
   - 如模型用 `content`/`text` 而非 `storyText`/`story_text`，或嵌套在其它字段下。  
   - 依据：代码仅读取 storyText/story_text，其它 key 会导致该项走占位；若整批都如此则整批占位。

3. **Planner 返回空或无效，Writer 收到的 batch 规划信息不足，模型只返回说明或空结构**  
   - 依据：planner 若 arr=[] 会产出 61 条空 plan，Writer 每批收到的 batch 几乎无有效 title/summary，模型可能更容易返回非预期结构或空数组。

---

## 7. Logging Gap Analysis

### 7.1 当前已有哪些日志

- **episode-story-generation.service.ts**：仅有一处——`check()` 内 QA v2 LLM 失败时 `this.logger.warn('QA v2 LLM check failed, falling back to rule report', err)`（约第 474 行）。
- **generateDraft / runPlanner / runWriterBatch / persistDraft**：**无任何日志**。

### 7.2 还缺哪些日志

- generateDraft 入口（novelId、targetCount、batchSize、referenceTables 数量）。
- buildContextBlocks 后（可选：context 规模）。
- runPlanner：发请求前（prompt 长度）、收到 raw 后（raw 前 500 字）、parse 后（是否成功、arr.length / plan 条数）。
- splitBatches 后（批次数、每批条数）。
- runWriterBatch 每批：发请求前（batch 索引、prompt 长度）、收到 raw 后（raw 前 500 字）、parse 后（arr.length、本批占位条数）、发现占位时（episodeNumber 或计数）。
- merge 后（allEpisodes.length、missing 列表）。
- persistDraft：写库前逐集（episodeNumber、title、summary 是否空、storyText.length、是否占位串）、写库后总结（插入条数）。

### 7.3 为什么现在看不到 planner / writer 原始输出与 parse 结果

- 主链路未打日志，因此无法从现有日志中看到 raw 与 parse 结果；只能通过补上述日志点才能定位“是模型空返回、key 不符还是 parse 抽错”。

---

## 8. P0 / P1 Fix Recommendations（只给方案，不改代码）

### P0：必须立即修，避免再次把垃圾数据写库

1. **收紧 runWriterBatch 的 fallback**  
   - 当 `arr.length === 0` 或本批解析结果明显无效（例如本批多数项无有效 storyText）时，**不要静默补占位**；应 **throw BadRequestException**，明确提示“Writer 返回为空或无效，请检查模型与 prompt”。  
   - 或：仅在“个别项”缺 storyText 时允许占位，并对该集打标记（如 `_placeholder: true`），persist 前据此拒绝写入。

2. **persistDraft 前质量门禁**  
   - 在写库前校验：若存在任意一集 `storyText` 等于「第N集故事正文。」或长度 &lt; 某阈值（如 50），则 **拒绝写入并抛 BadRequestException**，提示“检测到占位或过短正文，请重新生成草稿”。

3. **Writer 解析结果校验**  
   - 在 runWriterBatch 中，若 `arr.length < batch.length` 或本批产出中占位比例超过设定（如 &gt;50%），直接 **throw**，避免整批占位被合并和缓存。

### P1：建议修，便于联调和后续扩展

4. **按下一节「建议日志设计」补足日志**，至少覆盖 planner/writer 的请求与原始响应、parse 结果、占位触发、persist 前每集 storyText 长度与占位检测。

5. **与 narrator 对齐**：parse 失败即失败，不增加“parse 失败时用默认占位继续”的逻辑。

6. **可选前端提示**：若检测到 draft 中大量 storyText 过短或与占位串相同，可提示“部分集数为占位或过短，建议先 AI 检查或重新生成”。

---

## 9. Exact Patch Scope Proposal

### 建议只改的文件

- **apps/api/src/pipeline/episode-story-generation.service.ts**  
  - runWriterBatch：空/无效 arr 或高占位比例时抛错；可选占位标记。  
  - persistDraft：写库前增加占位/过短校验，不通过则抛错。  
  - 上述方法及 generateDraft/runPlanner 中增加 P1 日志点。

### 明确不要动的文件（避免扩散）

- apps/api/sql/*、episode_story_versions 表结构。
- apps/api/src/pipeline/episode-story-version.service.ts（仅被调用，不在此次改逻辑）。
- apps/api/src/pipeline/episode-story-version.controller.ts、dto。
- narrator-script、pipeline-episode-script 的 persist 与表。
- 前端除“可选提示”外，可不改；门禁以后端为准。

---

## 10. 建议日志设计（Suggested Logging）

以下日志点建议加在对应方法内，格式统一前缀 `[episode-story]`。

| 位置 | 方法 | 建议格式示例 |
|------|------|-----------------------------|
| generateDraft 入口 | `EpisodeStoryGenerationService.generateDraft` | `[episode-story][generateDraft] novelId=%s targetCount=%s batchSize=%s refTablesCount=%s` |
| buildContextBlocks 后 | 在 generateDraft 内调用后 | `[episode-story][buildContextBlocks] promptPreviewLen=%s`（建议） |
| runPlanner 发请求前 | `runPlanner` | `[episode-story][planner] promptChars=%s` |
| runPlanner 收到 raw 后 | `runPlanner` | `[episode-story][planner][raw] preview=%s`（前 500 字） |
| runPlanner parse 后 | `runPlanner` | `[episode-story][planner][parse] ok=true arrLen=%s planLen=%s` 或 parse 失败时在 parseJsonFromText 上层打 ok=false |
| splitBatches 后 | `generateDraft` 内 | `[episode-story][splitBatches] batchCount=%s` |
| runWriterBatch 每批发请求前 | `runWriterBatch` | `[episode-story][writer][batch %s/%s] promptChars=%s` |
| runWriterBatch 每批收到 raw 后 | `runWriterBatch` | `[episode-story][writer][batch %s][raw] preview=%s` |
| runWriterBatch 每批 parse 后 | `runWriterBatch` | `[episode-story][writer][batch %s][parse] arrLen=%s outLen=%s placeholderCount=%s` |
| runWriterBatch 发现占位时 | 循环内当使用占位时 | `[episode-story][writer][batch %s] isPlaceholder=true epNum=%s` |
| merge 后 | `generateDraft` 内 | `[episode-story][merge] actualEpisodes=%s missing=%s` |
| persistDraft 写库前逐集 | `persistDraft` 循环内 | `[episode-story][persist] episode=%s title=%s summaryNull=%s storyLen=%s isPlaceholder=%s` |
| persistDraft 总结 | `persistDraft` 循环后 | `[episode-story][persist][summary] inserted=%s` |

其中 `isPlaceholder` 可定义为：`ep.storyText === \`第${ep.episodeNumber}集故事正文。\``。

---

*报告仅基于当前 main 分支代码的只读分析，未做任何代码修改。*
