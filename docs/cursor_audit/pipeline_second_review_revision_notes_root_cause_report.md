# Pipeline Second Review Revision Notes 根因报告

## 审计范围
- 目标：查清两件事
  - 为什么当前 `revision_notes_json` 里只剩 fallback 模板说明
  - 为什么当前实现无法满足“每次 review 继续累计追加历史记录”
- 方式：只读审计
  - 不改代码
  - 不写数据库
  - 不执行 `INSERT / UPDATE / DELETE / ALTER`

## Step 0：基线

### `git status --short`

```text
?? docs/cursor_audit/pipeline_second_review_effect_audit_report.md
```

### `git diff --stat`

```text
(empty output)
```

说明：
- 本次只读审计开始时，工作区可见的未跟踪变更是上一份审计报告 `docs/cursor_audit/pipeline_second_review_effect_audit_report.md`
- 没有读到新的业务代码 diff

## Step 1：二次 review 的 notes 处理链路

## 1.1 `reviewAndCorrect()` 主流程
文件：`apps/api/src/pipeline/pipeline-review.service.ts`

```ts
async reviewAndCorrect(
  novelId: number,
  dto: PipelineSecondReviewDto,
): Promise<PipelineSecondReviewResponse> {
  await this.assertNovelExists(novelId);
  const targetTables = this.resolveTargetTables(dto.targetTables);
  const referenceTables = this.resolveReferenceTables(dto.referenceTables);
  const usedModelKey = await this.resolveOptionalModelKey(dto.modelKey);
  const promptPreview =
    dto.allowPromptEdit && dto.promptOverride?.trim()
      ? dto.promptOverride.trim()
      : await this.buildReviewPrompt(
          novelId,
          targetTables,
          referenceTables,
          dto.userInstruction,
        );

  this.logReviewStage('request start', {
    novelId,
    modelKey: usedModelKey,
    targetTables,
    referenceTables,
    promptLength: promptPreview.length,
  });

  const aiJson = await this.callLcAiApi(usedModelKey, promptPreview);
  const topicMap = await this.getEnabledSkeletonTopicMap(novelId);
  const { normalized, warnings } = this.validateAndNormalizeReviewResult(
    aiJson,
    topicMap,
    targetTables,
  );

  const reviewBatchId = randomUUID();
  const reviewedAt = new Date().toISOString();
  const revisionNotesByTable = this.buildRevisionNotesByTable(
    targetTables,
    normalized.reviewNotes,
    usedModelKey,
    reviewBatchId,
    reviewedAt,
  );

  const summary = await this.persistReviewedData(
    novelId,
    targetTables,
    normalized,
    topicMap,
    revisionNotesByTable,
    warnings,
  );

  return {
    ok: true,
    summary,
    reviewNotes: normalized.reviewNotes,
    warnings: warnings.length ? warnings : undefined,
  };
}
```

直接结论：
- AI 原始返回先进入 `validateAndNormalizeReviewResult(...)`
- `reviewNotes` 先被标准化，再喂给 `buildRevisionNotesByTable(...)`
- 最终写库时不是临时生成 notes，而是把 `revisionNotesByTable` 传入各个 insert 函数

## 1.2 `validateAndNormalizeReviewResult(...)`
文件：`apps/api/src/pipeline/pipeline-review.service.ts`

```ts
const reviewNotes = this.normalizeReviewNotes(
  Array.isArray(aiJson.reviewNotes) ? (aiJson.reviewNotes as unknown[]) : [],
  targetTables,
  warnings,
);

return {
  normalized: {
    timelines,
    characters,
    keyNodes,
    skeletonTopicItems,
    explosions,
    reviewNotes,
  },
  warnings,
};
```

直接结论：
- AI 原始 `reviewNotes` 就是在这里进入 normalize 流程
- 如果这里被过滤掉，后面就只剩 fallback 可用

## 1.3 `normalizeReviewNotes(...)`
文件：`apps/api/src/pipeline/pipeline-review.service.ts`

```ts
private normalizeReviewNotes(
  items: unknown[],
  targetTables: PipelineSecondReviewTargetTable[],
  warnings: string[],
): ReviewNoteInput[] {
  const allowed = new Set<string>(targetTables);
  const result: ReviewNoteInput[] = [];

  for (const raw of items) {
    const item = this.asRecord(raw);
    const table = this.normalizeText(item.table);
    const issue = this.normalizeText(item.issue);
    const fix = this.normalizeText(item.fix);

    if (!table || !issue || !fix) {
      warnings.push('Dropped reviewNote because table/issue/fix is empty');
      continue;
    }

    if (!allowed.has(table)) {
      warnings.push(`Dropped reviewNote because table is not selected: ${table}`);
      continue;
    }

    result.push({ table, issue, fix });
  }

  return result;
}
```

