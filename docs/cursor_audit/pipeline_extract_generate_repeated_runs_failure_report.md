# Pipeline Extract Repeated Runs Failure Report

## 背景与新增现象

用户新增现象如下：

1. 第 1 次运行成功。
2. 第 2 次运行成功，并覆盖了第 1 次写入的数据。
3. 第 3 次和第 4 次运行时报“写入数据库错误”。
4. 但数据库中仍然保留的是第 2 次成功写入的数据。

这组现象与上一份报告相比，最大的新增信息不是“哪些表有数据”，而是：

- **后续失败并没有把数据库改成半成品状态**
- **第 2 次成功的数据在第 3/4 次失败后仍完整保留**

这对判断事务行为非常关键。

---

## 本次只读核查范围

- `apps/api/src/pipeline/pipeline-extract.service.ts`
- `apps/api/src/pipeline/pipeline.controller.ts`
- `apps/web/src/components/PipelinePanel.tsx`
- `apps/web/src/lib/api.ts`
- `docs/cursor_audit/pipeline_extract_generate_partial_write_debug_report.md`
- 只读 SQL：
  - `SHOW CREATE TABLE novel_timelines`
  - `SHOW CREATE TABLE novel_characters`
  - `SHOW CREATE TABLE novel_key_nodes`
  - `SHOW CREATE TABLE novel_skeleton_topic_items`
  - `SHOW CREATE TABLE novel_explosions`
  - `COUNT(*) / MIN(created_at) / MAX(created_at)`
  - 当前 `GET /pipeline/1/overview`

---

## 一、当前数据库现状（再次核对）

### 当前计数与时间戳

```text
novel_timelines             6   2026-03-08 10:43:31   2026-03-08 10:43:31
novel_characters            5   2026-03-08 10:43:31   2026-03-08 10:43:31
novel_key_nodes             4   2026-03-08 10:43:31   2026-03-08 10:43:31
novel_skeleton_topic_items  0   NULL                  NULL
novel_explosions            3   2026-03-08 10:43:31   2026-03-08 10:43:31
```

### 当前 `overview` 摘要

```json
{
  "timelines": 6,
  "characters": 5,
  "keyNodes": 4,
  "explosions": 3,
  "skeletonTopics": 2,
  "skeletonTopicItems": 0
}
```

### 结论

当前库里保留下来的仍然是一组**完整一致的旧成功结果**：

- `novel_timelines / novel_characters / novel_key_nodes / novel_explosions`
  都是同一时间戳 `2026-03-08 10:43:31`
- 没有出现“timeline 是新一批、characters 还是旧一批”的混杂状态

这与“第 3/4 次失败后仍保留第 2 次数据”的用户观察是吻合的。

---

## 二、这说明了什么：更像“整体回滚”，不像“部分提交”

## 2.1 当前写库代码仍然是单事务

关键代码：

```ts
private async persistGeneratedData(
  novelId: number,
  result: PipelineExtractAiResult,
  topicMap: Map<string, { id: number; topicKey: string }>,
): Promise<PipelineExtractCommitResponse['summary']> {
  return this.dataSource.transaction(async (manager) => {
    await this.deleteExistingData(novelId, manager);

    const insertedTimelines = await this.insertTimelines(
      novelId,
      result.timelines,
      manager,
    );
    const timelineLookup = this.buildTimelineLookup(insertedTimelines);
    const insertedCharacters = await this.insertCharacters(
      novelId,
      result.characters,
      manager,
    );
    const insertedKeyNodes = await this.insertKeyNodes(
      novelId,
      result.keyNodes,
      timelineLookup,
      manager,
    );
    const insertedSkeletonTopicItems = await this.insertSkeletonTopicItems(
      novelId,
      result.skeletonTopicItems,
      topicMap,
      manager,
    );
    const insertedExplosions = await this.insertExplosions(
      novelId,
      result.explosions,
      timelineLookup,
      manager,
    );

    return {
      timelines: insertedTimelines.length,
      characters: insertedCharacters,
      keyNodes: insertedKeyNodes,
      skeletonTopicItems: insertedSkeletonTopicItems,
      explosions: insertedExplosions,
    };
  });
}
```

