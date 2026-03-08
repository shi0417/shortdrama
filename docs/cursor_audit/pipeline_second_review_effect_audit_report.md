# Pipeline 二次AI自检效果审计报告

## 审计范围
- 审计目标：核查本次 `POST /pipeline/:novelId/review-and-correct` 是否真的写回数据库、`revision_notes_json` 是否真实落库且有意义、以及是否存在可证据支持的质量改进。
- 严格模式：只读审计，不修改业务代码，不写数据库，不执行 migration。
- 审计对象：`novel_timelines`、`novel_characters`、`novel_key_nodes`、`novel_skeleton_topic_items`、`novel_explosions`。

## Step 0：基线信息

### 当前命令输出
- `git status --short`

```text
(empty output)
```

- `git diff --stat`

```text
(empty output)
```

- `node -v`

```text
v22.17.0
```

- `pnpm -v`

```text
10.28.2
```

### 说明
- 本次审计阶段没有新增业务代码改动。
- 当前 shell 中 `git status --short` 与 `git diff --stat` 都返回空输出，因此本报告按“只读审计，未产生新代码改动”记录。

## Step 1：review 写库链路核查

### 1.1 Controller 入口
`apps/api/src/pipeline/pipeline.controller.ts`

```ts
@Post(':novelId/review-and-correct')
reviewAndCorrect(
  @Param('novelId', ParseIntPipe) novelId: number,
  @Body() dto: PipelineSecondReviewDto,
) {
  return this.pipelineReviewService.reviewAndCorrect(novelId, dto);
}
```

结论：
- 本次前端点击“二次AI自检”后，后端明确进入 `PipelineReviewService.reviewAndCorrect()`。

### 1.2 review 主入口函数
`apps/api/src/pipeline/pipeline-review.service.ts`

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

结论：
- 这不是“只返回前端预览”的伪执行，而是明确在主流程中进入了 `persistReviewedData()`。
- `reviewBatchId`、`reviewedAt` 和 `revisionNotesByTable` 都是在本次请求里生成，并用于后续写库。

### 1.3 真正事务写库的位置
`apps/api/src/pipeline/pipeline-review.service.ts`

```ts
private async persistReviewedData(
  novelId: number,
  targetTables: PipelineSecondReviewTargetTable[],
  result: PipelineReviewAiResult,
  topicMap: Map<string, { id: number; topicKey: string }>,
  revisionNotesByTable: Map<PipelineSecondReviewTargetTable, RevisionNoteEntry[]>,
  warnings: string[],
): Promise<PipelineSecondReviewResponse['summary']> {
  this.logReviewStage('transaction start', { novelId, targetTables });

  try {
    const summary = await this.dataSource.transaction(async (manager) => {
      await this.deleteSelectedData(novelId, targetTables, manager);

      const shouldWriteTimelines = targetTables.includes('novel_timelines');
      const shouldWriteCharacters = targetTables.includes('novel_characters');
      const shouldWriteKeyNodes = targetTables.includes('novel_key_nodes');
      const shouldWriteSkeletonTopicItems = targetTables.includes(
        'novel_skeleton_topic_items',
      );
      const shouldWriteExplosions = targetTables.includes('novel_explosions');

      const insertedTimelines = shouldWriteTimelines
        ? await this.insertTimelines(
            novelId,
            result.timelines,
            manager,
            revisionNotesByTable.get('novel_timelines') ?? null,
          )
        : await this.loadExistingTimelines(novelId, manager);
      const timelineLookup = this.buildTimelineLookup(insertedTimelines);

      const insertedCharacters = shouldWriteCharacters
        ? await this.insertCharacters(
            novelId,
            result.characters,
            manager,
            revisionNotesByTable.get('novel_characters') ?? null,
          )
        : 0;

      const insertedKeyNodes = shouldWriteKeyNodes
        ? await this.insertKeyNodes(
            novelId,
            result.keyNodes,
            timelineLookup,
            manager,
            revisionNotesByTable.get('novel_key_nodes') ?? null,
          )
        : 0;

      const insertedSkeletonTopicItems = shouldWriteSkeletonTopicItems
        ? await this.insertSkeletonTopicItems(
            novelId,
            result.skeletonTopicItems,
            topicMap,
            manager,
            warnings,
            revisionNotesByTable.get('novel_skeleton_topic_items') ?? null,
          )
        : 0;

      const insertedExplosions = shouldWriteExplosions
        ? await this.insertExplosions(
            novelId,
            result.explosions,
            timelineLookup,
            manager,
            warnings,
            revisionNotesByTable.get('novel_explosions') ?? null,
          )
        : 0;

      return {
        timelines: shouldWriteTimelines ? result.timelines.length : 0,
        characters: insertedCharacters,
        keyNodes: insertedKeyNodes,
        skeletonTopicItems: insertedSkeletonTopicItems,
        explosions: insertedExplosions,
      };
    });

    this.logReviewStage('transaction commit', { novelId, summary });
    return summary;
  } catch (error) {
    this.logReviewStage(
      'transaction rollback',
      { novelId, errorMessage: this.getErrorMessage(error) },
      'error',
    );
    throw error;
  }
}
```

