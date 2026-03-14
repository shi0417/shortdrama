# Episode Story 占位数据写入根因排查报告（Root Cause Discovery）

## 1. 执行摘要

1. **占位文本的唯一代码来源**：`apps/api/src/pipeline/episode-story-generation.service.ts` 中 `runWriterBatch` 方法第 363 行，当 `one.storyText` 非字符串且 `one.story_text` 为 null/undefined 时，使用 fallback：`` `第${epNum}集故事正文。` ``。
2. **触发条件**：Writer 的 LLM 返回体经 `parseJsonFromText` 解析后得到的是**空数组**，或**元素中既无 `storyText` 也无 `story_text` 的有效字符串**（例如 key 名不符、或为 null）。此时 `arr[i]` 为 undefined 或无效对象，`one = {}`，必然走占位分支。
3. **为何 61 集全是占位**：`runWriterBatch` 按 `batch.length` 循环，**不检查** `arr` 长度或内容；每批（如 5 集）若解析结果为空或无效，就为这 5 集全部填入占位，13 批后 61 集全部为占位。
4. **为何被判定为成功**：`generateDraft` 的成功条件只有「缺集数」：`finalCompletenessOk = missing.length === 0`。不检查 `storyText` 是否为占位、是否过短、是否为空；没有 `validateDraft` 或“正文质量门禁”；`persistDraft` 完全信任 draft，有 `episodeNumber` 和 `storyText` 就写库。
5. **标题“第N集”的来源**：`persistDraft` 中 `title: ep.title || \`第${ep.episodeNumber}集\``（第 181 行）。Writer 占位输出时 `title` 取自 `one.title ?? batch[i]?.title`，planner 若也解析失败则 title 为 undefined，persist 时遂用“第N集”。
6. **summary 为 NULL**：Writer 占位分支未设 summary（`one.summary ?? batch[i]?.summary` 为空），persist 传 `summary: ep.summary ?? null`，故库中为 NULL。
7. **word_count 8 或 9**：占位字符串“第N集故事正文。”长度为 8（N 为个位数）或 9（N 为两位数），与表中 word_count 一致，证明写入的确实是该占位串。
8. **根因归类**：属于**解析/模型输出与预期不符后，静默走兜底逻辑，且 persist 前无质量门禁**——既存在过宽的 fallback（任意无效项都填占位），又缺少“禁止写入占位或过短正文”的校验。
9. **与 narrator 对比**：narrator-script 在 LLM 输出非合法 JSON 时**直接抛 BadRequestException**，不补默认数据；episode-story 在 parse 成功后若结构不符仍**静默补占位并继续**，导致占位数据被当作正常 draft 写入。
10. **最可能触发场景**：Writer 接口返回 200，但 body 为 `[]`、`{}`、或 `{ "episodes": [] }`，或返回的数组中元素缺少 `storyText`/`story_text` 字段（或为 null）——例如模型返回了 markdown 包裹、错误 key 名、或仅说明性文字被 parse 成空结构。

---

## 2. 实际调用链

