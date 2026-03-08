# Pipeline Extract Generate Partial Write Debug Report

## Step 0：基线

### `git status --short`

```text
 M apps/api/src/pipeline/pipeline.controller.ts
 M apps/api/src/pipeline/pipeline.module.ts
 M apps/web/src/components/PipelinePanel.tsx
 M apps/web/src/components/pipeline/SkeletonTopicsPanel.tsx
 M apps/web/src/types/pipeline.ts
?? apps/api/src/pipeline/dto/
?? apps/api/src/pipeline/pipeline-extract.service.ts
?? apps/web/src/components/pipeline/PipelineExtractDialog.tsx
?? apps/web/src/lib/pipeline-ai-api.ts
?? docs/cursor_audit/pipeline_extract_skeleton_and_explosions_ai_dialog_audit_report.md
?? docs/cursor_audit/pipeline_pre_step3_action_bar_audit_report.md
?? docs/cursor_impl/pipeline_extract_skeleton_and_explosions_ai_dialog_report.md
?? docs/cursor_impl/pipeline_pre_step3_action_bar_impl_report.md
```

### `git diff --stat`

```text
 apps/api/src/pipeline/pipeline.controller.ts       |  33 +++-
 apps/api/src/pipeline/pipeline.module.ts           |   3 +-
 apps/web/src/components/PipelinePanel.tsx          | 196 ++++++++++++++++++++-
 apps/web/src/components/pipeline/SkeletonTopicsPanel.tsx |  22 ++-
 apps/web/src/types/pipeline.ts                     |  33 ++++
 5 files changed, 282 insertions(+), 5 deletions(-)
```

### 运行环境

```text
node: v22.17.0
pnpm: 10.28.2
```

---

## Step 1：精确定位调用链（前端 -> 后端）

## 1.1 前端入口

涉及文件：
- `apps/web/src/components/PipelinePanel.tsx`
- `apps/web/src/components/pipeline/PipelineExtractDialog.tsx`
- `apps/web/src/lib/pipeline-ai-api.ts`
- `apps/web/src/lib/api.ts`

### 结论

1. 点击“抽取历史骨架和生成爆点”后，最终调用的是 `PipelinePanel.tsx` 中的 `handlePreStep3Action()`，该函数只做一件事：`void handleOpenExtractDialog()`。
2. 真正提交生成的是 `PipelinePanel.tsx` 中的 `handleSubmitExtract()`。
3. 它最终请求的 API 是：
   - `POST /pipeline/:novelId/extract-and-generate`
4. 前端成功分支会：
   - `await loadOverview()`
   - `setExtractRefreshKey((prev) => prev + 1)`
   - `setExtractDialogOpen(false)`
   - `alert(summary + warnings)`
5. 前端失败分支会：
   - `alert(err?.message || '生成并写入失败')`
6. 当前前端**没有吞掉非 2xx**；`apiClient()` 在 `response.ok === false` 时会直接 `throw new Error(error.message || 'Request failed')`
7. 当前前端**也没有真正的 partial failure 机制**。后端只要返回 `200/201`，前端就当成功处理；不会对“某些数组为空”做额外告警。

### 关键代码：按钮点击入口

```ts
const handlePreStep3Action = () => {
  void handleOpenExtractDialog()
}
```

### 关键代码：真正提交函数

```ts
const handleSubmitExtract = async () => {
  if (!extractSelectedModelKey) {
    alert('请选择 AI 模型')
    return
  }

  try {
    setExtractSubmitting(true)
    const result = await pipelineAiApi.extractAndGenerate(novelId, {
      modelKey: extractSelectedModelKey,
      referenceTables: extractReferenceTables,
      userInstruction: extractUserInstruction || undefined,
      allowPromptEdit: extractAllowPromptEdit,
      promptOverride:
        extractAllowPromptEdit && extractPromptPreview.trim()
          ? extractPromptPreview
          : undefined,
    })

    await loadOverview()
    setExtractRefreshKey((prev) => prev + 1)
    setExtractDialogOpen(false)

    const summary = result.summary
    const warningText = result.warnings?.length
      ? `\n\nwarnings:\n- ${result.warnings.join('\n- ')}`
      : ''

    alert(
      `生成并写入成功\n时间线：${summary.timelines}\n人物：${summary.characters}\n关键节点：${summary.keyNodes}\n骨架主题内容：${summary.skeletonTopicItems}\n爆点：${summary.explosions}${warningText}`
    )
  } catch (err: any) {
    alert(err?.message || '生成并写入失败')
  } finally {
    setExtractSubmitting(false)
  }
}
```