结论：
- 写库是单事务，不是分散写入。
- 目标表是条件覆盖写回，但本次日志里 5 张表都在 targetTables 中，因此是 5 张表一起删旧重建。

### 1.4 `revision_notes_json` 写入位置
`apps/api/src/pipeline/pipeline-review.service.ts`

```ts
INSERT INTO novel_timelines (novel_id, time_node, event, sort_order, revision_notes_json)
VALUES (?, ?, ?, ?, ?)
```

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

结论：
- `revision_notes_json` 不是后续补写，而是在每条 INSERT 时同步写入。

### 1.5 前端成功后刷新页面数据的位置
`apps/web/src/components/PipelinePanel.tsx`

```ts
const handleSubmitSecondReview = async () => {
  // ...
  const result = await pipelineReviewApi.runPipelineSecondReview(novelId, {
    modelKey: secondReviewSelectedModelKey,
    targetTables: secondReviewTargetTables,
    referenceTables: secondReviewReferenceTables,
    userInstruction: secondReviewUserInstruction || undefined,
    allowPromptEdit: secondReviewAllowPromptEdit,
    promptOverride:
      secondReviewAllowPromptEdit && secondReviewPromptPreview.trim()
        ? secondReviewPromptPreview
        : undefined,
  })

  await loadOverview()
  setExtractRefreshKey((prev) => prev + 1)
  setSecondReviewDialogOpen(false)
  // ...
}
```

结论：
- 前端在 review 成功后会主动重新拉 `overview`，所以 UI 理论上会展示数据库最新结果。

## Step 2：数据库证据核查

## 2.1 表结构核查

### `novel_timelines`
`SHOW CREATE TABLE` 关键片段：

```sql
`revision_notes_json` longtext COLLATE utf8mb4_unicode_ci COMMENT 'AI review notes JSON'
```

### `novel_characters`

```sql
`revision_notes_json` longtext COLLATE utf8mb4_unicode_ci COMMENT 'AI review notes JSON'
```

### `novel_key_nodes`

```sql
`revision_notes_json` longtext COLLATE utf8mb4_unicode_ci COMMENT 'AI review notes JSON'
```

### `novel_skeleton_topic_items`

```sql
`revision_notes_json` longtext COLLATE utf8mb4_unicode_ci COMMENT 'AI review notes JSON'
```

### `novel_explosions`

```sql
`revision_notes_json` longtext COLLATE utf8mb4_unicode_ci COMMENT 'AI review notes JSON'
```

结构判断：
- 5 张表都真实存在 `revision_notes_json`
- 类型均为 `LONGTEXT`
- 默认允许 `NULL`

## 2.2 当前数据量与时间戳核查

对 `novel_id = 1` 的只读统计结果：

| 表 | 当前行数 | MIN(created_at) | MAX(created_at) | 与日志 summary 对比 |
|---|---:|---|---|---|
| `novel_timelines` | 11 | `2026-03-08 14:40:42` | `2026-03-08 14:40:42` | 一致 |
| `novel_characters` | 8 | `2026-03-08 14:40:42` | `2026-03-08 14:40:42` | 一致 |
| `novel_key_nodes` | 5 | `2026-03-08 14:40:42` | `2026-03-08 14:40:42` | 一致 |
| `novel_skeleton_topic_items` | 9 | `2026-03-08 14:40:42` | `2026-03-08 14:40:42` | 一致 |
| `novel_explosions` | 4 | `2026-03-08 14:40:42` | `2026-03-08 14:40:42` | 一致 |

