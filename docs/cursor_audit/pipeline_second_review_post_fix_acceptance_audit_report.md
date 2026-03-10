# Pipeline Second Review 修复后验收审计报告

## 审计范围
- 目标：验证本次修复后的 `pipeline second review` 是否已经真正达到以下目标：
  - 真实 AI `reviewNotes` 不再丢失
  - 5 张目标表真实写库，且数量与本次日志 summary 一致
  - `revision_notes_json` 不再主要是 fallback，而是以真实 AI notes 为主
  - `revision_notes_json` 已经支持历史累计追加
  - 当前最新数据库结果是否已具备足够的“质量提升证据”
- 方式：只读审计
  - 不修改代码
  - 不写数据库
  - 不执行 migration

## 本次日志基线

以下日志为本次验收的唯一基线：

```text
[pipeline:review] request start {"novelId":1,"modelKey":"claude-3-7-sonnet-20250219","targetTables":["novel_characters","novel_key_nodes","novel_skeleton_topic_items","novel_explosions","novel_timelines"],"referenceTables":["drama_novels","drama_source_text","novel_adaptation_strategy","adaptation_modes","set_core"],"promptLength":12055}
[pipeline:review] review notes normalized {"rawReviewNotesCount":5,"normalizedReviewNotesCount":5,"droppedReviewNotesCount":0,"reviewNotesByTable":{"novel_timelines":1,"novel_characters":1,"novel_key_nodes":1,"novel_skeleton_topic_items":1,"novel_explosions":1}}
[pipeline:review] table revision notes prepared {"tableName":"novel_characters","usedAiNotesCount":1,"usedFallback":false,"finalRevisionNotesCount":1}
[pipeline:review] table revision notes prepared {"tableName":"novel_key_nodes","usedAiNotesCount":1,"usedFallback":false,"finalRevisionNotesCount":1}
[pipeline:review] table revision notes prepared {"tableName":"novel_skeleton_topic_items","usedAiNotesCount":1,"usedFallback":false,"finalRevisionNotesCount":1}
[pipeline:review] table revision notes prepared {"tableName":"novel_explosions","usedAiNotesCount":1,"usedFallback":false,"finalRevisionNotesCount":1}
[pipeline:review] table revision notes prepared {"tableName":"novel_timelines","usedAiNotesCount":1,"usedFallback":false,"finalRevisionNotesCount":1}
[pipeline:review] transaction start {"novelId":1,"targetTables":["novel_characters","novel_key_nodes","novel_skeleton_topic_items","novel_explosions","novel_timelines"]}
[pipeline:review] revision note usage summary {"novel_timelines":{"usedAiNotes":1,"usedFallback":false,"mergedWithHistory":12,"insertedRows":12},"novel_characters":{"usedAiNotes":1,"usedFallback":false,"mergedWithHistory":10,"insertedRows":10},"novel_key_nodes":{"usedAiNotes":1,"usedFallback":false,"mergedWithHistory":6,"insertedRows":6},"novel_skeleton_topic_items":{"usedAiNotes":1,"usedFallback":false,"mergedWithHistory":9,"insertedRows":9},"novel_explosions":{"usedAiNotes":1,"usedFallback":false,"mergedWithHistory":5,"insertedRows":5}}
[pipeline:review] transaction commit {"novelId":1,"summary":{"timelines":12,"characters":10,"keyNodes":6,"skeletonTopicItems":9,"explosions":5},"tableDetails":{"novel_timelines":{"usedAiNotes":1,"usedFallback":false,"mergedWithHistory":12,"insertedRows":12},"novel_characters":{"usedAiNotes":1,"usedFallback":false,"mergedWithHistory":10,"insertedRows":10},"novel_key_nodes":{"usedAiNotes":1,"usedFallback":false,"mergedWithHistory":6,"insertedRows":6},"novel_skeleton_topic_items":{"usedAiNotes":1,"usedFallback":false,"mergedWithHistory":9,"insertedRows":9},"novel_explosions":{"usedAiNotes":1,"usedFallback":false,"mergedWithHistory":5,"insertedRows":5}}}
```

## 代码链路核查

### Controller 入口
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