直接结论：
- `reviewNotes` 被过滤掉的直接位置就是这里
- 过滤条件非常简单：
  - `table / issue / fix` 任一为空，丢弃
  - `table` 不在 `targetTables` 集合里，丢弃

## 1.4 `buildRevisionNotesByTable(...)`
文件：`apps/api/src/pipeline/pipeline-review.service.ts`

```ts
private buildRevisionNotesByTable(
  targetTables: PipelineSecondReviewTargetTable[],
  reviewNotes: ReviewNoteInput[],
  reviewModel: string,
  reviewBatchId: string,
  reviewedAt: string,
): Map<PipelineSecondReviewTargetTable, RevisionNoteEntry[]> {
  const result = new Map<PipelineSecondReviewTargetTable, RevisionNoteEntry[]>();

  for (const tableName of targetTables) {
    const tableNotes = reviewNotes
      .filter((note) => note.table === tableName)
      .map((note) => ({
        reviewedAt,
        reviewModel,
        reviewBatchId,
        targetTable: tableName,
        action: 'updated',
        reason: note.issue,
        beforeSummary: note.issue,
        afterSummary: note.fix,
      }));

    result.set(
      tableName,
      tableNotes.length
        ? tableNotes
        : [
            {
              reviewedAt,
              reviewModel,
              reviewBatchId,
              targetTable: tableName,
              action: 'reviewed',
              reason: 'AI second review executed',
              beforeSummary: 'Existing generated result reviewed',
              afterSummary: 'Result rewritten during the current review batch',
            },
          ],
    );
  }

  return result;
}
```

直接结论：
- fallback notes 就是在这里生成的
- 触发条件非常明确：
  - 某张目标表在 `reviewNotes.filter(note => note.table === tableName)` 后结果为空
- 一旦为空，就强制写入统一模板：
  - `action = reviewed`
  - `reason = AI second review executed`
  - `beforeSummary = Existing generated result reviewed`
  - `afterSummary = Result rewritten during the current review batch`

## 1.5 各 insert 函数中的 `revision_notes_json`
文件：`apps/api/src/pipeline/pipeline-review.service.ts`

### timelines

```ts
INSERT INTO novel_timelines (novel_id, time_node, event, sort_order, revision_notes_json)
VALUES (?, ?, ?, ?, ?)
```

### characters

```ts
INSERT INTO novel_characters (
  novel_id,
  name,
  faction,
  description,
  personality,
  setting_words,
  sort_order,
  revision_notes_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
```

### keyNodes

```ts
INSERT INTO novel_key_nodes (
  novel_id,
  timeline_id,
  category,
  title,
  description,
  sort_order,
  revision_notes_json
) VALUES (?, ?, ?, ?, ?, ?, ?)
```

### skeletonTopicItems

```ts
INSERT INTO novel_skeleton_topic_items (
  novel_id,
  topic_id,
  item_title,
  content,
  content_json,
  sort_order,
  source_ref,
  revision_notes_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
```

### explosions

```ts
INSERT INTO novel_explosions (
  novel_id,
  timeline_id,
  explosion_type,
  title,
  subtitle,
  scene_restoration,
  dramatic_quality,
  adaptability,
  sort_order,
  revision_notes_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```

直接结论：
- 5 张表都是在 `INSERT` 时同步落 `revision_notes_json`
- 没有后置补写步骤

## Step 2：AI reviewNotes 的“原始命名空间”

## 2.1 review prompt 中对主数据数组的命名
文件：`apps/api/src/pipeline/pipeline-review.service.ts`

```ts
'2. 顶层必须包含：timelines、characters、keyNodes、skeletonTopicItems、explosions、reviewNotes。',
'4. reviewNotes 元素格式：{ "table": "字符串", "issue": "字符串", "fix": "字符串" }',
```

以及 schema：

```ts
'  "timelines": [',
'  "characters": [',
'  "keyNodes": [',
'  "skeletonTopicItems": [',
'  "explosions": [',
'  "reviewNotes": [',
'    { "table": "字符串", "issue": "字符串", "fix": "字符串" }',
```

