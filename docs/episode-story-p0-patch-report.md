# Episode Story P0 补丁实现报告

## 1. 修改文件清单

| 文件 | 说明 |
|------|------|
| **apps/api/src/pipeline/episode-story-generation.service.ts** | 唯一修改文件：P0-1 收紧 runWriterBatch、P0-2 persist 质量门禁、P0-3 最小日志 |

未修改：`episode-story-generation.dto.ts`、`episode-story-version.service/controller`、sql、前端、narrator / episode-script 等。

---

## 2. 每个文件改了什么

### episode-story-generation.service.ts

**常量与类型**

- 新增 `MIN_STORY_TEXT_LENGTH = 50`、`PLACEHOLDER_STORY_TEXT_TEMPLATE(epNum)`（仅用于校验与日志，不再作 fallback）。
- `WriterItemLike` 增加可选字段：`content?`、`text?`、`body?`，用于从 LLM 返回中兼容更多正文 key。

**P0-1：runWriterBatch**

- 增加可选参数 `batchIndex?: number`、`totalBatches?: number`，用于日志。
- Parse 后若 `arr.length === 0`，直接 `throw new BadRequestException('Episode story writer returned empty result.')`。
- 若 `arr.length < batch.length`，直接 `throw new BadRequestException('Episode story writer returned fewer items than requested batch.')`。
- 正文取值改为通过新方法 `normalizeWriterStoryText(one)`：按顺序取 `storyText`、`story_text`、`content`、`text`、`body` 中第一个非空字符串。
- 逐项校验：`normalizedStoryText` 为 string、`trim().length >= 50`、`trim()` 不等于 `第${epNum}集故事正文。`；不满足则计为无效，**不再**写入占位到 `out`，仅当有效项才 push。
- 若 `invalidStoryTextCount > 0`，`throw new BadRequestException('Episode story writer returned invalid storyText for some episodes.')`。
- 移除原 fallback `` `第${epNum}集故事正文。` ``。

**P0-2：persistDraft 质量门禁**

- 新增私有方法 `assertDraftQualityBeforePersist(draft: EpisodeStoryDraft): void`：
  - 遍历 `draft.episodes`，要求：`episodeNumber` 有效数字；`storyText` 为 string；`storyText.trim().length >= 50`；`storyText.trim()` 不等于 `第${episodeNumber}集故事正文。`。
  - 任一条不满足即 `throw new BadRequestException('Episode story draft contains placeholder or too-short storyText. Persist blocked.')`，不部分写入。
- 在 `persistDraft` 中，在调用 `EpisodeStoryVersionService.create` 之前执行 `assertDraftQualityBeforePersist(draft)`。

**P0-3：最小必需日志**

- 所有日志前缀统一为 `[episode-story]`，使用 `this.logger.log`（正常）或 `this.logger.warn`（抛错前）。
- 新增日志点见下节；raw 类内容均截断到约 500 字（`slice(0, 500)`）。

---

## 3. runWriterBatch 现在在什么情况下会抛错

| 条件 | 错误信息 |
|------|----------|
| `arr.length === 0` | `Episode story writer returned empty result.` |
| `arr.length < batch.length` | `Episode story writer returned fewer items than requested batch.` |
| 本批存在至少一项“无效 storyText” | `Episode story writer returned invalid storyText for some episodes.` |

“无效 storyText”定义：`normalizeWriterStoryText(one)` 为空，或 trim 后长度 &lt; 50，或 trim 后等于 `第${epNum}集故事正文。`。

---

## 4. persistDraft 现在拦截哪些垃圾数据

在真正写库前，`assertDraftQualityBeforePersist` 会对每一集校验：

- `episodeNumber` 为有效数字（非 null/undefined/NaN）。
- `storyText` 为 string。
- `storyText.trim().length >= 50`。
- `storyText.trim()` 不等于 `第${episodeNumber}集故事正文。`。

任一集不满足 2/3/4 即整次 persist 失败，抛出：  
`Episode story draft contains placeholder or too-short storyText. Persist blocked.`  
不会部分写入。