## 2.2 与用户现象的对应解释

把 4 次运行串起来，最合理的解释是：

1. 第 1 次成功  
   - 事务提交，数据库变成第 1 次结果。

2. 第 2 次成功  
   - 事务先删旧数据，再写入新数据，再提交。
   - 所以第 1 次结果被第 2 次结果覆盖。

3. 第 3 次失败  
   - 若失败发生在事务开始前：数据库不会变。
   - 若失败发生在事务内部：事务回滚，数据库恢复为第 2 次结果。

4. 第 4 次失败  
   - 同理，数据库仍保持第 2 次结果。

### 更新后的核心结论

从“第 2 次成功结果被保留”这个现象看：

- **更符合“失败请求没有 commit”**
- **不符合“timeline 已经提交、后面几张表没提交”的部分提交模型**

也就是说：

> 现在最应该优先排查的，不是“事务是不是坏了”，而是“第 3/4 次请求为什么会在提交前失败”。  

---

## 三、失败更可能发生在哪两个阶段

## 3.1 阶段 A：事务开始前失败

事务开始前有这些步骤：

```ts
await this.assertNovelExists(novelId);
const usedModelKey = await this.resolveModelKey(dto.modelKey);
const referenceTables = this.resolveReferenceTables(dto.referenceTables);
const promptPreview = ... await this.buildPrompt(...);

const aiJson = await this.callLcAiApi(usedModelKey, promptPreview);
const topicMap = await this.getEnabledSkeletonTopicMap(novelId);
const { normalized, warnings } = this.validateAndNormalizeAiResult(aiJson, topicMap);
const summary = await this.persistGeneratedData(novelId, normalized, topicMap);
```

如果第 3/4 次失败发生在：

- 外部 AI 请求失败
- AI 返回非 JSON
- AI JSON 顶层 schema 不合法

那么 `persistGeneratedData()` 根本不会执行，数据库自然继续保留第 2 次结果。

### 这种情况的特征

- 前端会收到后端异常
- 数据库完全不变
- 不会出现“删了一半”的状态

---

## 3.2 阶段 B：事务内部 SQL 失败，然后整体回滚

如果第 3/4 次失败发生在 `insertTimelines / insertCharacters / insertKeyNodes / insertSkeletonTopicItems / insertExplosions` 过程中，当前结构也会整体回滚。

所以即使出现：

- 已经删了旧数据
- 已经插入了部分 timeline
- 之后某张表报 SQL 错

最终事务 rollback 后，**库里仍会回到第 2 次的成功状态**。

这恰好解释了用户观察到的：

- “报了写入数据库错误”
- “但数据库里仍然是第 2 次成功写入的数据”

---

## 四、如果真是“写入数据库错误”，本次最可疑的是数据依赖型 SQL 异常

这次新增现象里最重要的一点是：

- 第 1、2 次成功
- 第 3、4 次失败

这说明问题很可能不是固定代码路径必报错，而是**和 AI 每次生成的具体内容有关**。

在当前实现里，服务层只做了 `trim()` 和结构校验，**没有做字段长度截断**。

### 当前 `normalizeText()` 只是 trim，不做截断

```ts
private normalizeText(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}
```

这意味着 AI 只要一次生成得更长，就有可能撞上 MySQL 字段上限。

---

## 五、最可能触发“第 3/4 次数据库写入错误”的字段约束

根据 `SHOW CREATE TABLE`，当前最容易出现**偶发性长度越界**的字段如下。

## 5.1 `novel_timelines`

```sql
time_node varchar(100) not null
event text not null
```

风险：

- `time_node` 超过 100 字符时，会报 `Data too long for column 'time_node'`

## 5.2 `novel_characters`

```sql
name varchar(100) not null
faction varchar(50) null
description text
personality text
setting_words text
```

风险：

- `name` 超过 100
- `faction` 超过 50

这是**高概率**风险，因为 AI 很容易把：

- `name` 写成“人物名 + 身份说明 + 阵营说明”
- `faction` 写成长句