## 2.2 后端允许接收的 targetTables 命名空间
来自 DTO 和 `targetTables` 实际用法，后端使用的是数据库表名空间：
- `novel_timelines`
- `novel_characters`
- `novel_key_nodes`
- `novel_skeleton_topic_items`
- `novel_explosions`

## 2.3 两个集合是否一致
不一致。

AI 更容易推断出的 `reviewNotes.table` 值是：
- `timelines`
- `characters`
- `keyNodes`
- `skeletonTopicItems`
- `explosions`

后端允许值是：
- `novel_timelines`
- `novel_characters`
- `novel_key_nodes`
- `novel_skeleton_topic_items`
- `novel_explosions`

因此会被丢弃的典型值包括：
- `timelines`
- `characters`
- `keyNodes`
- `explosions`
- 大概率也包括 `skeletonTopicItems`

### 证据链
- prompt/schema 从未明确要求 `reviewNotes.table` 使用 `novel_xxx` 命名
- 之前效果审计已经抓到 warning：

```text
Dropped reviewNote because table is not selected: timelines
Dropped reviewNote because table is not selected: characters
Dropped reviewNote because table is not selected: keyNodes
Dropped reviewNote because table is not selected: explosions
```

直接结论：
- AI 原始 `reviewNotes` 被后端过滤掉，直接根因就是**命名空间不一致**

## Step 3：数据库核查当前 notes 是 fallback 还是真实 AI notes

### 抽样查询结论
对以下 5 张表各抽样至少 3 行：
- `novel_timelines`
- `novel_characters`
- `novel_key_nodes`
- `novel_skeleton_topic_items`
- `novel_explosions`

当前样例全部呈现同一结构：

```json
[
  {
    "reviewedAt": "...",
    "reviewModel": "claude-3-7-sonnet-20250219",
    "reviewBatchId": "92560b13-ef03-4f97-bdf5-ab5587b2768e",
    "targetTable": "...",
    "action": "reviewed",
    "reason": "AI second review executed",
    "beforeSummary": "Existing generated result reviewed",
    "afterSummary": "Result rewritten during the current review batch"
  }
]
```

### 进一步只读统计
对 5 张表分别执行：
- `COUNT(*)`
- `SUM(JSON_EXTRACT(revision_notes_json, '$[0].reason') = 'AI second review executed')`

结果：

| 表 | 总行数 | 首条 reason 命中 `AI second review executed` 行数 |
|---|---:|---:|
| `novel_timelines` | 11 | 11 |
| `novel_characters` | 8 | 8 |
| `novel_key_nodes` | 5 | 5 |
| `novel_skeleton_topic_items` | 9 | 9 |
| `novel_explosions` | 4 | 4 |

直接结论：
- 当前 5 张表的 `revision_notes_json` **全部命中了 fallback reason**
- 本次抽样与统计都没有发现任何一条真正带有“补了什么 / 修了什么 / 删了什么”的 notes

因此可以明确判断：
- 当前数据库里的 notes **全部来自 fallback**
- 不是来自 AI 原始 `reviewNotes`

## Step 4：为什么没有“历史累计追加”

## 4.1 写库策略是否是 delete + recreate
文件：`apps/api/src/pipeline/pipeline-review.service.ts`

```ts
const summary = await this.dataSource.transaction(async (manager) => {
  await this.deleteSelectedData(novelId, targetTables, manager);
  // ... 后续重新 insert 各表
});
```

删除逻辑：

```ts
private async deleteSelectedData(
  novelId: number,
  targetTables: PipelineSecondReviewTargetTable[],
  manager: EntityManager,
): Promise<void> {
  if (targetTables.includes('novel_key_nodes')) {
    await manager.query(`DELETE FROM novel_key_nodes WHERE novel_id = ?`, [novelId]);
  }
  if (targetTables.includes('novel_explosions')) {
    await manager.query(`DELETE FROM novel_explosions WHERE novel_id = ?`, [novelId]);
  }
  if (targetTables.includes('novel_skeleton_topic_items')) {
    await manager.query(`DELETE FROM novel_skeleton_topic_items WHERE novel_id = ?`, [novelId]);
  }
  if (targetTables.includes('novel_characters')) {
    await manager.query(`DELETE FROM novel_characters WHERE novel_id = ?`, [novelId]);
  }
  if (targetTables.includes('novel_timelines')) {
    await manager.query(`DELETE FROM novel_timelines WHERE novel_id = ?`, [novelId]);
  }
}
```

结论：
- 当前实现就是标准的 delete + recreate