### 后端主链路
`apps/api/src/pipeline/pipeline-review.service.ts`

```ts
const { normalized, warnings, noteDiagnostics } = this.validateAndNormalizeReviewResult(
  aiJson,
  topicMap,
  targetTables,
);

const revisionNotesByTable = this.buildRevisionNotesByTable(
  targetTables,
  normalized.reviewNotes,
  usedModelKey,
  reviewBatchId,
  reviewedAt,
);

const { summary, tableDetails } = await this.persistReviewedData(
  novelId,
  targetTables,
  normalized,
  topicMap,
  revisionNotesByTable,
  warnings,
);
```

### 真实 notes 标准化与映射

```ts
const rawTable = this.normalizeText(item.table);
const table = this.normalizeReviewNoteTableName(rawTable);
```

```ts
if (!table) {
  warnings.push(`Dropped reviewNote because table name is unsupported: ${rawTable}`);
  droppedCount += 1;
  continue;
}
```

### delete + recreate 与旧 notes merge

```ts
const existingNotesIndex = await this.loadExistingRevisionNotesIndex(
  novelId,
  targetTables,
  manager,
);
await this.deleteSelectedData(novelId, targetTables, manager);
```

```ts
JSON.stringify(
  this.mergeRevisionNotes(
    existingNotesIndex.get(this.buildTimelineRevisionKey(item.timeNode, item.event)),
    revisionNotes,
    tableDetails,
  ),
)
```

以上 merge 写法同样出现在：
- `insertTimelines`
- `insertCharacters`
- `insertKeyNodes`
- `insertSkeletonTopicItems`
- `insertExplosions`

### 前端成功后刷新
`apps/web/src/components/PipelinePanel.tsx`

```ts
const result = await pipelineReviewApi.runPipelineSecondReview(novelId, { ... })

await loadOverview()
setExtractRefreshKey((prev) => prev + 1)
setSecondReviewDialogOpen(false)
```

代码链路结论：
- 真实 AI notes 会先标准化再分表
- delete 前已读取旧 `revision_notes_json`
- insert 时已做旧历史 + 本次 notes merge
- 前端成功后会刷新 overview 和相关面板

## 数据库证据核查

## 1. 当前写库数量与日志 summary 是否一致

只读聚合结果：

| 表 | 当前行数 | MIN(created_at) | MAX(created_at) |
|---|---:|---|---|
| `novel_timelines` | 12 | `2026-03-08 16:02:40` | `2026-03-08 16:02:40` |
| `novel_characters` | 10 | `2026-03-08 16:02:40` | `2026-03-08 16:02:41` |
| `novel_key_nodes` | 6 | `2026-03-08 16:02:41` | `2026-03-08 16:02:41` |
| `novel_skeleton_topic_items` | 9 | `2026-03-08 16:02:41` | `2026-03-08 16:02:41` |
| `novel_explosions` | 5 | `2026-03-08 16:02:41` | `2026-03-08 16:02:41` |

与日志对照：
- timelines = 12：一致
- characters = 10：一致
- keyNodes = 6：一致
- skeletonTopicItems = 9：一致
- explosions = 5：一致

结论：
- 5 张表的数据库写入数量与本次 commit summary **完全一致**

## 2. `revision_notes_json` 是否真实落库

只读聚合统计结果：

| 表 | 总行数 | notes 非空行数 | `JSON_VALID=1` 行数 |
|---|---:|---:|---:|
| `novel_timelines` | 12 | 12 | 12 |
| `novel_characters` | 10 | 10 | 10 |
| `novel_key_nodes` | 6 | 6 | 6 |
| `novel_skeleton_topic_items` | 9 | 9 | 9 |
| `novel_explosions` | 5 | 5 | 5 |

结论：
- `revision_notes_json` 已真实落库到 5 张表
- 且当前所有目标行都为合法 JSON

## 3. `revision_notes_json` 是否仍主要是 fallback

本次只读聚合统计了“**最新一条 note**”的 source / action：