## 5.3 `novel_key_nodes`

```sql
category varchar(50)
title varchar(255) not null
description longtext
```

风险：

- `category` 超过 50
- `title` 超过 255

## 5.4 `novel_skeleton_topic_items`

```sql
item_title varchar(255)
content longtext
content_json json
source_ref varchar(255)
```

风险：

- `item_title` 过长
- `source_ref` 过长
- `content_json` 若序列化后不是合法 JSON（虽然当前路径里概率较低）

但注意：

- 当前这张表现在是 `0` 条
- 更像是前置 normalize/filter 直接把它过滤空，而不是插入时才报错

## 5.5 `novel_explosions`

```sql
explosion_type varchar(50) not null
title varchar(255) not null
subtitle varchar(255)
scene_restoration text
dramatic_quality text
adaptability text
```

风险：

- `explosion_type` 超过 50
- `title` 超过 255
- `subtitle` 超过 255

这也是**高概率偶发型错误点**，因为 AI 有时会生成特别长的小标题、副标题。

---

## 六、为什么“第 1/2 次成功，第 3/4 次失败”更像长度/内容波动问题

如果是固定代码 bug，例如：

- SQL 写错
- 表不存在
- 外键永远冲突

那么第 1/2 次就不应该成功。

而现在前两次成功、后两次失败，更符合下面这种模式：

1. 前两次 AI 输出比较短，刚好落在字段上限内。
2. 第三次开始，某些字段变长或格式变脏。
3. 某条 SQL 在事务内报错。
4. 事务整体回滚。
5. 因而库里仍然保留第 2 次成功结果。

### 这条解释与“覆盖行为”完全一致

- 第 2 次覆盖第 1 次：说明成功请求会整批覆盖
- 第 3/4 次失败不留下新结果：说明失败请求没有 commit

---

## 七、当前最不支持的解释

以下解释与现有代码和数据库现状不吻合：

## 7.1 “只有 timeline 写成功，后面的表没成功”

不吻合原因：

- 当前库里 `characters/keyNodes/explosions` 也有数据
- 当前代码使用单事务
- 失败后保留的是旧成功结果，不是“新 timeline + 旧 characters”的混合结果

## 7.2 “第 3/4 次把库写坏了，只是前端没显示”

不吻合原因：

- 当前数据库时间戳仍然是一致的第 2 次成功批次
- `overview` 读出来的也是这一批

---

## 八、当前真正能确定的结论

## 8.1 可以确定的

1. 第 2 次成功结果仍在库里，说明第 3/4 次没有成功提交。
2. 当前代码事务边界是正确包裹的，支持 rollback。
3. 当前现象更像：
   - 事务前失败，或
   - 事务中 SQL 失败后回滚
4. 当前 `novel_skeleton_topic_items=0` 是一个独立且持续存在的问题，但它本身更像“被过滤为空”，不一定就是第 3/4 次失败的主因。

## 8.2 目前还不能确定的

因为当前没有保留下来第 3/4 次失败时的服务端详细日志，所以还**不能精确钉死**是：

- AI JSON 解析失败
- 还是某个 insert 的 `Data too long for column`
- 还是其它 SQL 异常

也就是说：

> 这次可以把“事务是否部分提交”这个问题基本排除，但还不能仅靠现有日志精确还原第 3/4 次的原始异常文本。  

---

## 九、根因排序（基于你新增的运行现象重新排序）

## Top 1：事务内发生数据依赖型 SQL 异常，导致整体回滚

### 现象

- 第 1/2 次成功
- 第 3/4 次报数据库写入错误
- 第 2 次成功结果仍完整保留

### 证据

- `dataSource.transaction(...)`
- 当前库里保留的是完整一致的旧批次
- 多张表存在严格 `varchar` 长度限制
- 服务层没有做长度截断

### 为什么高度可疑

这是最能同时解释：

- “有时报错，有时不报”
- “失败后旧数据还在”
- “看起来像数据库写入阶段出了问题”

---

## Top 2：事务开始前 AI / JSON 解析失败，导致根本没进入写库阶段

