# Pipeline Second Review Quality Uplift 验收审计报告

## 审计范围
- 项目：`D:/project/duanju/shortdrama`
- 本次目标：对“质量增强版二次 AI 自检”做一次真实运行后的只读验收审计
- 重点表：
  - `novel_characters`
  - `novel_skeleton_topic_items`
  - `novel_explosions`
- 审计方式：
  - 只读代码检查
  - 基于用户提供的最新真实运行日志
  - 只读数据库查询
- 约束：
  - 不修改业务代码
  - 不写数据库
  - 不新增 migration
  - 不提交 commit

## 本次质量增强规则落点

### 代码落点
- `apps/api/src/pipeline/pipeline-review.service.ts`
- `docs/cursor_impl/pipeline_second_review_quality_uplift_report.md`

### `buildReviewPrompt()` 中与三张重点表相关的规则

#### `novel_characters`

```ts
'【characters 强规则】',
'1. 必须尽量覆盖主角、核心对手、关键盟友/辅臣、关键阻碍者/内应。',
'2. 必须统一人物别名，不允许把多个写法直接拼接在 name 字段里。',
'3. faction 要规范化，避免同类阵营出现多种散乱写法。',
'4. description 必须回答“此人如何推动剧情”，不能只是泛泛人物介绍。',
'5. personality 必须服务剧情推进，不能只有空泛褒义词。',
'6. settingWords 要适合后续角色设定/绘图/风格化生成，不要写成长段散文。',
```

#### `novel_skeleton_topic_items`

```ts
'【skeletonTopicItems 强规则】',
'1. 每组 skeletonTopicItems 必须严格围绕对应 topic 的 topicKey、topicName、topicType、description 作答。',
'2. 不允许只是把 drama_source_text 改写成另一段摘要。',
'3. 如果 topicType = list，必须拆成多个有区分度的 item，每条都要是独立观点/阶段/原因/结论。',
'4. 如果 topicType = text，内容也必须集中回应该 topic，而不是泛泛背景介绍。',
'5. 每个 item 必须具备分析/提炼价值，而不是原文摘抄。',
'6. itemTitle 必须有信息量，不允许大量使用“原因一/阶段一/过程一/内容一”这类空标题。',
```

#### `novel_explosions`

```ts
'【explosions 强规则】',
'1. 每个 explosion 必须是“短剧可拍的爆点单元”，不是普通历史摘要。',
'2. 每条至少体现以下元素中的两项：压迫、反击、反转、翻盘、身份差、权力逆转、生死危机、情绪释放。',
'3. title 必须短剧化，不能像教材目录。',
'4. sceneRestoration 必须写出角色、场景、动作、冲突，形成画面感。',
'5. dramaticQuality 必须明确说明“为什么有戏”，包括冲突点、反转点或情绪爆发点。',
'6. adaptability 必须明确说明为什么适合短剧改编，例如单场景强冲突、高反转、低成本可拍、强情绪释放、易形成集尾钩子。',
```

### 新增轻量程序兜底代码位置与核心逻辑

#### `charactersAliasNormalizedCount`
位置：`normalizeCharacters(...)`

逻辑：
- 调用 `normalizeCharacterNameAndDescription(...)`
- 若 `name` 中包含 `/` 或 `／`
- 取第一个片段作为主名
- 其余别名尝试拼入 `description`
- 命中则累加 `charactersAliasNormalizedCount`

#### `skeletonTopicWeakItemCount`
位置：`normalizeSkeletonTopicItems(...)`

逻辑：
- `itemTitle` 命中“过程一/原因一/阶段一/内容一”等空泛模式时记弱项
- `content` 过短时记弱项
- `list` 型 topic item 数过少时记 warning
- `text` 型 topic 全部偏空泛摘要时记 warning

#### `explosionWeakCount`
位置：`normalizeExplosions(...)`

逻辑：
- `dramaticQuality` 或 `adaptability` 过短、过空泛时记 warning
- 统计 `explosionWeakCount`