```
前端：
  用户点击「生成草稿」
  → StoryTextPanel.handleGenerateDraft
  → episodeStoryApi.generateDraft(novelId, payload)
  → POST /pipeline/:novelId/episode-story-generate-draft

后端：
  PipelineController.generateEpisodeStoryDraft(novelId, dto)
  → EpisodeStoryGenerationService.generateDraft(novelId, dto)
      → buildContextBlocks (getContext + buildNarratorPromptContext + buildReferenceSummary)
      → runPlanner(modelKey, novelId, targetCount, promptPreview)  // 单次 LLM，得到 plan[]
      → splitBatches(plan, batchSize)                               // 如 61 集拆成 13 批，每批 5 集
      → for each batch: runWriterBatch(...)                         // 每批一次 LLM，得到 5 条 draft 项
          → fetch(lc_api_url)                                       // Writer 请求
          → parseJsonFromText(raw) → arr
          → for i in 0..batch.length-1: one = arr[i] || {}
          → out.push({ episodeNumber, title, summary, storyText })    // ★ storyText 来自 one.storyText ?? one.story_text ?? `第${epNum}集故事正文。`
      → allEpisodes = 各批 batchDraft 合并
      → findMissingEpisodeNumbers → finalCompletenessOk = (missing.length === 0)
      → cacheDraft(draftId, draft)
      → return { draftId, draft, batchInfo, finalCompletenessOk, ... }

用户点击「确认写入数据库」
  → StoryTextPanel.handlePersistDraft
  → episodeStoryApi.persistDraft(novelId, { draftId } 或 { draft })
  → POST /pipeline/:novelId/episode-story-persist

  PipelineController.persistEpisodeStoryDraft
  → EpisodeStoryGenerationService.persistDraft(novelId, dto)
      → resolveDraftForPersist (从 cache 或 dto.draft 取 draft)
      → for each ep in draft.episodes:
          → EpisodeStoryVersionService.create(novelId, {
              episodeNumber, storyType: 'story_text',
              title: ep.title || `第${ep.episodeNumber}集`,
              summary: ep.summary ?? null,
              storyText: ep.storyText,        // ★ 直接写入，无质量校验
              generationSource: 'ai',
            })
```

---

## 3. 占位文本来源定位

### 3.1 直接生成占位文本的代码

**文件**：`apps/api/src/pipeline/episode-story-generation.service.ts`  
**方法**：`runWriterBatch`  
**行号**：约 363 行  

**关键代码**：

```typescript
for (let i = 0; i < batch.length; i++) {
  const one = (arr[i] || {}) as WriterItemLike;
  const epNum = (one.episodeNumber ?? one.episode_number ?? batch[i]?.episodeNumber ?? i + 1) as number;
  out.push({
    episodeNumber: epNum,
    title: one.title ?? batch[i]?.title,
    summary: one.summary ?? batch[i]?.summary,
    storyText: typeof one.storyText === 'string' ? one.storyText : (one.story_text ?? `第${epNum}集故事正文。`) as string,
  });
}
```

- **占位串**：`第${epNum}集故事正文。`（与库中 8/9 字一致）。
- **触发条件**：`typeof one.storyText !== 'string'` 且 `one.story_text` 为 null/undefined。即 LLM 解析结果中该项没有有效的 `storyText` 或 `story_text`。

### 3.2 为何会整批、全部批次都走占位

- `arr` 来源：`const arr = Array.isArray(withEpisodes) ? withEpisodes : withEpisodes?.episodes ?? []`。
- 若 Writer 返回体被解析为 `[]`、或 `{}`、或 `{ episodes: [] }`，则 `arr = []`。
- 循环是 `for (let i = 0; i < batch.length; i++)`，**始终按 batch 长度产出**，不依赖 `arr.length`。
- 当 `arr = []` 时，对任意 `i` 有 `arr[i] === undefined`，`one = {}`，`storyText` 与 `story_text` 均无效，故**该批每集都得到占位**。
- 13 批均如此时，61 集全部为占位。

### 3.3 其他相关 fallback（标题、summary）

- **标题“第N集”**：同一文件 `persistDraft` 第 181 行，`title: ep.title || \`第${ep.episodeNumber}集\``。Writer 占位分支未提供有效 title 时，persist 层再次 fallback。
- **summary 为 NULL**：Writer 占位时 `summary: one.summary ?? batch[i]?.summary`，planner 解析失败时也为空；persist 传 `summary: ep.summary ?? null`，故库中为 NULL。

---

## 4. 为什么系统误判成功

### 4.1 generateDraft 的成功判定

- **唯一结构性校验**：`findMissingEpisodeNumbers(allEpisodes.map(e => e.episodeNumber), targetCount)`；`finalCompletenessOk = missing.length === 0`。
- **不做的校验**：不检查 `storyText` 是否为空、是否为占位串、是否过短；没有“禁止占位/明显无效正文”的逻辑。
- 因此：61 集全部为占位时，集数齐全，`finalCompletenessOk === true`，接口仍返回成功。