### 关键代码：API 路径

```ts
extractAndGenerate: (novelId: number, payload: PipelineExtractRequest) =>
  apiClient(`/pipeline/${novelId}/extract-and-generate`, {
    method: 'POST',
    body: JSON.stringify(payload),
  }) as Promise<PipelineExtractCommitResponse>,
```

### 关键代码：非 2xx 处理

```ts
export async function apiClient(endpoint: string, options: RequestInit = {}) {
  ...
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }))
    throw new Error(error.message || 'Request failed')
  }

  return response.json()
}
```

### 前端是否存在“后端失败但 UI 没提示”的吞错点

结论：**严格意义上没有吞错点**，因为：
- preview 和 generate 都在 `try/catch`
- 失败会 `alert(err.message)`
- `apiClient` 会对非 2xx 抛错

但有一个真实缺口：
- **后端返回 201 且 summary 中某些计数为 0 时，前端不会把它视为失败**
- 这类“生成成功但部分数组为空”的情况，只会显示 summary 数字，不会额外提示“这可能是异常”

---

## 1.2 后端入口

涉及文件：
- `apps/api/src/pipeline/pipeline.controller.ts`
- `apps/api/src/pipeline/pipeline-extract.service.ts`
- `apps/api/src/pipeline/dto/pipeline-extract.dto.ts`

### 结论

1. `POST /pipeline/:novelId/extract-and-generate` 实际进入：
   - `PipelineController.extractAndGenerate()`
   - 再进入 `PipelineExtractService.extractAndGenerate()`
2. service 主流程顺序是：
   - 校验 novel 存在
   - 校验 modelKey
   - 解析 referenceTables
   - 构造 prompt
   - 调外部 AI
   - 解析 AI JSON
   - 读取启用中的 `novel_skeleton_topics`
   - 执行 `validateAndNormalizeAiResult()`
   - 执行 `persistGeneratedData()` 单事务写库
   - 返回 `ok + summary + warnings`
3. 明确存在“先 timeline，再写后续表”的顺序。
4. 明确存在事务，事务边界在 `persistGeneratedData()` 内部。
5. 从代码路径上看，**不存在“部分写入成功但整体未报错”的事务级路径**；但存在“某些数组在写入前被清洗成空，事务照样成功提交”的路径。

### Controller 入口代码

```ts
@Post(':novelId/extract-and-generate')
extractAndGenerate(
  @Param('novelId', ParseIntPipe) novelId: number,
  @Body() dto: PipelineExtractDto,
) {
  return this.pipelineExtractService.extractAndGenerate(novelId, dto);
}
```

### Service 主流程代码

```ts
async extractAndGenerate(
  novelId: number,
  dto: PipelineExtractDto,
): Promise<PipelineExtractCommitResponse> {
  await this.assertNovelExists(novelId);
  const usedModelKey = await this.resolveModelKey(dto.modelKey);
  const referenceTables = this.resolveReferenceTables(dto.referenceTables);
  const promptPreview =
    dto.allowPromptEdit && dto.promptOverride?.trim()
      ? dto.promptOverride.trim()
      : await this.buildPrompt(novelId, referenceTables, dto.userInstruction);

  const aiJson = await this.callLcAiApi(usedModelKey, promptPreview);
  const topicMap = await this.getEnabledSkeletonTopicMap(novelId);
  const { normalized, warnings } = this.validateAndNormalizeAiResult(aiJson, topicMap);
  const summary = await this.persistGeneratedData(novelId, normalized, topicMap);

  return {
    ok: true,
    summary,
    warnings: warnings.length ? warnings : undefined,
  };
}
```

---

## Step 2：核查数据库写入流程是否真的是“单事务”

### 事务代码

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

### 逐条结论

1. 当前是否真的使用了单事务  
   - **满足**
   - 使用的是 `dataSource.transaction(async (manager) => ...)`

2. 所有 delete + insert 是否都在同一个事务里  
   - **满足**

3. 5 张目标表是否全部在同一个事务回调里执行  
   - **满足**
   - `novel_timelines / novel_characters / novel_key_nodes / novel_skeleton_topic_items / novel_explosions` 都走同一个 `manager`