与本次日志对照：

```text
[pipeline:review] transaction commit {"novelId":1,"summary":{"timelines":11,"characters":8,"keyNodes":5,"skeletonTopicItems":9,"explosions":4}}
```

判断：
- 当前数据库数量与日志 summary **完全对得上**。
- 5 张表的 `created_at` 都集中在同一秒，强烈说明这次不是“逻辑成功但未实际落库”，而是一次**完整的删旧重建式写回**。

## 2.3 `revision_notes_json` 落库真实性核查

### JSON 有效性统计

| 表 | 总行数 | 非空 notes 行数 | `JSON_VALID(revision_notes_json)=1` 行数 |
|---|---:|---:|---:|
| `novel_timelines` | 11 | 11 | 11 |
| `novel_characters` | 8 | 8 | 8 |
| `novel_key_nodes` | 5 | 5 | 5 |
| `novel_skeleton_topic_items` | 9 | 9 | 9 |
| `novel_explosions` | 4 | 4 | 4 |

判断：
- `revision_notes_json` 不只是字段存在，而是 5 张表全部真实写入且全部是合法 JSON。

### 抽样内容
抽样 5 张表前 3 行后发现，结构全部类似：

```json
[
  {
    "reviewedAt": "2026-03-08T06:40:42.093Z",
    "reviewModel": "claude-3-7-sonnet-20250219",
    "reviewBatchId": "92560b13-ef03-4f97-bdf5-ab5587b2768e",
    "targetTable": "novel_timelines",
    "action": "reviewed",
    "reason": "AI second review executed",
    "beforeSummary": "Existing generated result reviewed",
    "afterSummary": "Result rewritten during the current review batch"
  }
]
```

包含字段核查：
- `reviewedAt`：有
- `reviewModel`：有
- `reviewBatchId`：有
- `targetTable`：有
- `action`：有
- `reason`：有
- `beforeSummary`：有
- `afterSummary`：有

但内容质量判断：
- 这些 notes **不是逐行差异说明**。
- 5 张表抽样出来的 notes 基本都是同一条“通用批次说明”。
- 没有体现“这一条人物补了什么 / 这一条爆点改了什么 / 这一条 topic item 为什么被改”。

结论：
- `revision_notes_json` **真实落库成功**。
- 但其内容更像“占位式批次说明”，**不构成有实质差异说明价值的审计记录**。

## Step 3：当前结果内容质量核查

## 3.1 `novel_timelines`
当前数据示例：
- `1398年闰五月 / 朱元璋驾崩，皇太孙朱允炆即位为建文帝`
- `1399年七月 / 朱棣起兵反叛，靖难之役正式开始`
- `1402年六月 / 沈照成功阻止李景隆开启金川门，保卫南京`

判断：
- 时间线按年份和月份递增，顺序清晰。
- `time_node` 粒度明确，不是模糊的“前期/中期/后期”。
- `event` 能看出因果推进，不只是非常短的标题词。
- 未发现明显重复和乱序。

质量评价：
- **结构质量较好**。
- 这是当前最能体现“经过 review 后至少形成了更整齐结构化时间线”的一张表。

## 3.2 `novel_characters`
当前数据示例：
- `沈昭/沈照 / 建文朝廷 / 现代历史系博士生魂穿为建文帝贴身女官...`
- `朱允炆 / 建文朝廷 / 建文帝，性格仁柔，书生气重...`
- `李景隆 / 建文朝廷/燕王内应 / 表面为建文军主将，实为朱棣内应`

判断：
- 核心人物覆盖度较高，至少包括主角、建文帝、朱棣、姚广孝、齐泰、黄子澄、李景隆、耿炳文。
- `faction` 基本有填，且大体统一。
- `description / personality / setting_words` 比纯名字列表强很多。
- 但存在明显问题：
  - 主角仍然是 `沈昭/沈照` 合并写法，说明别名统一没有被完全纠偏。
  - 某些人物描述仍偏“简历式概述”，不算特别深。

质量评价：
- **可用，但纠偏不彻底**。
- 有结构化价值，但不能说人物层面已经明显“高质量修正完成”。