### 4.2 是否存在 validateDraft

- **不存在**名为 `validateDraft` 的方法。
- 仅有 `findMissingEpisodeNumbers` 用于缺集检测，无正文质量或占位检测。

### 4.3 persistDraft 的门禁

- **逻辑**：`resolveDraftForPersist` 取到 draft 后，对 `draft.episodes` 逐条调用 `EpisodeStoryVersionService.create`，传入 `ep.storyText` 等，**无任何校验**。
- 不检查 `storyText` 长度、是否等于“第N集故事正文。”、是否为空；有字段即写库。

### 4.4 check 与 persist 的关系

- **check** 为独立端点，**不会在 persist 前自动执行**；前端可先生成草稿再直接点“确认写入数据库”，无需先点“AI 检查”。
- 因此“没有在 persist 前强制执行 check”是设计如此，但缺少的是** persist 前的内置质量门禁**（例如禁止占位或过短正文），而不是“必须调 check”。

### 4.5 前端是否在 finalCompletenessOk 时允许写入

- 是。前端仅校验 `storyDraft?.episodes?.length` 存在即可点“确认写入数据库”；不根据 `finalCompletenessOk` 或正文内容禁止写入。
- 见 `StoryTextPanel.tsx`：`onPersistDraft` 的 disabled 为 `!draft?.episodes?.length || persisting || generating`，与 `finalCompletenessOk` 无关（仅影响按钮文案是否提示“强制写入”）。

### 4.6 小结：谁放过了这批数据

| 环节           | 是否放过 | 说明 |
|----------------|----------|------|
| runWriterBatch | 是       | 解析结果空/无效时静默用占位补全，不抛错、不标记。 |
| generateDraft  | 是       | 只校验集数齐全，不校验正文质量或占位。 |
| persistDraft   | 是       | 完全信任 draft，无质量门禁。 |
| 前端           | 是       | 不强制先 check，不根据内容禁止写入。 |

**归类**：**解析/模型输出与预期不符后静默走兜底 + persist 前缺乏质量门禁**；既存在过宽 fallback，又缺少“禁止写入占位或过短正文”的校验。

---

## 5. Planner / Writer 输出格式与失配点

### 5.1 runPlanner 期待与解析

- **期待**：LLM 返回**严格 JSON 数组**，元素含 `episodeNumber`/`episode_number`、`title`/`episodeTitle`、`summary`、`storyBeat`。
- **解析**：`parseJsonFromText(raw)`；`arr = Array.isArray(planLike) ? planLike : planLike?.episodes ?? planLike?.plan ?? []`。
- **补齐**：若 `arr` 不足 targetCount 项，仍循环 `i < targetCount`，用 `arr[i]`（可能 undefined）生成 plan 项，缺失字段为 undefined。
- **失配风险**：模型返回 `[]` 或包装键名不同时，plan 变成 61 条“空规划”（仅 episodeNumber 有值），Writer 仍会按这批空规划请求 13 次；若 Writer 再返回空/无效，则 61 集全部占位。

### 5.2 runWriterBatch 期待与解析

- **期待**：每项含 `episodeNumber`/`episode_number`、`title`、`summary`、`storyText`/`story_text`（prompt 明确要求）。
- **解析**：`arr = Array.isArray(withEpisodes) ? withEpisodes : withEpisodes?.episodes ?? []`；按 `batch.length` 循环，`one = (arr[i] || {}) as WriterItemLike`。
- **失配点**：
  - 返回 `[]` 或 `{}` 或 `{ episodes: [] }` → 整批占位。
  - 返回数组但元素用 `content`/`text` 而非 `storyText`/`story_text` → 该项走占位。
  - 返回 markdown 代码块，parse 抽到的是空数组或错误结构 → 同上。
- **字段名**：代码已兼容 `story_text` 与 `storyText`，但若模型用其它 key（如 `content`），会视为缺失并占位。