4. 是否有任何写库 SQL 在事务外执行  
   - **不满足“有事务外写库”**
   - 当前写库 SQL 都在事务回调内部

5. 如果某张表插入失败，理论上会怎样  
   - **整体回滚**
   - 代码没有 `try/catch` 吃掉 transaction 内的异常
   - 因此 SQL 异常会向外抛出并回滚事务

### 核心结论

当前代码从事务边界上看，**不是“timeline 写成功，后面 insert 失败但照样 commit”的结构**。  
如果真出现“只有 timeline 留在库里”，更像：
- 当次请求并未走当前这版代码
- 或观察的不是同一 `novel_id`
- 或是 AI 返回的其他数组在进入事务前就已经被清洗为空

---

## Step 3：核查 AI 返回结构到多表写入的映射过程

## 3.1 AI 返回 JSON schema 解析入口

入口在：
- `callLcAiApi()`
- `parseJsonObjectFromText()`
- `validateAndNormalizeAiResult()`

核心代码：

```ts
const aiJson = await this.callLcAiApi(usedModelKey, promptPreview);
const topicMap = await this.getEnabledSkeletonTopicMap(novelId);
const { normalized, warnings } = this.validateAndNormalizeAiResult(aiJson, topicMap);
const summary = await this.persistGeneratedData(novelId, normalized, topicMap);
```

## 3.2 顶层字段校验方式

```ts
const requiredKeys = [
  'timelines',
  'characters',
  'keyNodes',
  'skeletonTopicItems',
  'explosions',
] as const;

for (const key of requiredKeys) {
  if (!(key in aiJson) || !Array.isArray(aiJson[key])) {
    throw new BadRequestException(`AI result field "${key}" must be an array`);
  }
}
```

结论：
- 顶层字段缺失或不是数组时，会直接报错
- 不会静默跳过

## 3.3 各数组项为空/字段错/必填缺失时如何处理

### `timelines`

```ts
if (!timeNode || !event) {
  warnings.push('Dropped timeline item because timeNode/event is empty');
  continue;
}
```

结论：
- 单条不合规：丢弃 + warning
- 顶层数组可以最终变空：不会抛错

### `characters`

```ts
if (!name) {
  warnings.push('Dropped character because name is empty');
  continue;
}
```

结论：
- 单条缺 `name`：丢弃 + warning
- 全部被丢弃后：最终 `characters=[]`，不会抛错

### `keyNodes`

```ts
if (!title) {
  warnings.push('Dropped keyNode because title is empty');
  continue;
}
const category = this.normalizeText(item.category) || '未分类';
```

结论：
- 缺 `title`：丢弃 + warning
- 缺 `category`：不会报错，会回填 `未分类`

### `skeletonTopicItems`

```ts
if (!topicKey) {
  warnings.push('Dropped skeletonTopicItems group because topicKey is empty');
  continue;
}
if (!topicMap.has(normalizedTopicKey)) {
  warnings.push(`Dropped skeletonTopicItems group because topicKey does not exist: ${topicKey}`);
  continue;
}
if (!Array.isArray(group.items)) {
  warnings.push(`Dropped skeletonTopicItems group because items is not an array: ${topicKey}`);
  continue;
}
...
if (!hasUsefulContent) {
  warnings.push(`Dropped empty skeleton item under topicKey ${topicKey}`);
  continue;
}
```

结论：
- **这是当前最容易被整体丢空的表**
- 只要：
  - `topicKey` 不存在
  - `topicKey` 大小写/内容不匹配
  - `items` 不是数组
  - item 全为空
- 都会被静默过滤为 0，最后事务仍成功

### `explosions`

```ts
if (!explosionType || !title) {
  warnings.push('Dropped explosion because explosionType/title is empty');
  continue;
}
```

结论：
- 不合规项会被丢弃 + warning
- 最终可以是空数组，但不会报错

## 3.4 是否存在以下问题

1. `characters` 被解析为空数组  
   - **存在可能**
   - 如果 AI 返回的每个角色都缺 `name` 或被去重后为空

2. `keyNodes` 被解析为空数组  
   - **存在可能**
   - 如果每项都缺 `title`

3. `skeletonTopicItems.topicKey` 找不到映射，导致全部被丢弃  
   - **高度存在**
   - 这是当前最可疑路径