## 3.3 `novel_key_nodes`
当前数据示例：
- `战前博弈 / 沈照识破朱棣装疯`
- `战前博弈 / 削藩政策的暗中干预`
- `战争进程 / 阻止李景隆掌兵`
- `战争进程 / 渗透燕王府内部`
- `战争收尾 / 金川门保卫战`

判断：
- 类别上已经出现 `战前博弈 / 战争进程 / 战争收尾`，阶段感明确。
- 标题像“结构节点”，而不是单纯 timeline 复制。
- 但节点数量只有 5 条，覆盖还是偏少。

质量评价：
- **比普通摘要更结构化**。
- 当前质量表现是正向的，但仍偏稀疏。

## 3.4 `novel_skeleton_topic_items`
启用 topic 定义：
- `topic / 靖难之役过程分析 / 从朱元璋死，朱允炆即位，到靖难之役结束的过程`
- `topic_2 / 靖难之役失败原因分析 / 朱允炆在靖难之役的失败原因`

当前 item 示例：
- `topic / 朱元璋驾崩与建文帝即位`
- `topic / 削藩政策引发危机`
- `topic / 朱棣装疯与起兵`
- `topic / 沈照的反制布局`
- `topic_2 / 削藩操之过急`
- `topic_2 / 用人不当和将领失误`
- `topic_2 / 缺乏军事经验`

判断：
- 好的一面：
  - 至少已经围绕两个 topic 分组，没有完全跑偏到别的主题。
  - `topic_2` 的条目确实在讲“失败原因”。
- 不足的一面：
  - 内容仍然非常像从 source_text 中切出来的摘要段，而不是更深层的“围绕 topic 定义的分析结果”。
  - `source_ref` 全部还是同一个泛化的 `原始资料1`。
  - 没有看到明显“review 后补充结构性分析维度”的证据。

质量评价：
- **能证明写回成功，也能证明 topic 对应关系基本成立**。
- 但就“quality uplift”而言，这张表最像“重写了一版仍偏摘要式内容”，改进证据不足。

## 3.5 `novel_explosions`
当前数据示例：
- `身份反转 / 现代博士魂穿古代女官`
- `智斗权谋 / 女官识破燕王装疯`
- `生死翻盘 / 阻止李景隆开城门`
- `权谋逆转 / 女官扭转亡国结局`

判断：
- 标题比首轮普通摘要更接近短剧化表达，具备“反转 / 智斗 / 生死 / 逆转”词汇。
- `scene_restoration / dramatic_quality / adaptability` 都不是空字段。
- 但问题仍在：
  - 标题和副标题仍偏模板化。
  - 一些描述仍像“换个说法的摘要”，不是特别强的戏剧化设计。

质量评价：
- **有一定短剧化包装，但提升幅度看起来有限**。

## Step 4：是否真的“改进了原来的数据”

## 4.1 事实判断：是否真的写进数据库
可以确认：**是，真的写进了数据库。**

证据链：
1. 代码层：
   - `reviewAndCorrect()` 明确调用 `persistReviewedData()`
   - `persistReviewedData()` 明确使用 `dataSource.transaction(...)`
   - 5 张表的 INSERT 都包含 `revision_notes_json`
2. 运行日志层：
   - 已有 `transaction start`
   - 已有 `transaction commit`
   - commit summary 为 `11 / 8 / 5 / 9 / 4`
3. 数据库层：
   - 当前 5 张表数量与 summary 完全一致
   - 当前 5 张表的 `created_at` 全部集中在同一秒
   - 当前 5 张表的 `revision_notes_json` 全部非空且 JSON_VALID 成立

综合判断：
- 这不是“前端提示成功但其实没有写”的情况。
- 这是一次**真实成功的单事务覆盖写回**。

## 4.2 质量判断：是否有证据表明改进了原来的数据
最谨慎结论：

### 能证明的部分
- 能证明本次 review 成功重写了 5 张表。
- 能证明当前结果整体结构是完整的，尤其时间线顺序、人物覆盖、节点分类都比较成型。

### 不能证明的部分
- **缺少 review 前快照**，无法做严格的 before/after 对比。
- 当前 `revision_notes_json` 又是模板化批次说明，不能作为“本条到底改了什么”的差异证据。