| 表 | latest source = `ai` 行数 | latest source = `fallback` 行数 | latest action = `updated` 行数 |
|---|---:|---:|---:|
| `novel_timelines` | 12 | 0 | 12 |
| `novel_characters` | 10 | 0 | 10 |
| `novel_key_nodes` | 6 | 0 | 6 |
| `novel_skeleton_topic_items` | 9 | 0 | 9 |
| `novel_explosions` | 5 | 0 | 5 |

这说明：
- 当前最新一轮之后，5 张表**最新一条 note 全部来自真实 AI**
- 当前最新一轮之后，5 张表**没有任何一行的最新 note 仍是 fallback**
- 当前最新一轮之后，5 张表**最新一条 note 的 action 全部是 `updated`**

进一步抽样可见最新 reason 已经是问题/修正式内容，而不是模板占位：
- timelines：`时间线完整性良好，无重大缺漏`
- characters：`人物设定需要增加settingWords字段`
- keyNodes：`关键节点覆盖完整，需要添加时间线引用`
- skeletonTopicItems：`内容过于简单，需要更详细的分析`
- explosions：`爆点需要增加adaptability字段和时间线引用`

结论：
- 这次最新状态下，`revision_notes_json` **不再主要是 fallback**
- 真实 AI review notes 已经成为主导

## 4. `revision_notes_json` 是否已经支持历史累计

### 4.1 每表抽样 3 行

#### `novel_timelines`
抽样 3 行均显示：
- `JSON_LENGTH(revision_notes_json) = 4`
- `reviewBatchId` 数组里包含 4 个不同批次值

例如：
- `1398年闰五月`
- `1398年六月`
- `1398年七月`

#### `novel_characters`
抽样 3 行均显示：
- `JSON_LENGTH = 4`
- 包含 4 个不同 `reviewBatchId`

例如：
- `沈昭/沈照`
- `朱允炆`
- `朱棣`

#### `novel_key_nodes`
抽样 3 行均显示：
- `JSON_LENGTH = 4`
- 包含 4 个不同 `reviewBatchId`

例如：
- `沈照识破朱棣装疯`
- `削藩政策的暗中干预`
- `阻止李景隆掌兵`

#### `novel_skeleton_topic_items`
抽样 3 行均显示：
- `JSON_LENGTH = 4`
- 包含 4 个不同 `reviewBatchId`

例如：
- `朱元璋驾崩与建文即位`
- `削藩过于急躁`
- `削藩政策引发危机`

#### `novel_explosions`
抽样 3 行中：
- 前 2 行 `JSON_LENGTH = 4`
- 第 3 行 `JSON_LENGTH = 2`

例如：
- `现代博士魂穿古代女官` -> 4
- `女官识破燕王装疯` -> 4
- `女官暗中操控人事` -> 2

解释：
- 这并不否定历史累计
- 第 3 行更像是在后续批次中新增的业务记录，因此只保留它出现之后的两批历史

### 4.2 数据库证据判断
综合 5 表抽样：
- 所有表都已出现 `JSON_LENGTH > 1`
- 大部分稳定业务记录都保留了 4 个不同的 `reviewBatchId`
- 新增业务记录保留的历史长度更短，这符合 delete+rebuild + 业务键匹配的设计预期

结论：
- `revision_notes_json` 已经支持多轮累计追加
- 这是数据库直接证据，不只是代码推断

## revision_notes_json 有效性判断

### 已达成的点
- notes 不再丢
- notes 不再以 fallback 为主
- notes 会累计
- 最新 note 已经是真实 AI “issue/fix” 风格说明

### 仍存在的边界
- 旧的首批历史里仍可能包含更早批次遗留的模板式 note
- 当前是“表级修正说明 + 行级历史容器”，还不是精确到“每一行只记录自己那条差异”的真正行级 diff

## 质量提升证据判断

这里不只看“写成功”，还看当前数据库内容是否至少提供了可见质量改进证据。

## 1. `novel_timelines`
抽样结果显示：
- 时间顺序清晰：`1398年闰五月 -> 1398年六月 -> 1398年七月 ...`
- 时间粒度明确
- 最新 notes 明确指出“时间线完整性良好，无重大缺漏”

判断：
- 时间线层面已经具备较强的结构质量证据

## 2. `novel_characters`
抽样结果显示：
- 核心角色仍有覆盖
- faction / description / personality 均非空
- 最新 notes 指向 `settingWords` 补强