### 现象

- 失败后数据库完全不变

### 证据

- `callLcAiApi()` / `parseJsonObjectFromText()` / 顶层 schema 校验都在事务前
- 这些步骤任何一步失败，都会直接抛错

### 为什么排第二

它也能解释“旧数据保留”，但它更像“AI 调用失败”而不太像用户口中的“写入数据库错误”。

---

## Top 3：`skeletonTopicItems` 持续被过滤为空，但它更像并发症，不一定是第 3/4 次失败主因

### 现象

- 当前 `novel_skeleton_topic_items` 始终为 0

### 证据

- `normalizeSkeletonTopicItems()` 会对 `topicKey` 不匹配直接 `continue`
- 当前没有任何插入条目

### 为什么不是第一位

因为它只会导致：

- 成功返回但 `summary.skeletonTopicItems = 0`

而不会直接触发“数据库写入错误”。

---

## Top 4：`explosion_type / faction / category / name / subtitle` 等短字段偶发越界

### 说明

这是 Top 1 的具体子类，单独列出来是为了方便后续修复。

最值得优先盯的短字段：

- `novel_characters.name varchar(100)`
- `novel_characters.faction varchar(50)`
- `novel_key_nodes.category varchar(50)`
- `novel_timelines.time_node varchar(100)`
- `novel_explosions.explosion_type varchar(50)`
- `novel_explosions.subtitle varchar(255)`

---

## Top 5：当前日志严重不足，导致“数据库写入错误”的原文没有被保存下来

### 现象

- 终端检索不到第 3/4 次失败原文
- 现有日志只记录 request endpoint / response status

### 影响

- 事务行为能推断
- 但具体错误点无法直接从日志还原

---

## 十、下一步最小修复清单（只建议，不改代码）

## A. 后端必须先补日志

文件：`apps/api/src/pipeline/pipeline-extract.service.ts`

至少补：

1. `validateAndNormalizeAiResult()` 后记录 5 个数组长度。
2. 每张表 insert 前记录：
   - 本次将写入多少条
3. 每张表 insert catch 时记录：
   - 表名
   - 当前索引
   - 关键字段长度
   - 原始 error.message
4. transaction start / commit / rollback 日志。

## B. 后端必须补字段长度保护

文件：`apps/api/src/pipeline/pipeline-extract.service.ts`

建议对这些字段在入库前做：

- 截断或显式校验
- 超限时抛出带字段名的业务错误

重点字段：

- `timeNode <= 100`
- `name <= 100`
- `faction <= 50`
- `category <= 50`
- `explosionType <= 50`
- `title <= 255`
- `subtitle <= 255`
- `itemTitle <= 255`
- `sourceRef <= 255`

## C. 前端必须把“数据库写入错误”的真实 message 显示完整

文件：`apps/web/src/components/PipelinePanel.tsx`

建议：

- 不只 `alert('生成并写入失败')`
- 而是明确展示：
  - 失败阶段
  - 后端 message
  - 若有字段名，也直接带给用户

## D. 后端必须把 SQL 类错误包装成可读异常

文件：`apps/api/src/pipeline/pipeline-extract.service.ts`

建议：

- 捕获 `QueryFailedError`
- 将 `Data too long for column xxx`、`Incorrect JSON value` 等转成更可读的 `BadRequestException`

---

## 最终结论

### 结论 1

你新增的“第 2 次结果保留，第 3/4 次失败后不变”这个现象，**明显更支持“失败请求没有提交，旧成功数据被保留”**。

### 结论 2

这进一步强化了之前的判断：

- 当前不是“只有 timeline 提交成功，后面没提交”
- 更像“请求在提交前失败”或者“事务内 SQL 报错后整体回滚”

### 结论 3

如果你口中的错误确实是“数据库写入错误”，那么当前最值得优先怀疑的，不是事务本身，而是：

> AI 第 3/4 次生成的数据内容触发了某个字段长度或 SQL 写入约束，而当前服务层没有做长度保护，导致事务回滚，数据库继续保留第 2 次成功结果。  