4. `explosions` 因字段不合规被过滤掉  
   - **存在可能**
   - 如果缺 `explosionType` 或 `title`

## 3.5 这些过滤/丢弃是否反馈给前端

结论：
- **理论上会通过 `warnings` 返回给前端**
- 但前提是：
  - 后端确实生成了 `warnings`
  - 前端用户看到了成功后的 `alert`

相关代码：

```ts
return {
  ok: true,
  summary,
  warnings: warnings.length ? warnings : undefined,
};
```

以及前端：

```ts
const warningText = result.warnings?.length
  ? `\n\nwarnings:\n- ${result.warnings.join('\n- ')}`
  : ''
```

但如果：
- AI 直接返回空数组
- 而不是“不合法数据被过滤”

那么就**不会有 warning**，前端只会看到某些 summary 为 0。

---

## Step 4：只读核查数据库现状

## 4.1 `COUNT(*)` 统计（`novel_id = 1`）

```text
novel_timelines             6
novel_characters            5
novel_key_nodes             4
novel_skeleton_topic_items  0
novel_explosions            3
novel_skeleton_topics       2
```

### 结论

当前数据库现状**不是“只有 `novel_timelines` 有新增”**。  
按当前库中数据：
- `novel_timelines` 有数据
- `novel_characters` 有数据
- `novel_key_nodes` 有数据
- `novel_explosions` 有数据
- 只有 `novel_skeleton_topic_items` 为 `0`

## 4.2 抽样查询摘要

### `novel_timelines`
- 当前共 6 条
- 均为 `2026-03-08 10:43:31` 同批次写入
- `sort_order = 0..5`

### `novel_characters`
- 当前共 5 条
- 均为 `2026-03-08 10:43:31` 同批次写入
- 人物示例：
  - 朱元璋（朱重八）
  - 朱五四
  - 陈氏
  - 刘德
  - 脱脱

### `novel_key_nodes`
- 当前共 4 条
- 均为 `2026-03-08 10:43:31` 同批次写入

### `novel_explosions`
- 当前共 3 条
- 均为 `2026-03-08 10:43:31` 同批次写入

### `novel_skeleton_topic_items`
- 当前 **0 条**

### `novel_skeleton_topics`

```text
id  novel_id  topic_key  topic_name              topic_type  is_enabled
2   1         topic      靖难之役过程分析         text       1
4   1         topic_2    靖难之役失败原因分析     text       1
```

### 结论

1. `topicKey -> topic_id` 映射数据是存在的
2. 当前问题更接近：
   - 不是所有后续表都没写
   - 而是 `novel_skeleton_topic_items` 没写进去

---

## Step 5：核查 overview 回显链路

涉及文件：
- `apps/api/src/pipeline/pipeline.service.ts`
- `apps/web/src/lib/api.ts`
- `apps/web/src/components/PipelinePanel.tsx`
- `apps/web/src/components/pipeline/SkeletonTopicsPanel.tsx`

## 5.1 `loadOverview()` 是否在生成成功后调用

**是。**

```ts
const result = await pipelineAiApi.extractAndGenerate(...)

await loadOverview()
setExtractRefreshKey((prev) => prev + 1)
setExtractDialogOpen(false)
```

## 5.2 `GET /pipeline/:novelId/overview` 是否真的读取这些数据

**是。**

```ts
const timelines = await this.selectByNovel('novel_timelines', 't', novelId);
const characters = await this.selectByNovel('novel_characters', 'c', novelId);
const keyNodes = await this.selectByNovel('novel_key_nodes', 'k', novelId);
const explosions = await this.selectByNovel('novel_explosions', 'e', novelId);
...
const topics = await this.selectByNovel('novel_skeleton_topics', 'st', novelId, ...);
const topicItems = await this.selectByNovel('novel_skeleton_topic_items', 'si', novelId, ...);
...
return {
  timelines,
  characters,
  keyNodes,
  explosions,
  skeletonTopics,
  worldview: ...
};
```

## 5.3 当前 `4000` 端口实际 overview 返回

只读请求结果显示：
- `timelines` 有 6 条
- `characters` 有 5 条
- `keyNodes` 有 4 条
- `explosions` 有 3 条
- `skeletonTopics` 有 2 条 topic
- 但两个 topic 的 `items` 都是空数组

### 结论

当前并不是：
- “数据库写了但 overview 没读出来”