### 新增质量日志
位置：`reviewAndCorrect(...)`

日志名：

```text
[pipeline:review] quality diagnostics ...
```

日志项：
- `charactersAliasNormalizedCount`
- `skeletonTopicWeakItemCount`
- `explosionWeakCount`
- `reviewNotesByTable`
- `focusTablesReceivedAiNotes`

## 最新运行日志证据

本次验收以用户提供的最新真实运行日志为准：

```text
[pipeline:review] request start {"novelId":1,"modelKey":"claude-3-7-sonnet-20250219","targetTables":["novel_characters","novel_key_nodes","novel_skeleton_topic_items","novel_explosions","novel_timelines"],"referenceTables":["drama_novels","drama_source_text","novel_adaptation_strategy","adaptation_modes","set_core"],"promptLength":13250}
[pipeline:review] review notes normalized {"rawReviewNotesCount":3,"normalizedReviewNotesCount":3,"droppedReviewNotesCount":0,"reviewNotesByTable":{"novel_characters":1,"novel_skeleton_topic_items":1,"novel_explosions":1}}
[pipeline:review] table revision notes prepared {"tableName":"novel_characters","usedAiNotesCount":1,"usedFallback":false,"finalRevisionNotesCount":1}
[pipeline:review] table revision notes prepared {"tableName":"novel_key_nodes","usedAiNotesCount":0,"usedFallback":true,"finalRevisionNotesCount":1}
[pipeline:review] table revision notes prepared {"tableName":"novel_skeleton_topic_items","usedAiNotesCount":1,"usedFallback":false,"finalRevisionNotesCount":1}
[pipeline:review] table revision notes prepared {"tableName":"novel_explosions","usedAiNotesCount":1,"usedFallback":false,"finalRevisionNotesCount":1}
[pipeline:review] table revision notes prepared {"tableName":"novel_timelines","usedAiNotesCount":0,"usedFallback":true,"finalRevisionNotesCount":1}
[pipeline:review] quality diagnostics {"charactersAliasNormalizedCount":0,"skeletonTopicWeakItemCount":0,"explosionWeakCount":0,"reviewNotesByTable":{"novel_characters":1,"novel_skeleton_topic_items":1,"novel_explosions":1},"focusTablesReceivedAiNotes":{"novel_characters":true,"novel_skeleton_topic_items":true,"novel_explosions":true}}
[pipeline:review] transaction start {"novelId":1,"targetTables":["novel_characters","novel_key_nodes","novel_skeleton_topic_items","novel_explosions","novel_timelines"]}
[pipeline:review] revision note usage summary {"novel_timelines":{"usedAiNotes":0,"usedFallback":true,"mergedWithHistory":12,"insertedRows":12},"novel_characters":{"usedAiNotes":1,"usedFallback":false,"mergedWithHistory":9,"insertedRows":10},"novel_key_nodes":{"usedAiNotes":0,"usedFallback":true,"mergedWithHistory":2,"insertedRows":6},"novel_skeleton_topic_items":{"usedAiNotes":1,"usedFallback":false,"mergedWithHistory":0,"insertedRows":9},"novel_explosions":{"usedAiNotes":1,"usedFallback":false,"mergedWithHistory":5,"insertedRows":5}}
[pipeline:review] transaction commit {"novelId":1,"summary":{"timelines":12,"characters":10,"keyNodes":6,"skeletonTopicItems":9,"explosions":5},"tableDetails":{"novel_timelines":{"usedAiNotes":0,"usedFallback":true,"mergedWithHistory":12,"insertedRows":12},"novel_characters":{"usedAiNotes":1,"usedFallback":false,"mergedWithHistory":9,"insertedRows":10},"novel_key_nodes":{"usedAiNotes":0,"usedFallback":true,"mergedWithHistory":2,"insertedRows":6},"novel_skeleton_topic_items":{"usedAiNotes":1,"usedFallback":false,"mergedWithHistory":0,"insertedRows":9},"novel_explosions":{"usedAiNotes":1,"usedFallback":false,"mergedWithHistory":5,"insertedRows":5}}}
```