因此最合理结论是：
- **无法证明存在“明确且可量化的质量提升”**
- 更准确地说，是：
  - **可以证明发生了成功重写**
  - **但质量提升证据不足，尚不能强结论为“明显改进”**

在三档结论中，本次更接近：
- **更像只是重写/覆盖，但质量提升证据不足**

## 4.3 warning 的含义核查
已知 warning：

```text
Dropped reviewNote because table is not selected: timelines
Dropped reviewNote because table is not selected: characters
Dropped reviewNote because table is not selected: keyNodes
Dropped reviewNote because table is not selected: explosions
```

对应代码：

```ts
private normalizeReviewNotes(
  items: unknown[],
  targetTables: PipelineSecondReviewTargetTable[],
  warnings: string[],
): ReviewNoteInput[] {
  const allowed = new Set<string>(targetTables);
  // ...
  if (!allowed.has(table)) {
    warnings.push(`Dropped reviewNote because table is not selected: ${table}`);
    continue;
  }
}
```

判断：
- 这类 warning **基本合理**，但暴露了 prompt/schema 对齐问题。
- 本次 targetTables 传的是：
  - `novel_timelines`
  - `novel_characters`
  - `novel_key_nodes`
  - `novel_skeleton_topic_items`
  - `novel_explosions`
- 而 AI 很可能返回了简写：
  - `timelines`
  - `characters`
  - `keyNodes`
  - `explosions`
- 因此被 `allowed.has(table)` 过滤掉。

影响评估：
- **不会阻止主数据写库**，因为主数据写库依赖的是 `timelines / characters / keyNodes / skeletonTopicItems / explosions` 这 5 个主数组，不依赖 `reviewNotes`。
- 但它会直接导致：
  - `normalized.reviewNotes` 丢失
  - `buildRevisionNotesByTable()` 只能给每张表写入通用 fallback note
  - 最终 `revision_notes_json` 失去“真实修正说明”价值

## Step 5：最终明确回答

### 1. 这次“二次AI自检”是否真的把修正结果写入了数据库？
是。代码、事务 commit 日志、当前 5 张表行数、统一时间戳和非空 `revision_notes_json` 一起证明了真实写入。

### 2. 写入的是哪几张表？数量是否和日志 summary 一致？
写入了：
- `novel_timelines`
- `novel_characters`
- `novel_key_nodes`
- `novel_skeleton_topic_items`
- `novel_explosions`

数量与日志 summary **完全一致**：
- timelines = 11
- characters = 8
- keyNodes = 5
- skeletonTopicItems = 9
- explosions = 4

### 3. `revision_notes_json` 是否真的落库成功？
是。5 张表都已新增该字段，且对 `novel_id = 1` 来说所有当前行都非空，并且全部是合法 JSON。

### 4. `revision_notes_json` 的内容是“有意义的修正说明”，还是只是模板化批次说明？
更像**模板化批次说明**。字段齐全，但内容几乎完全一致，没有体现逐条差异和真实修正点。

### 5. 从当前数据库结果看，这次 review 是否有明确质量提升证据？
**没有足够证据证明“明确质量提升”。**

更准确地说：
- 能证明：成功重写了数据
- 不能充分证明：比 review 前明显更好

### 6. 哪一张表最像真正经过了纠偏提升？
`novel_timelines`

原因：
- 顺序清楚
- 时间节点具体
- 事件链连续
- 当前成品最像经过了结构整理

### 7. 哪一张表最像“只是被重写了一遍，改进证据不足”？
`novel_skeleton_topic_items`

原因：
- 虽然 topic 对齐基本成立
- 但内容仍然较像 source_text 摘要化重述
- 没有足够证据说明它已经真正“围绕 topic 定义深化分析”

### 8. 当前这套二次AI自检，最大短板是什么？
最大短板是：
- **虽然能成功重写数据，但缺少可审计的前后差异证据**
- 具体表现为：
  - 没有 review 前快照
  - `reviewNotes` 与目标表命名不对齐，被后端过滤
  - `revision_notes_json` 最终只剩模板化 fallback 说明

这会导致：
- 可以证明“写入成功”
- 但很难证明“质量明显提升”

## 最终结论
- 关于“是否真的写入数据库”：**可以明确确认，已经真实写入。**
- 关于“是否有明确质量改进证据”：**证据不足，更像成功重写了一版，但尚不能强证明明显提升。**