### 5.3 parse 失败时的行为

- **parseJsonFromText** 在无法解析出合法 JSON 时会 **throw BadRequestException('AI 返回不是有效 JSON')**，不会静默返回。
- 因此**占位只会在 parse 成功但结构/内容不符合预期时发生**，例如 parse 出 `[]` 或元素缺字段。

---

## 6. 是否模型根本没产出有效内容——判断与依据

- **模型没返回 JSON**：若完全非 JSON，parse 会抛，用户会看到“生成草稿失败”，不会出现 61 条写入。当前现象是“写入了 61 条占位”，故 parse 一定成功过。
- **返回了但 parse 失败**：同上，会抛错，不会静默写库。
- **parse 成功但 merge 阶段丢字段**：merge 只是 `allEpisodes.push(...batchDraft)`，没有删字段；占位是在 runWriterBatch 里就写进 `out` 的，不是 merge 丢的。
- **生成结果被 fallback 覆盖**：是。当解析结果为空数组或元素无有效 `storyText`/`story_text` 时，**runWriterBatch 的 fallback 直接覆盖**为该批每集生成占位 storyText。
- **前端拿到的不是真实 draft**：前端拿到的就是后端返回的 draft（含占位）；后端 generateDraft 返回的 draft 里已经全是占位，不是前端替换的。

**最可能的 3 个原因（按概率）**：

1. **Writer LLM 每次返回体被解析为空数组或“无有效 storyText 的数组”**（例如返回 `[]`、`{}`、`{ "episodes": [] }`，或元素只有说明没有 storyText）→ runWriterBatch 每批都走占位，61 集全部占位。（概率最高）
2. **Planner 返回空或无效，Writer 收到的 batch 规划信息不足，模型只返回了说明性文字或空结构**，parse 得到空数组 → 同上。（概率中）
3. **模型返回的 key 与代码不一致**（如 `content`/`text` 而非 `storyText`/`story_text`），或返回嵌套结构未被正确取到数组 → 每项 `one.storyText`/`one.story_text` 为 undefined → 占位。（概率中）

---

## 7. 调试日志补丁方案（最小侵入）

### 7.1 日志目标（可验证的结论）

- 请求是否进入、novelId、targetCount、batchSize、referenceTables。
- Planner：prompt 长度、原始响应前 500 字、parse 是否成功、plan 条数。
- Writer：批次数、每批 prompt 长度、每批原始响应前 500 字、每批 parse 是否成功、本批条数、是否触发占位（如本批存在 storyText === `第N集故事正文。`）。
- Merge：总集数、缺失的 episodeNumber。
- Persist：写入前每集的 title、summary 是否为空、storyText.length；是否包含占位串；最终写入条数。

### 7.2 建议日志格式（与现有 Logger 风格一致）

- 统一前缀：`[episode-story]`，便于 grep。
- 示例：
  - `[episode-story][generateDraft] novelId=%s targetCount=%s batchSize=%s referenceTablesCount=%s`
  - `[episode-story][planner] promptChars=%s`
  - `[episode-story][planner][raw] %s`（前 500 字）
  - `[episode-story][planner][parse] ok=%s planCount=%s`
  - `[episode-story][writer][batch %s/%s] promptChars=%s`
  - `[episode-story][writer][batch %s][raw] %s`
  - `[episode-story][writer][batch %s][parse] ok=%s count=%s placeholderFilled=%s`
  - `[episode-story][merge] actualEpisodes=%s missing=%s`
  - `[episode-story][persist] episode=%s title=%s summaryLen=%s storyLen=%s isPlaceholder=%s`
  - `[episode-story][persist][summary] inserted=%s`

### 7.3 必须/建议加日志的方法与点