## 4.2 删除前是否读取旧 `revision_notes_json`
在 `pipeline-review.service.ts` 中全文检索：
- 没有任何 `SELECT ... revision_notes_json`
- 没有任何 `JSON.parse(existing revision_notes_json)`
- 没有任何 `oldNotes / existingNotes / merge`

只出现了 5 处 `revision_notes_json`，全部都是 INSERT 字段。

直接结论：
- 删除旧数据前，没有任何代码读取旧 `revision_notes_json`

## 4.3 新插入时是否 merge 旧 notes + 新 notes
没有。

证据：
- insert 函数入参只有本次批次生成的 `revisionNotes`
- 每次写入都是：

```ts
revisionNotes?.length ? JSON.stringify(revisionNotes) : null
```

没有任何：
- 读取旧 notes
- 与本次 notes 拼接
- 去重
- merge

直接结论：
- 当前实现天然只能保存“当前这一轮 notes”
- 在 delete + recreate 模式下，旧 notes 会随着旧行被删而必然丢失

## Step 5：如果要实现“继续累计追加历史”，5 张表最合理的匹配键建议

这里只做设计审计，不改代码。

### 1. `novel_timelines`
- 推荐匹配键：`time_node + event`
- 原因：
  - 表结构里没有更稳定的业务唯一键
  - `sort_order` 每次重排可能变化，不适合作为主键
- 风险：
  - 文案微调后可能匹配不到旧行
  - 若 time_node 相同但 event 改写幅度大，会丢历史

### 2. `novel_characters`
- 推荐匹配键：`name`
- 原因：
  - 人物名是当前最稳定的业务标识
  - 也是代码里最明显的核心字段
- 风险：
  - 别名、同一人物多写法会导致串联失败
  - 当前主角就已有 `沈昭/沈照` 命名不统一问题

### 3. `novel_key_nodes`
- 推荐匹配键：`category + title`
- 原因：
  - 单独 `title` 可能重复
  - `category + title` 更接近结构节点身份
- 风险：
  - category 若被 AI 改名，会丢失历史匹配
  - 标题大改后也可能匹配失败

### 4. `novel_skeleton_topic_items`
- 推荐匹配键：`topic_id + item_title`
- 备选增强键：`topic_id + item_title + content` 的宽松匹配
- 原因：
  - 必须先锚定所属 topic
  - 同一 topic 下的 itemTitle 是最像业务键的字段
- 风险：
  - itemTitle 为空时无法稳定匹配
  - content 变化大时也会难以串历史

### 5. `novel_explosions`
- 推荐匹配键：`explosion_type + title`
- 原因：
  - 当前爆点最稳定的身份通常是类型 + 标题
- 风险：
  - 若标题为了“更短剧化”被彻底改写，会造成匹配断裂

## Step 6：最终结论

### 1. 当前 `revision_notes_json` 为什么只剩 fallback 模板说明？
因为 AI 原始 `reviewNotes` 在 `normalizeReviewNotes()` 阶段被过滤掉了，导致 `buildRevisionNotesByTable()` 对每张表都走了 fallback 分支。

### 2. AI 原始 `reviewNotes` 是否被后端过滤掉了？直接根因是什么？
是。

直接根因是：
- AI 更可能返回短名称空间：`timelines / characters / keyNodes / explosions / skeletonTopicItems`
- 后端只接受数据库表名称空间：`novel_timelines / novel_characters / novel_key_nodes / novel_skeleton_topic_items / novel_explosions`
- 两者不一致，导致 `!allowed.has(table)` 成立，review notes 被丢弃

### 3. 当前实现为什么无法做到“第一次修改有记录，第二次继续追加”？
因为当前写库策略是 delete + recreate，而删除前既不读取旧 `revision_notes_json`，插入时也不做旧 notes 与新 notes 的 merge。

### 4. 这是不是 bug？
是，而且是两类问题叠加：
- 命名不一致导致的 **bug**
- delete + recreate 与“累计历史”需求冲突导致的 **设计问题**

### 5. 这是“命名不一致 bug”还是“落库策略设计问题”还是“两者都有”？
**两者都有。**

### 6. 下一步如果修，最小改动应该先修哪一层？
最小顺序建议：
- **先修 A：reviewNotes 命名映射**
  - 先让 AI 原始 notes 不再被丢弃
- 然后必须补：
  - **B：delete 前读取旧 notes**
  - **C：merge 旧 notes + 新 notes**

因此最终答案是：
- **D：全部都要**

但实施顺序上，应该先修命名映射，再补旧 notes 读取与 merge。