而是：
- `overview` 读出了 `timelines / characters / keyNodes / explosions`
- `skeletonTopicItems` 本身就确实是 0，所以 `skeletonTopics.items=[]`

## 5.4 当前是否存在 `SkeletonTopicsPanel` 只刷新“已展开项”

**是。**

```ts
useEffect(() => {
  const refresh = async () => {
    await loadTopics()

    const expandedTopicIds = Object.entries(expandedTopics)
      .filter(([, expanded]) => expanded)
      .map(([topicId]) => Number(topicId))
      .filter((topicId) => Number.isInteger(topicId) && topicId > 0)

    for (const topicId of expandedTopicIds) {
      await loadItems(topicId)
    }
  }

  if (refreshKey > 0) {
    void refresh()
  }
}, [refreshKey])
```

因此：
- 如果用户没有展开某个 topic
- 页面上只会看到“骨架主题抽取结果（Topic Items）请在上方 Expand Items 查看”
- 容易误以为“没写入”

不过在本次当前数据库里，`topic items` 真实也确实是 0。

---

## Step 6：日志与错误处理缺口

## 6.1 后端当前已有日志

仅看到两类：

```ts
console.log(`[pipeline:extract] request endpoint=${endpoint} model=${modelKey}`);
console.log(
  `[pipeline:extract] response status=${response.status} contentType=${contentType}`,
);
```

实际日志文件中也只有：

```text
[pipeline:extract] request endpoint=https://s.lconai.com/v1/chat/completions model=gpt-4o
[pipeline:extract] response status=200 contentType=application/json
```

## 6.2 当前缺失的关键日志

后端**没有记录**：
- prompt preview 长度
- AI 原始返回摘要
- 每个顶层数组的条数
- 每张表 delete 条数
- 每张表 insert 条数
- `topicKey` 映射失败明细
- transaction start / commit / rollback
- warnings 明细

## 6.3 后端异常处理方式

当前异常路径主要是：
- `BadRequestException`
- `InternalServerErrorException`
- `NotFoundException`

这些异常会直接向上抛出，Nest 会返回 HTTP 错误，不存在 service 内显式吞错。

因此：
- **异常不会被吃掉**
- 但**“过滤后变空数组”不是异常**，因此不会触发错误提示

## 6.4 前端错误处理

失败时：

```ts
} catch (err: any) {
  alert(err?.message || '生成并写入失败')
} finally {
  setExtractSubmitting(false)
}
```

非 2xx 的 message 来源于：

```ts
if (!response.ok) {
  const error = await response.json().catch(() => ({ message: 'Request failed' }))
  throw new Error(error.message || 'Request failed')
}
```

### 结论

1. 调用失败时，前端会直接显示后端 `message`
2. 成功时，前端会显示 `summary` 和 `warnings`
3. 但当前**最缺的不是失败提示，而是成功但结果异常偏空时的诊断提示**
4. 当前不存在“请求失败但 loading 结束后无明显提示”的路径

---

## Step 7：根因 Top 5（按概率排序）

## 1. 并不是“只有 timeline 写入”，而是当前实际问题集中在 `novel_skeleton_topic_items`
- 现象：
  - 数据库中 `timelines=6 / characters=5 / keyNodes=4 / explosions=3`
  - 只有 `novel_skeleton_topic_items=0`
- 证据：
  - 只读 SQL `COUNT(*)`
  - `GET /pipeline/1/overview` 的真实返回
- 为什么会造成误判：
  - Step1 UI 对 skeleton items 不直接平铺，只提示用户去 `SkeletonTopicsPanel` 展开查看
  - 用户很容易把“items 没显示”理解成“除了 timeline 都没写”

## 2. `skeletonTopicItems.topicKey` 映射失败被静默过滤，是当前最可能的真实根因
- 现象：
  - `novel_skeleton_topics` 有 2 个启用 topic
  - `novel_skeleton_topic_items` 却是 0
- 证据：
  - `normalizeSkeletonTopicItems()` 中只要 `topicKey` 不存在于 `topicMap`，就直接 `continue`
  - 不会抛错
- 为什么会导致“看起来没写”：
  - 整体请求仍返回 success
  - 事务照常 commit
  - 前端只看到 summary，若用户没注意 `skeletonTopicItems=0` 或 warning，就会误以为无明确错误提示