| 方法/位置 | 必加/建议 | 内容 |
|-----------|-----------|------|
| `generateDraft` 入口 | 必加 | novelId, targetCount, batchSize, referenceTables 数量。 |
| `runPlanner` 发请求前 | 必加 | prompt 字符数。 |
| `runPlanner` 拿到 raw 后 | 必加 | raw 前 500 字（或 truncate）。 |
| `runPlanner` parse 后 | 必加 | parse 是否成功、arr.length / plan.length。 |
| `runWriterBatch` 每批入口 | 必加 | batchIndex/totalBatches, prompt 字符数。 |
| `runWriterBatch` 每批拿到 raw 后 | 必加 | raw 前 500 字。 |
| `runWriterBatch` 每批 parse 后、循环前 | 必加 | arr.length，是否为空。 |
| `runWriterBatch` 循环内若使用占位 | 必加 | 本批中触发占位的 episodeNumber 或计数。 |
| `generateDraft` merge 后 | 必加 | allEpisodes.length, missing.length, missing 列表。 |
| `persistDraft` 循环内（每条 create 前） | 建议 | episodeNumber, title, summary?.length, storyText.length, 是否等于“第N集故事正文。”。 |
| `persistDraft` 结束 | 建议 | inserted count。 |
| 前端 `handleGenerateDraft` catch | 建议 | error.message（便于确认是否为 parse 报错）。 |

### 7.4 占位检测辅助

- 在 `runWriterBatch` 的 `out.push` 后，若 `storyText === \`第${epNum}集故事正文。\``，可打一条 debug：`[episode-story][writer][placeholder] batch=%s index=%s epNum=%s`。
- 在 `persistDraft` 中若 `ep.storyText === \`第${ep.episodeNumber}集故事正文。\``，可打：`[episode-story][persist][placeholder] episode=%s`。

---

## 8. 下一步修复建议（只建议，不改代码）

### P0 必修

1. **收紧 runWriterBatch 的 fallback**  
   - 当 `arr.length === 0` 或本批解析结果明显无效（例如多数项无 storyText）时，**不要静默补占位**；应 **throw BadRequestException**，明确提示“Writer 返回为空或无效，请检查模型与 prompt”。  
   - 或至少：仅当“个别项”缺 storyText 时允许用占位，且在该集上打标记（如 `_placeholder: true`），后续 persist 前可据此拒绝写入。

2. **Persist 前质量门禁**  
   - 在 `persistDraft` 内（或单独方法）校验：若存在任意一集 `storyText` 为“第N集故事正文。”或长度 &lt; 某阈值（如 50），则 **拒绝写入并抛 BadRequestException**，提示“检测到占位或过短正文，请重新生成草稿”。  
   - 可与现有 check 规则一致（如 missing_text、too_short），但不依赖用户是否点过“AI 检查”。

3. **Writer 解析结果校验**  
   - 在 `runWriterBatch` 中，若 `arr.length < batch.length` 或本批产出中占位比例超过一定比例（如 &gt;50%），直接 **throw**，避免整批占位被当作成功结果继续合并和缓存。

### P1 建议

4. **按 7.3 节加入调试日志**  
   - 至少覆盖 planner/writer 的请求与原始响应、parse 结果、占位触发、persist 前每集 storyText 长度与占位检测，便于下次快速定位是“模型空返回”还是“key 名/结构不符”。

5. **与 narrator 对齐：parse 失败即失败**  
   - 保持 parse 失败时抛错；不增加“parse 失败时用默认 61 条占位继续”的逻辑。

6. **可选：前端弱提示**  
   - 若 `finalCompletenessOk === true` 但存在大量 `storyText.length < 50` 或与占位串相同，可在前端提示“部分集数内容过短或为占位，建议先执行 AI 检查或重新生成”。

### P2 可后续

7. **Writer 返回结构兼容**  
   - 在解析 writer 输出时，兼容更多 key（如 `content`、`text`），再映射到 `storyText`，减少因 key 名不符导致的占位。

8. **Planner 空结果保护**  
   - 若 planner 解析后 `arr.length === 0`，不生成 61 条空 plan 再调 writer；直接抛错，提示“规划结果为空，请检查模型与上下文”。

---

*本报告为只读根因排查结论，未对代码做任何修改。*