### 日志提取结果
- `rawReviewNotesCount = 3`
- `normalizedReviewNotesCount = 3`
- `droppedReviewNotesCount = 0`
- `reviewNotesByTable = { novel_characters: 1, novel_skeleton_topic_items: 1, novel_explosions: 1 }`
- `charactersAliasNormalizedCount = 0`
- `skeletonTopicWeakItemCount = 0`
- `explosionWeakCount = 0`
- `focusTablesReceivedAiNotes = { novel_characters: true, novel_skeleton_topic_items: true, novel_explosions: true }`
- `commit summary = { timelines: 12, characters: 10, keyNodes: 6, skeletonTopicItems: 9, explosions: 5 }`

### 日志判断
1. 本轮三张重点表都收到了真实 AI notes：**是**
2. 本轮是否触发了人物别名归一：**否，计数为 0**
3. 本轮是否仍识别出 `skeletonTopicItems` 偏弱：**否，计数为 0**
4. 本轮是否仍识别出 `explosions` 偏弱：**否，计数为 0**

说明：
- 这说明本轮 AI 返回已经满足重点表 review notes 覆盖
- 也说明当前程序级弱质量检测没有再判出明显弱项
- 但 `charactersAliasNormalizedCount = 0` 也意味着本轮数据本身没有再触发别名归一逻辑

## `novel_characters` 质量验收

### 当前数据库结果摘要
只读查询确认：
- 当前行数：`10`
- 角色名中包含 `/` 或 `／` 的数量：`0`
- 当前 faction 集合：`建文朝廷 | 燕王势力`

当前角色包含：
- 主角：`沈昭`
- 核心对手：`朱棣`
- 对手谋士：`姚广孝`
- 关键盟友/辅臣：`朱允炆`、`齐泰`、`黄子澄`
- 关键阻碍者/内应：`李景隆`
- 关键将领补齐：`耿炳文`、`盛庸`、`铁铉`

### 重点判断

#### 1. 主角是否仍出现 `沈昭/沈照` 这种混合写法
否。

当前数据库中主角名称已统一为：
- `沈昭`

#### 2. 是否已经统一成主名 + description 中保留别名说明
**部分达到。**

现状：
- 主名统一已经达成
- 但当前 `description` 未看到明确的 `别名：沈照` 文本

因此：
- “名称统一”已落地
- “description 显式保留别名说明”目前证据不足

#### 3. 是否补齐了主角 / 核心对手 / 关键盟友 / 关键阻碍者
是，已明显补齐。

相较上一轮不足，`盛庸`、`铁铉` 等关键角色已存在于当前结果中。

#### 4. faction 是否更规范
是。

当前仅保留两类规范 faction：
- `建文朝廷`
- `燕王势力`

### `revision_notes_json` 证据
当前角色 notes 中可见：
- `原有角色缺少settingWords字段，faction表述不统一`
- `缺少盛庸、铁铉等关键将领角色`

统计结果：
- notes 含 `faction` 的行数：`10`
- notes 含“关键人物/关键将领/补充”相关关键词的行数：`10`
- notes 含“别名”的行数：`0`

### 本表结论
- 主名统一：明显改善
- 角色补齐：明显改善
- faction 规范化：明显改善
- 别名说明落到 description / notes：证据不足

综合判断：
- `novel_characters`：**明显改善**

## `novel_skeleton_topic_items` 质量验收

### 当前 topic 定义
启用中的 `novel_skeleton_topics`：

1. `topic`
   - `topic_name = 靖难之役过程分析`
   - `topic_type = text`
   - `description = 从朱元璋死，朱允炆即位，到靖难之役结束的过程。`

2. `topic_2`
   - `topic_name = 靖难之役失败原因分析`
   - `topic_type = text`
   - `description = 朱允炆在靖难之役的失败原因`

### 当前 items 结构摘要
只读统计结果：
- `topic` 下 item 数：`5`
- `topic_2` 下 item 数：`4`
- 空泛标题命中数：`0`

