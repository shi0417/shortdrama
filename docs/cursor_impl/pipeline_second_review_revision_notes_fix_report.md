# Pipeline Second Review Revision Notes 修复报告

## 1. 修改/新增文件清单

### 后端
- `apps/api/src/pipeline/pipeline-review.service.ts`

### 前端
- `apps/web/src/types/pipeline-review.ts`
- `apps/web/src/components/PipelinePanel.tsx`

## 2. `reviewNotes.table` 命名映射修复说明

本次修复前：
- AI 常返回 `timelines / characters / keyNodes / skeletonTopicItems / explosions`
- 后端只接受 `novel_timelines / novel_characters / novel_key_nodes / novel_skeleton_topic_items / novel_explosions`
- 导致 `normalizeReviewNotes()` 把真实 notes 当成“未选中的表”丢弃

本次修复后：
- 在 `pipeline-review.service.ts` 中新增 `normalizeReviewNoteTableName(raw)`
- 支持以下映射：
  - `timelines -> novel_timelines`
  - `characters -> novel_characters`
  - `keyNodes / keynodes / key_nodes -> novel_key_nodes`
  - `skeletonTopicItems / skeleton_topic_items -> novel_skeleton_topic_items`
  - `explosions -> novel_explosions`
- 同时也保留对完整表名的直接接受

修复结果：
- 第一轮真实验证中，后端返回：

```json
"details": {
  "reviewNotes": {
    "rawCount": 4,
    "normalizedCount": 4,
    "droppedCount": 0
  }
}
```

这说明真实 AI reviewNotes 已不再被整体丢弃。

## 3. delete 前读取旧 notes 的实现说明

本次修复前：
- `persistReviewedData()` 进入事务后先 `deleteSelectedData(...)`
- 代码里没有任何旧 `revision_notes_json` 读取逻辑

本次修复后：
- 在删除前新增 `loadExistingRevisionNotesIndex(novelId, targetTables, manager)`
- 按目标表分别读取旧行的：
  - 业务匹配键字段
  - `revision_notes_json`
- 解析为内存索引结构，再进入 delete + recreate

实现效果：
- 第二次 review 时，新行的 notes 已不再只保留当前批次
- 可以把第一次、第二次、第三次的 `reviewBatchId` 一起带入新行

## 4. 5 张表各自的匹配键设计

### `novel_timelines`
- 匹配键：`time_node + event`
- builder：`buildTimelineRevisionKey(timeNode, event)`
- 理由：`sort_order` 不稳定，`time_node + event` 更接近业务语义

### `novel_characters`
- 匹配键：`name`
- builder：`buildCharacterRevisionKey(name)`
- 理由：人物名是当前最稳定的业务键

### `novel_key_nodes`
- 匹配键：`category + title`
- builder：`buildKeyNodeRevisionKey(category, title)`
- 理由：单独 title 不够稳，组合后更接近结构节点身份

### `novel_skeleton_topic_items`
- 匹配键：`topic_id + item_title`
- 降级：若 `item_title` 为空，则退化到 `topic_id + content摘要`
- builder：`buildSkeletonItemRevisionKey(topicId, itemTitle, content)`

### `novel_explosions`
- 匹配键：`explosion_type + title`
- builder：`buildExplosionRevisionKey(explosionType, title)`

## 5. notes merge 策略说明

新增统一 merge 逻辑：
- `mergeRevisionNotes(existingNotes, currentNotes, tableDetails)`

规则：
1. 删除前先解析旧 `revision_notes_json`
2. 旧 notes 在前，本次 notes 在后
3. 用以下字段做去重：
   - `reviewBatchId`
   - `targetTable`
   - `reason`
   - `afterSummary`
4. 若某条新行匹配到了旧 notes：
   - `mergedWithHistory += 1`
5. INSERT 前真正写入的是：

```ts
JSON.stringify(mergedNotes)
```

而不是原来的：

```ts
JSON.stringify(revisionNotes)
```

## 6. fallback 新规则说明

修复前：
- 一旦表级 AI notes 没有进入 `buildRevisionNotesByTable()`，就直接整表 fallback

修复后：
1. 若某表有真实 AI notes：
   - 只使用 AI notes
   - fallback 不参与
2. 若某表无 AI notes：
   - 才使用 fallback
3. fallback note 新增：
   - `source: "fallback"`
   - `reason: "AI reviewNotes missing for this table"`
4. 若某表有旧 notes 但本次仍无 AI notes：
   - 最终写入为 `旧 notes + 本次 fallback`
   - 不会把旧历史覆盖掉

## 7. 新增日志说明

新增了以下日志摘要：

### reviewNotes 标准化后
- `rawReviewNotesCount`
- `normalizedReviewNotesCount`
- `droppedReviewNotesCount`
- `reviewNotesByTable`

### 每张表 notes 准备后
- `usedAiNotesCount`
- `usedFallback`
- `finalRevisionNotesCount`

### 事务提交时
- `summary`
- `tableDetails`

这样可以直接从服务端日志看出：
- 哪些表用了真实 AI notes
- 哪些表仍走了 fallback
- 哪些表成功把历史 notes merge 进去了

## 8. 前端提示增强说明

`PipelinePanel.tsx` 中的成功提示现在除了 summary 之外，还会展示：
- 真实 AI 修正说明数量
- 原始 reviewNotes 数量
- 被丢弃数量
- 各表：
  - `usedAiNotes`
  - `usedFallback`
  - `mergedWithHistory`

这样用户在 UI 上可以直接判断：
- 这次是否还在全走 fallback
- 哪些表真的拿到了 AI 原始修正说明
- 哪些表已经发生历史累计