但仍有问题：
- 主角仍是 `沈昭/沈照` 双写法，说明别名统一没有完全解决

判断：
- 人物层面已有增强，但还不算彻底收口

## 3. `novel_key_nodes`
抽样结果显示：
- `战前博弈 / 战争进程` 分类稳定
- 节点标题比普通摘要更像结构节点
- 最新 notes 聚焦“时间线引用”完善

但不足：
- 当前总量只有 6 条，仍偏少
- 战后收尾覆盖不算特别丰满

判断：
- keyNodes 有明确结构提升证据，但数量层面仍偏保守

## 4. `novel_skeleton_topic_items`
抽样结果显示：
- 能对齐到 `靖难之役过程分析 / 靖难之役失败原因分析` 两个 topic
- 最新 note 已经不再是模板，而是：`内容过于简单，需要更详细的分析`

但当前内容本身仍偏：
- 顺着 source text 做摘要化表达
- topic 约束被体现了一部分，但分析深度仍不够

判断：
- 这是当前“目标基本达成但质量证据最弱”的一张表

## 5. `novel_explosions`
抽样结果显示：
- 标题有一定短剧化风格：
  - `身份反转`
  - `智斗权谋`
  - `权谋博弈`
- 最新 notes 指向 `adaptability + timeline 引用`

但仍存在：
- 副标题和描述仍偏模板化
- 传播钩子和强反转感仍不够强

判断：
- 爆点已有一定改进证据，但距离“非常强的短剧爆点”还有差距

## 最终结论

### 1. 这次 review 之后，5 张表的数据库写入数量是否与日志 summary 完全一致？
是，完全一致。

### 2. `revision_notes_json` 是否已经真实落库到 5 张表？
是，5 张表全部真实落库，且全部是合法 JSON。

### 3. 这次 `revision_notes_json` 是否还主要是 fallback？还是已经能看到真实 AI review notes 成为主导？
已经能看到真实 AI review notes 成为主导。

证据：
- 5 张表 latest source = `ai` 的行数都等于总行数
- 5 张表 latest source = `fallback` 的行数都是 0

### 4. `revision_notes_json` 是否已经支持多轮累计追加？请给出数据库证据，而不是代码推断。
是。

数据库证据：
- 5 张表抽样记录都能看到 `JSON_LENGTH > 1`
- 多数稳定业务记录都保留了 4 个不同的 `reviewBatchId`

### 5. 当前数据库证据是否表明“二次AI自检已经达到了我们的目标”？
**部分达到。**

已经达到的目标：
- notes 不丢
- notes 不再全是 fallback
- notes 会累计
- 5 张表写回数量与日志一致

还没有完全达到的部分：
- 质量提升证据虽然已经出现，但并不均衡
- `skeletonTopicItems` 仍偏摘要
- `explosions` 仍有模板化倾向
- 人物别名统一仍未完全解决

### 6. 现在这套 `revision_notes_json`，是否已经足够支撑“质量提升证据”？
**基本够用，但还不够理想。**

原因：
- 它已经足以证明：
  - 这轮 AI 说自己改了什么
  - 这轮 notes 是否真实存在
  - 历史是否累计
- 但它还不足以精确表达：
  - 某一行到底删了什么、改了什么、加了什么

### 7. 还需不需要下一步继续细化成“行级差异说明”？
**建议需要。**

原因：
- 如果后续要把“质量提升证据”做得更硬、更可追溯，当前这套“表级修正摘要 + 行级累计容器”还不够细
- 下一步最自然的方向就是：
  - 让每条 row 的 note 更聚焦本行真实变化
  - 或者补充一层真正的行级 before/after 差异说明

## 下一步建议
- 优先继续优化 `novel_skeleton_topic_items`
  - 让内容更像围绕 topic 定义的结构分析，而不是 source text 摘要
- 其次优化 `novel_explosions`
  - 加强冲突、反转、爽点释放、传播钩子
- 若后续要把“质量提升证据”做成强审计能力，建议继续推进：
  - `revision_notes_json` 从“表级摘要”进化为“行级差异说明”