当前标题示例：
- `朱元璋驾崩引发皇位传承`
- `削藩政策激化矛盾`
- `朱棣装疯与起兵时机`
- `沈照的战略反制布局`
- `金川门决战改写结局`
- `削藩策略过于急躁`
- `用人决策的致命失误`
- `军事经验严重不足`
- `情报工作的全面失败`

### 重点判断

#### 1. 每个 item 是否真的围绕所属 topic 定义
**部分是，但仍不够彻底。**

优点：
- 已按 `过程分析` / `失败原因分析` 做分组
- 标题明显比上一轮更有信息量
- `topic_2` 的条目已经更像“失败原因归因”

不足：
- 内容主体仍高度依赖剧情事件顺序展开
- “过程分析”部分仍带有较强的事件摘要感
- 真正抽象成分析维度、结论、方法论的程度仍有限

#### 2. 是否仍大量出现“过程一 / 原因一 / 阶段一”这类空标题
否。

数据库统计结果：
- generic title count = `0`

#### 3. `list` 型 topic 是否至少有 2 条以上可区分 item
本轮无法验证。

原因：
- 当前启用 topic 全部为 `text`
- 没有 `list` 型 topic 可供验收

#### 4. 内容是否仍明显像 `drama_source_text` 的摘要改写
**仍有一定程度存在。**

虽然本轮标题质量和 topic 针对性明显提升，但正文仍偏“按剧情段落总结”，并未完全达到“分析型提炼”的理想目标。

### `revision_notes_json` 证据
当前每条 item 的最新 notes 基本一致：
- `reason = 原内容过于摘要化，缺乏围绕topic定义的深度分析`
- `afterSummary = 重新组织内容使其严格围绕'靖难之役过程分析'和'失败原因分析'两个topic，增强分析性和针对性`

关键词统计：
- 包含“摘要化”的行数：`9`
- 包含“topic”的行数：`9`
- 包含“提炼/分析”的行数：`9`

### 本表结论
- 标题质量：明显改善
- 围绕 topic 的针对性：略有改善到中度改善之间
- 从“摘要化改写”向“分析型提炼”转变：仍未彻底完成

综合判断：
- `novel_skeleton_topic_items`：**略有改善**

## `novel_explosions` 质量验收

### 当前数据库结果摘要
当前爆点共 `5` 条，标题为：
- `身份反转`
- `智斗权谋`
- `权谋博弈`
- `生死博弈`
- `权力逆转`

字段丰富度统计：
- `dramatic_quality` 长度 < 20 的条数：`0`
- `adaptability` 长度 < 20 的条数：`0`
- 平均标题长度：`8.2`
- 平均 `scene_restoration` 长度：`48`

### 重点判断

#### 1. title 是否比之前更短剧化
是。

当前标题明显已经转向短剧化，而不是历史教材目录式命名。

#### 2. 是否仍偏模板化
**仍有一点统一套路感，但较上一轮明显减弱。**

原因：
- 标题、场景、戏剧解释都明显增强
- 但表达范式仍偏整齐，传播钩子没有全部打满

#### 3. `scene_restoration` 是否有角色、动作、场景、冲突
是，基本具备。

示例中已出现：
- 宫中 / 朝堂 / 城门前等明确场景
- 角色与动作明确
- 冲突关系明确

#### 4. `dramatic_quality` 是否真的在解释“为什么有戏”
是。

例如：
- `知识优势与权力劣势的巨大冲突`
- `真相与伪装的对立`
- `弱者智胜强者的权谋反转`
- `成败在此一举的极限紧张感`
- `终极反转和情绪释放`

#### 5. `adaptability` 是否真的在解释“为什么适合短剧”
是。

例如：
- `单场景强冲突`
- `成本低效果强`
- `适合短剧节奏，易形成反转高潮`
- `单场景高强度冲突，适合短剧高潮设计`
- `适合作为全剧高潮和结局钩子`