## 9. 构建结果

已执行并通过：

```bash
pnpm --dir apps/api build
pnpm --dir apps/web build
```

## 10. 两轮真实验证结果

## 第 1 次真实 review

请求目标表：
- `novel_timelines`
- `novel_characters`
- `novel_key_nodes`
- `novel_skeleton_topic_items`
- `novel_explosions`

返回摘要：

```json
"summary": {
  "timelines": 11,
  "characters": 8,
  "keyNodes": 5,
  "skeletonTopicItems": 9,
  "explosions": 4
}
```

关键 details：

```json
"reviewNotes": {
  "rawCount": 4,
  "normalizedCount": 4,
  "droppedCount": 0
}
```

表级结果：
- `novel_timelines`
  - `usedAiNotes=0`
  - `usedFallback=true`
  - `mergedWithHistory=11`
- `novel_characters`
  - `usedAiNotes=1`
  - `usedFallback=false`
  - `mergedWithHistory=8`
- `novel_key_nodes`
  - `usedAiNotes=1`
  - `usedFallback=false`
  - `mergedWithHistory=5`
- `novel_skeleton_topic_items`
  - `usedAiNotes=1`
  - `usedFallback=false`
  - `mergedWithHistory=9`
- `novel_explosions`
  - `usedAiNotes=1`
  - `usedFallback=false`
  - `mergedWithHistory=4`

说明：
- 第 1 次运行已经验证“真实 AI notes 不再整体丢失”
- 但 AI 当次没有给 `novel_timelines` 提供 note，所以 timelines 仍走了 fallback

## 第 2 次真实 review

返回摘要：

```json
"summary": {
  "timelines": 12,
  "characters": 10,
  "keyNodes": 6,
  "skeletonTopicItems": 9,
  "explosions": 5
}
```

关键 details：

```json
"reviewNotes": {
  "rawCount": 4,
  "normalizedCount": 4,
  "droppedCount": 0
}
```

表级结果：
- `novel_timelines`
  - `usedAiNotes=1`
  - `usedFallback=false`
  - `mergedWithHistory=10`
- `novel_characters`
  - `usedAiNotes=1`
  - `usedFallback=false`
  - `mergedWithHistory=8`
- `novel_key_nodes`
  - `usedAiNotes=1`
  - `usedFallback=false`
  - `mergedWithHistory=5`
- `novel_skeleton_topic_items`
  - `usedAiNotes=0`
  - `usedFallback=true`
  - `mergedWithHistory=9`
- `novel_explosions`
  - `usedAiNotes=1`
  - `usedFallback=false`
  - `mergedWithHistory=4`

说明：
- 第 2 次运行中 `novel_timelines` 也拿到了真实 AI notes
- `novel_skeleton_topic_items` 这次反而没有 AI notes，于是走了 fallback
- 这符合新逻辑：优先 AI，缺失时才 fallback

## 11. 数据库证据摘要

### 修复前基线
抽样 5 张表第 1 行，`JSON_LENGTH(revision_notes_json)` 都是 `1`

### 第 1 次 review 后
抽样 5 张表第 1 行，`JSON_LENGTH(revision_notes_json)` 全部变为 `2`

示例：
- `novel_timelines / 1398年闰五月`
  - 从 `1 -> 2`
- `novel_characters / 沈昭/沈照`
  - 从 `1 -> 2`
- `novel_key_nodes / 沈照识破朱棣装疯`
  - 从 `1 -> 2`
- `novel_skeleton_topic_items / 朱元璋驾崩与建文即位`
  - 从 `1 -> 2`
- `novel_explosions / 现代博士魂穿古代女官`
  - 从 `1 -> 2`

### 第 2 次 review 后
抽样 5 张表第 1 行，`JSON_LENGTH(revision_notes_json)` 全部变为 `3`

示例：
- `novel_timelines / 1398年闰五月`
  - `JSON_LENGTH = 3`
  - batchIds:
    - `92560b13-ef03-4f97-bdf5-ab5587b2768e`
    - `26a440a5-a6d3-49c9-97af-0c9a88cae67e`
    - `d9f87ed6-bc8d-4127-9a90-f53745c7ef13`
- `novel_characters / 沈昭/沈照`
  - `JSON_LENGTH = 3`
  - batchIds 同样同时存在三批
- `novel_key_nodes / 沈照识破朱棣装疯`
  - `JSON_LENGTH = 3`
- `novel_skeleton_topic_items / 朱元璋驾崩与建文即位`
  - `JSON_LENGTH = 3`
- `novel_explosions / 现代博士魂穿古代女官`
  - `JSON_LENGTH = 3`

结论：
- `revision_notes_json` 已经支持累计历史追加
- 第二次、第三次（当前两轮验证后的三批次累计）不会再覆盖掉旧历史

## 12. 已知限制

1. 当前匹配键仍是启发式业务键，不是数据库天然唯一键。
   - 文案大改时，可能会匹配不到旧行，导致该条历史从该行视角中断。

2. 旧的历史数据里如果没有 `source` 字段，本次解析时会默认归为 `ai`。
   - 这意味着修复前已经落库的那一批模板 notes，在历史回看上无法 100% 自动区分它原本是不是 fallback。

3. 当前是“表级 notes 复用到该表每一行”的设计。
   - 也就是说，当前 `revision_notes_json` 更适合作为“该表本轮修正摘要 + 行级历史容器”，还不是精细到“每一行只记录自己的那条改动”。

4. `novel_skeleton_topic_items` 的匹配在 `item_title` 为空时会退化为 `topic_id + content摘要`，稳定性弱于其它表。