## 3. 各数组被清洗成空不会被当作错误，只会当作“成功但条数为 0”
- 现象：
  - `characters/keyNodes/explosions/skeletonTopicItems` 只要进入 normalize 后全空，依旧会成功返回
- 证据：
  - `validateAndNormalizeAiResult()` 只要求顶层字段存在且为数组
  - 不要求每个数组最终必须非空
- 为什么会导致“前端没收到明确错误提示”：
  - 因为后端没有抛错
  - 前端就只会显示 summary，不会弹失败 alert

## 4. 当前日志粒度太粗，无法从服务端直接看出是哪张表被清空/跳过
- 现象：
  - 日志仅有 request endpoint / model / response status / content-type
- 证据：
  - 日志文件只出现两行 `[pipeline:extract] ...`
- 为什么会导致排查困难：
  - 无法直接看到
    - AI 顶层数组长度
    - `warnings`
    - topicKey mapping 失败明细
    - 每张表 insert 条数

## 5. UI 对 skeleton items 的展示方式会放大“没写入”的主观感受
- 现象：
  - `PipelinePanel` 不直接渲染 skeleton items 列表
  - 只提示“请在上方 Expand Items 查看”
- 证据：
  - Step1 JSX 中这一块只是提示文案
  - `SkeletonTopicsPanel` 还要求 topic 已展开才会自动刷新 items
- 为什么会导致误解：
  - 即使写入成功，用户也未必第一眼看到
  - 更何况本次当前库里 skeleton items 真是 0，更容易被认为整个链路只写了 timeline

---

## Step 8：下一步最小修复清单（仅建议）

## A. 后端日志必须补哪些点

### `apps/api/src/pipeline/pipeline-extract.service.ts`
- 在 `extractAndGenerate()` 中记录：
  - `promptPreview.length`
  - `referenceTables`
  - `topicMap.size`
  - normalize 后 5 个数组长度
- 在 `persistGeneratedData()` 中记录：
  - transaction start
  - delete 完成
  - 各表 insert 条数
  - commit / rollback
- 在 `normalizeSkeletonTopicItems()` 中记录：
  - 被丢弃的 `topicKey`
  - `items` 为空的 topicKey

## B. 后端错误必须如何抛

### `apps/api/src/pipeline/pipeline-extract.service.ts`
- 当 normalize 后出现明显异常时，建议提升为错误而不是成功：
  - 例如 `timelines.length > 0` 但其余四类全空
  - 或 `topicMap.size > 0` 且 `skeletonTopicItems.length === 0`
- 至少应该在响应里明确加：
  - `warnings`
  - `debugSummary`

### `apps/api/src/pipeline/pipeline.controller.ts`
- 不需要改路由结构
- 但建议统一把 service 抛出的业务异常 message 原样返回，避免模糊文案

## C. 前端必须如何提示用户

### `apps/web/src/components/PipelinePanel.tsx`
- 成功提示不能只显示 summary
- 当某些关键数组为 0 时，应该明确提示：
  - “本次未生成人物”
  - “本次未生成骨架主题内容”
- 对 `warnings` 建议做更显眼展示，而不只是拼在 alert 最后

### `apps/web/src/lib/pipeline-ai-api.ts`
- 不需要大改
- 但建议后续支持拿到更丰富的后端响应结构，例如 `warnings/debugSummary`

### `apps/web/src/components/pipeline/SkeletonTopicsPanel.tsx`
- 生成成功后可考虑提示：
  - “如需查看骨架主题内容，请展开 topic items”
- 避免用户误认为没写入

---

## 最终结论

### 1. 是否真的单事务
**是。**

原因：
- 当前 delete + 5 张表 insert 全部包在同一个 `dataSource.transaction(async (manager) => ...)` 内
- 从代码结构上，不支持“timeline 提交成功、后续 insert 失败但仍然 commit”的事务级部分提交

### 2. 当前数据库是否支持“只有 timeline 写入”这个说法
**不支持。**

按当前 `novel_id = 1` 的真实数据：
- `novel_timelines` 有数据
- `novel_characters` 有数据
- `novel_key_nodes` 有数据
- `novel_explosions` 有数据
- 只有 `novel_skeleton_topic_items` 为 0

### 3. 当前最可能的真实问题
**`novel_skeleton_topic_items` 在 normalize / topicKey 映射阶段被整体过滤成空，而这条路径不会报错，只会成功返回。**