### `revision_notes_json` 证据
最新一轮 notes 主要表达：
- `原爆点缺少adaptability字段，dramaticQuality描述不够具体`
- `为所有爆点补充adaptability字段说明短剧改编优势，强化dramaticQuality的冲突点和情绪爆发点描述`

关键词统计：
- 包含“冲突”的行数：`5`
- 包含“反转”的行数：`0`
- 包含“画面感/视觉”的行数：`0`
- 包含“传播/钩子”的行数：`0`

说明：
- 当前 notes 已能明确支撑“冲突强化”
- 但还没有把“反转 / 画面感 / 传播钩子”这些维度写进最新 notes

### 本表结论
- 标题短剧化：明显改善
- `scene_restoration` 画面化：明显改善
- `dramaticQuality` / `adaptability` 的说明性：明显改善
- 高阶爆点维度的 notes 证据：仍偏弱

综合判断：
- `novel_explosions`：**明显改善**

## `revision_notes_json` 对质量提升证据的支撑度

### 支撑较强
- `novel_characters`
  - 能证明：补了人物、规范了 faction、补了 settingWords
- `novel_skeleton_topic_items`
  - 能证明：本轮明确在纠偏“摘要化”问题，且目标是围绕 topic 定义
- `novel_explosions`
  - 能证明：本轮明确强化了 `dramaticQuality` 与 `adaptability`

### 仍然不足
- `novel_characters`
  - 最新 notes 没有直接写出“统一了哪些别名”
- `novel_skeleton_topic_items`
  - notes 很明确，但内容本身还没完全脱离摘要感
- `novel_explosions`
  - 最新 notes 还没有直接覆盖“反转 / 画面感 / 传播钩子”

### 总体判断
当前这套 `revision_notes_json`：
- 已经足够支撑“本轮确实朝目标方向改了”
- 但还不足以证明“所有行都已经达到高质量终态”

## 和上一次验收结果的对比

上一份验收报告中的三项短板：
- `novel_skeleton_topic_items` 仍偏摘要化
- `novel_explosions` 仍有模板化倾向
- 人物别名统一还不彻底

### 1. `novel_skeleton_topic_items` 仍偏摘要化
本轮判断：**略有改善**

证据：
- 标题质量显著提升
- notes 已明确指向“摘要化 -> 围绕 topic 定义纠偏”
- 但数据库正文仍带明显事件总结感

### 2. `novel_explosions` 仍有模板化倾向
本轮判断：**明显改善**

证据：
- 标题明显更短剧化
- `scene_restoration` 已有角色/动作/场景/冲突
- `dramaticQuality` / `adaptability` 已经有了实质内容

### 3. 人物别名统一还不彻底
本轮判断：**略有改善**

证据：
- 当前数据库中已无 `沈昭/沈照` 这种混合 `name`
- 但 `description` 未明确保留别名说明
- 最新 notes 也没有直接写“统一别名”

## 最终结论

### 结论等级
**部分提升**

### 分项结论
- `characters` 是否改善：**明显改善**
- `skeletonTopicItems` 是否改善：**略有改善**
- `explosions` 是否改善：**明显改善**

### 原因
- `novel_characters` 已经完成主名统一、角色补齐和 faction 规范化，但别名证据仍不够硬
- `novel_skeleton_topic_items` 已经明显朝 topic 定义收拢，但距离真正“分析型提炼”还有距离
- `novel_explosions` 是本轮最明显的提升点，短剧化程度明显上升

## 下一步最值得继续优化的 1~3 个点

### 1. 继续强化 `novel_skeleton_topic_items`
目标：
- 从“按 topic 分组的事件总结”
- 继续拉到“围绕 topic 定义的分析结论 / 结构提炼”

### 2. 继续细化 `novel_characters` 的别名证据
目标：
- 不只统一主名
- 还要让 `description` 或最新 notes 更明确保留别名处理结果

### 3. 继续强化 `novel_explosions` 的高阶爆点维度
目标：
- 不只补 `adaptability`
- 还要在内容和 notes 里更明确体现：
  - 反转
  - 画面感
  - 传播钩子