---

## 5. 新增了哪些日志点

| # | 位置 | 示例格式 |
|---|------|----------|
| 1 | generateDraft 入口 | `[episode-story][generateDraft] novelId=... targetCount=... batchSize=... refTablesCount=...` |
| 2 | runPlanner 发请求前 | `[episode-story][planner] promptChars=...` |
| 3 | runPlanner 收到 raw 后 | `[episode-story][planner][raw] preview=...`（前 500 字） |
| 4 | runPlanner parse 后 | `[episode-story][planner][parse] arrLen=... normalizedPlanLen=...` |
| 5 | splitBatches 后 | `[episode-story][splitBatches] batchCount=...` |
| 6 | runWriterBatch 每批发请求前 | `[episode-story][writer][batch i/total] promptChars=... requestedEpisodes=...` |
| 7 | runWriterBatch 收到 raw 后 | `[episode-story][writer][batch i/total][raw] preview=...`（前 500 字） |
| 8 | runWriterBatch parse 后 | `[episode-story][writer][batch i/total][parse] arrLen=...` |
| 9 | runWriterBatch 校验后 | `[episode-story][writer][batch i/total][validate] requested=... parsed=... invalidStoryTextCount=...` |
| 10 | merge 后 | `[episode-story][merge] actualEpisodes=... missing=...` |
| 11 | persistDraft 入口 | `[episode-story][persist] novelId=... usingDraftId=... episodeCount=...` |
| 12 | persist 写库前逐集 | `[episode-story][persist][episode] ep=... title=... storyLen=... isPlaceholder=...` |
| 13 | persist 总结 | `[episode-story][persist][summary] inserted=...` |

抛错前另有 `this.logger.warn`（writer 空/少/无效、persist 门禁失败）。

---

## 6. 是否通过构建/类型检查

- **npx nx run api:build**：通过（exit code 0）。
- 当前无新增 linter 报错。

---

## 7. 人工联调 Checklist

- [ ] **Writer 返回空时 generateDraft 失败**  
  - 模拟或等待 Writer LLM 返回 `[]`/`{}`/`{ "episodes": [] }`，或返回项无有效 storyText（如全为占位或 &lt;50 字）。  
  - 预期：`generateDraft` 返回 4xx，错误信息含 `Episode story writer returned empty result.` 或 `... fewer items ...` 或 `... invalid storyText ...`。  
  - 日志中可见 `[episode-story][writer][batch ...][parse] arrLen=0` 或 `[validate] invalidStoryTextCount>0` 及随后的 warn。

- [ ] **占位 storyText 无法 persist**  
  - 通过其它方式得到一份 draft（如旧缓存或手动构造），其中至少一集 `storyText` 为 `第N集故事正文。` 或长度 &lt; 50。  
  - 调用 persist（draftId 或 draft body）。  
  - 预期：persist 返回 4xx，错误信息含 `Episode story draft contains placeholder or too-short storyText. Persist blocked.`。  
  - 日志中可见 `[episode-story][persist][episode] ... isPlaceholder=true` 或 storyLen&lt;50，以及 assert 时的 warn。

- [ ] **正常 storyText 可以 persist**  
  - 正常走一遍生成流程，确保 Writer 返回有效正文（每项 &gt;= 50 字且非占位）。  
  - 预期：generateDraft 成功，persist 成功，库中 `episode_story_versions` 对应行的 `story_text` 为真实内容、非占位，`word_count` 合理。

- [ ] **日志可用来排查 planner/writer/persist**  
  - 一次完整“生成 + 写入”后查看日志：  
    - 能见到 `[episode-story][planner]`、`[planner][raw]`、`[planner][parse]`；  
    - 能见到每批 `[writer][batch ...]`、`[raw]`、`[parse]`、`[validate]`；  
    - 能见到 `[merge]`、`[persist]`、`[persist][episode]`、`[persist][summary]`。  
  - raw preview 为前 500 字，无整段超长内容。

---

*P0 补丁完成，仅修改 episode-story-generation.service.ts，未改表结构、前端与其它模块。*
