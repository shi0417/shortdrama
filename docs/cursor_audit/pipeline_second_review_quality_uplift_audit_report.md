# Pipeline Second Review 质量增强只读审计报告

## 审计范围
- 仓库：`D:/project/duanju/shortdrama`
- 本次目标：只读审计当前 `pipeline second review` 的质量规则现状，不修改任何业务代码
- 重点检查文件：
  - `apps/api/src/pipeline/pipeline-review.service.ts`
  - `apps/api/src/pipeline/dto/pipeline-second-review.dto.ts`
  - `apps/api/src/pipeline/pipeline.controller.ts`

## 结论摘要
- 当前 `review prompt` 已经具备基础方向性约束，但**还没有**对 `novel_characters`、`novel_skeleton_topic_items`、`novel_explosions` 写出足够“硬”的细化规则。
- 当前 `reviewNotes` 已要求输出 `issue/fix`，但**没有强制**这 3 张重点表写出更具体的修正说明。
- 当前程序级 normalize 几乎只做了：
  - 判空
  - 去重
  - 基础字段归一
- 当前**没有**针对 `沈昭/沈照` 这种别名统一的程序级兜底。
- 当前**没有**针对 `explosions` “摘要化/模板化”的程序级质量兜底。
- 当前对 `skeletonTopicItems` 虽有 prompt 级“围绕 topic 定义”的提示，但**没有**程序级弱质量识别，也没有把 `list/text` 型 topic 的输出要求写硬。

## 文件链路

### Controller 入口
`apps/api/src/pipeline/pipeline.controller.ts`

```ts
@Post(':novelId/review-preview-prompt')
previewReviewPrompt(
  @Param('novelId', ParseIntPipe) novelId: number,
  @Body() dto: PipelineSecondReviewDto,
) {
  return this.pipelineReviewService.previewPrompt(novelId, dto);
}

@Post(':novelId/review-and-correct')
reviewAndCorrect(
  @Param('novelId', ParseIntPipe) novelId: number,
  @Body() dto: PipelineSecondReviewDto,
) {
  return this.pipelineReviewService.reviewAndCorrect(novelId, dto);
}
```

### DTO 结构
`apps/api/src/pipeline/dto/pipeline-second-review.dto.ts`

```ts
export class PipelineSecondReviewDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  modelKey?: string;

  @IsArray()
  @ArrayUnique()
  @IsIn(allowedSecondReviewTargetTables, { each: true })
  targetTables!: PipelineSecondReviewTargetTable[];

  @IsArray()
  @ArrayUnique()
  @IsIn(allowedSecondReviewReferenceTables, { each: true })
  referenceTables!: PipelineSecondReviewReferenceTable[];

  @IsOptional()
  @IsString()
  userInstruction?: string;

  @IsOptional()
  @IsBoolean()
  allowPromptEdit?: boolean;

  @IsOptional()
  @IsString()
  promptOverride?: string;
}
```

说明：
- 当前 DTO 只负责模型、目标表、参考表、用户附加要求、prompt 编辑控制。
- 质量增强相关规则目前都在 `buildReviewPrompt(...)` 和后端 normalize 逻辑里，不在 DTO 层。

## 当前 review prompt 原样关键片段

`apps/api/src/pipeline/pipeline-review.service.ts`

```ts
const rulesBlock = [
  '【二次AI自检目标】',
  '你不是重新裸生成，而是基于当前数据库中已经生成的结构化结果进行二次审查和纠偏。',
  '请重点完成：核对、补漏、去重、纠偏、强化短剧爆点质量，并让 skeletonTopicItems 真正围绕 topic 定义。',
  '',
  '【自检规则】',
  '1. 对于未被选中的 targetTables，请返回空数组，不要输出新内容。',
  '2. 对于被选中的 targetTables，请输出修正后的完整数组，后端会覆盖写回所选表。',
  '3. timelines 要检查顺序、缺漏、重复。',
  '4. characters 要检查核心人物补漏、去重、阵营统一。',
  '5. keyNodes 要检查是否覆盖关键阶段、标题是否重复。',
  '6. skeletonTopicItems 必须严格围绕系统提供的 topic 定义，不允许泛泛复述 source_text。',
  '7. explosions 要更像短剧爆点，而不是普通摘要。',
  '8. reviewNotes 用于说明本次发现的问题与修正动作。',
  '9. reviewNotes.table 必须使用数据库目标表全名之一：novel_timelines、novel_characters、novel_key_nodes、novel_skeleton_topic_items、novel_explosions。',
  '',
  '【输出要求】',
  '1. 必须输出严格 JSON。',
  '2. 顶层必须包含：timelines、characters、keyNodes、skeletonTopicItems、explosions、reviewNotes。',
  '3. 所有数组字段都必须存在，即使为空也必须返回空数组。',
  '4. reviewNotes 元素格式：{ "table": "字符串", "issue": "字符串", "fix": "字符串" }',
].join('\n');
```

### 审计判断
- 已有的强项：
  - 已经明确：不是重生，而是二次审查/纠偏
  - 已经点到了三张重点表的方向
  - 已经限制 `reviewNotes.table` 必须用数据库目标表全名
- 目前的不足：
  - `characters` 只写到“补漏、去重、阵营统一”，**没有**写硬：
    - 核心人物层级
    - 别名统一
    - faction 规范集合
    - description 的剧情功能性
    - settingWords 生成价值
  - `skeletonTopicItems` 只写到“围绕 topic 定义、不要复述”，**没有**写硬：
    - `list` 型必须拆条
    - `text` 型必须集中作答
    - item 必须具备分析/提炼价值
    - itemTitle 不能是“原因一/阶段一”
  - `explosions` 只写到“更像短剧爆点”，**没有**写硬：
    - 至少两项冲突元素
    - 标题短剧化
    - `sceneRestoration` 的画面要求
    - `dramaticQuality` 的“为什么有戏”
    - `adaptability` 的短剧可拍性说明

## reviewNotes 输出要求现状

当前 schema 片段：

```ts
'  "reviewNotes": [',
'    { "table": "必须是 novel_timelines/novel_characters/novel_key_nodes/novel_skeleton_topic_items/novel_explosions 之一", "issue": "字符串", "fix": "字符串" }',
'  ]',
```

### 审计判断
- 当前 `reviewNotes` 已经要求 `issue/fix`，比早期只靠 fallback 好很多。
- 但目前仍然是**宽泛 issue/fix**，没有对以下 3 张表增加更具体的说明要求：
  - `novel_characters`
    - 补了哪些人物
    - 统一了哪些别名
    - 规范了哪些 faction
  - `novel_skeleton_topic_items`
    - 哪些 topic 之前过于摘要化
    - 现在如何改成围绕 topic 定义的提炼结果
  - `novel_explosions`
    - 哪些爆点原来太平
    - 现在加强了哪些冲突/反转/画面感/传播钩子

结论：
- 当前 `reviewNotes` 已可用，但还不够“硬”，还不够适合作为下一轮质量增强的证据载体。

## validateAndNormalizeReviewResult(...) 现状

```ts
const timelines = this.normalizeTimelines(aiJson.timelines as unknown[], warnings);
const characters = this.normalizeCharacters(aiJson.characters as unknown[], warnings);
const keyNodes = this.normalizeKeyNodes(aiJson.keyNodes as unknown[], warnings);
const skeletonTopicItems = this.normalizeSkeletonTopicItems(
  aiJson.skeletonTopicItems as unknown[],
  topicMap,
  warnings,
);
const explosions = this.normalizeExplosions(aiJson.explosions as unknown[], warnings);
const rawReviewNotes = Array.isArray(aiJson.reviewNotes) ? (aiJson.reviewNotes as unknown[]) : [];
const { reviewNotes, diagnostics: noteDiagnostics } = this.normalizeReviewNotes(
  rawReviewNotes,
  targetTables,
  warnings,
);
```

### 审计判断
- 当前主流程已经很稳：
  - 顶层数组校验
  - 各表 normalize
  - `reviewNotes` 标准化和表名映射
- 但“质量增强”的缺口不在这里的架构，而在：
  - `buildReviewPrompt(...)` 规则不够具体
  - 各 normalize 函数缺少轻量质量兜底与统计

## normalizeReviewNotes(...) 现状

```ts
const rawTable = this.normalizeText(item.table);
const table = this.normalizeReviewNoteTableName(rawTable);
const issue = this.normalizeText(item.issue);
const fix = this.normalizeText(item.fix);
```

```ts
if (!rawTable || !issue || !fix) {
  warnings.push('Dropped reviewNote because table/issue/fix is empty');
  droppedCount += 1;
  continue;
}
```

### 审计判断
- 当前逻辑已经保证：
  - `reviewNotes` 不会再因短表名被误丢
  - `issue/fix` 为空会被丢弃
- 但这里**没有**检查：
  - `issue/fix` 是否过于空泛
  - 重点表的 `issue/fix` 是否足够具体

结论：
- `normalizeReviewNotes(...)` 负责“可用性”，不负责“高质量具体性”。

## 三张重点表的程序级规则现状

## 1. characters

当前 normalize：

```ts
private normalizeCharacters(items: unknown[], warnings: string[]): CharacterInput[] {
  const seen = new Set<string>();
  const result: CharacterInput[] = [];

  for (const raw of items) {
    const item = this.asRecord(raw);
    const name = this.normalizeText(item.name);
    if (!name) {
      warnings.push('Dropped character because name is empty');
      continue;
    }
    const dedupeKey = this.normalizeComparableText(name);
    if (seen.has(dedupeKey)) {
      warnings.push(`Dropped duplicate character: ${name}`);
      continue;
    }
    seen.add(dedupeKey);
    result.push({
      name,
      faction: this.normalizeText(item.faction),
      description: this.normalizeText(item.description),
      personality: this.normalizeText(item.personality),
      settingWords: this.normalizeText(item.settingWords),
    });
  }

  return result;
}
```

### 审计判断
- 现在已有：
  - 判空
  - 以 `name` 为键去重
  - 基础字段归一化
- 现在缺失：
  - 没有别名统一逻辑
  - `沈昭/沈照` 会被原样保留，不会拆成主名 + 别名说明
  - 没有 faction 规范化
  - 没有 description/personality/settingWords 的弱质量检查

结论：
- **当前没有针对 `沈昭/沈照` 这种别名统一的程序级兜底。**

## 2. skeletonTopicItems

当前 normalize：

```ts
private normalizeSkeletonTopicItems(
  items: unknown[],
  topicMap: Map<string, { id: number; topicKey: string }>,
  warnings: string[],
): SkeletonTopicItemGroupInput[] {
  const result: SkeletonTopicItemGroupInput[] = [];

  for (const raw of items) {
    const group = this.asRecord(raw);
    const topicKey = this.normalizeText(group.topicKey).toLowerCase();
    if (!topicKey) {
      warnings.push('Dropped skeletonTopicItems group because topicKey is empty');
      continue;
    }
    if (!topicMap.has(topicKey)) {
      warnings.push(`Dropped skeletonTopicItems group because topicKey does not exist: ${topicKey}`);
      continue;
    }
    if (!Array.isArray(group.items)) {
      warnings.push(`Dropped skeletonTopicItems group because items is not an array: ${topicKey}`);
      continue;
    }

    const normalizedItems: SkeletonTopicItemInput[] = [];
    for (const rawItem of group.items) {
      const item = this.asRecord(rawItem);
      const itemTitle = this.normalizeText(item.itemTitle);
      const content = this.normalizeText(item.content);
      const sourceRef = this.normalizeText(item.sourceRef);
      const contentJson = this.normalizeJsonValue(item.contentJson);

      if (!itemTitle && !content && !sourceRef && contentJson === null) {
        warnings.push(`Dropped empty skeleton item under topicKey ${topicKey}`);
        continue;
      }

      normalizedItems.push({
        itemTitle,
        content,
        contentJson,
        sourceRef,
      });
    }

    result.push({ topicKey, items: normalizedItems });
  }

  return result;
}
```

### 审计判断
- 现在已有：
  - `topicKey` 存在性校验
  - topic 必须存在于当前 enabled topic map
  - `items` 必须为数组
  - 空 item 丢弃
- 现在缺失：
  - 没有利用 `topicType`
  - 没有利用 `topicName`
  - 没有利用 `description`
  - 没有 `list` 型拆条要求的程序级兜底
  - 没有 `text` 型聚焦作答的程序级兜底
  - 没有“摘要化/空泛标题”的弱质量告警

结论：
- **当前确实有 prompt 级“围绕 topic 定义抽取”的提示。**
- 但**没有**把这件事做成程序级强校验或弱质量检测。

## 3. explosions

当前 normalize：

```ts
private normalizeExplosions(items: unknown[], warnings: string[]): ExplosionInput[] {
  const seen = new Set<string>();
  const result: ExplosionInput[] = [];

  for (const raw of items) {
    const item = this.asRecord(raw);
    const explosionType = this.normalizeText(item.explosionType);
    const title = this.normalizeText(item.title);
    if (!explosionType || !title) {
      warnings.push('Dropped explosion because explosionType/title is empty');
      continue;
    }
    const dedupeKey = `${this.normalizeComparableText(explosionType)}::${this.normalizeComparableText(title)}`;
    if (seen.has(dedupeKey)) {
      warnings.push(`Dropped duplicate explosion: ${title}`);
      continue;
    }
    seen.add(dedupeKey);
    result.push({
      explosionType,
      title,
      subtitle: this.normalizeText(item.subtitle),
      sceneRestoration: this.normalizeText(item.sceneRestoration),
      dramaticQuality: this.normalizeText(item.dramaticQuality),
      adaptability: this.normalizeText(item.adaptability),
      timelineRef: this.normalizeText(item.timelineRef),
    });
  }

  return result;
}
```

### 审计判断
- 现在已有：
  - 判空
  - 去重
  - 基础字段归一
- 现在缺失：
  - 没有检查是否“像爆点还是像摘要”
  - 没有检查 `dramaticQuality` / `adaptability` 是否过短或空泛
  - 没有检查 `sceneRestoration` 是否具有角色/动作/冲突

结论：
- **当前没有针对 explosions “摘要化/模板化”的程序级兜底。**
- 目前主要依赖 prompt 文本中的一句“更像短剧爆点，而不是普通摘要”。

## persistReviewedData(...) 现状

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
    existingNotesIndex.get(this.buildCharacterRevisionKey(item.name)),
    revisionNotes,
    tableDetails,
  ),
)
```

### 审计判断
- 当前事务写库、`revision_notes_json` 历史累计、`reviewNotes.table` 映射链路都已经稳定。
- 这意味着本轮“质量增强”最适合做在：
  - `buildReviewPrompt(...)`
  - `normalizeCharacters(...)`
  - `normalizeSkeletonTopicItems(...)`
  - `normalizeExplosions(...)`
  - 成功日志摘要

而不是重动事务写库结构。

## 对用户问题的直接回答

### 1. 当前 review prompt 中，是否已经对 characters / skeletonTopicItems / explosions 做了强规则约束？
**没有。**

现状是：
- 有方向性约束
- 没有足够细的强规则约束

### 2. 当前 reviewNotes 是否要求 AI 返回具体修正说明，还是只是宽泛 issue/fix？
**目前还是宽泛 `issue/fix`。**

虽然已有结构化约束，但还没有把这 3 张重点表的修正说明写得足够具体。

### 3. 当前是否有针对 沈昭/沈照 这种别名统一的程序级兜底？
**没有。**

### 4. 当前是否有针对 explosions “摘要化/模板化”的程序级或 prompt 级约束？
**有 prompt 级弱约束，没有程序级兜底。**

现有 prompt 只有：
- `explosions 要更像短剧爆点，而不是普通摘要`

### 5. 当前是否有针对 skeletonTopicItems “围绕 topic 定义抽取”的强提示？
**有 prompt 级提示，但不够强，且没有程序级兜底。**

现有 prompt 只有：
- `skeletonTopicItems 必须严格围绕系统提供的 topic 定义，不允许泛泛复述 source_text`

## 缺口清单

### characters
- 缺少“核心角色层级覆盖”要求
- 缺少“别名统一”要求
- 缺少“faction 规范化”要求
- 缺少“description 要体现剧情功能”要求
- 缺少“settingWords 适合后续生成”要求
- 缺少轻量别名程序兜底

### skeletonTopicItems
- 缺少 `topicType=list` 必须拆条的强规则
- 缺少 `topicType=text` 必须聚焦作答的强规则
- 缺少“每条 item 必须有分析/提炼价值”的强规则
- 缺少“itemTitle 不能空泛”的强规则
- 缺少程序级“弱质量告警”

### explosions
- 缺少“至少两项冲突元素”的强规则
- 缺少“title 必须短剧化”的强规则
- 缺少“sceneRestoration 要有角色/动作/场景/冲突”的强规则
- 缺少“dramaticQuality / adaptability 为什么有戏/为什么适合短剧”的强规则
- 缺少程序级“过短/空泛”的弱质量告警

### reviewNotes
- 缺少针对这 3 张重点表的“具体修了什么”的输出要求

## 最小可改动点建议

### 最优先改动
文件：`apps/api/src/pipeline/pipeline-review.service.ts`

最小切入点：
- `buildReviewPrompt(...)`
- `normalizeCharacters(...)`
- `normalizeSkeletonTopicItems(...)`
- `normalizeExplosions(...)`
- review 成功日志摘要

### 建议改法
- 先用 prompt 把 3 张重点表的规则写硬
- 再加轻量程序兜底
- 不改 extract
- 不改事务写库
- 不改前端 UI 结构

## 最终结论
- 当前第二轮 review 链路已经是“可用且稳定”的，但它的质量增强能力仍然偏“方向性提示”。
- 这次如果要做质量增强，**最小且最稳的改法**就是：
  - 只增强 `buildReviewPrompt(...)`
  - 对 `characters / skeletonTopicItems / explosions` 增加少量程序级弱质量兜底
  - 增加几项清晰日志
- 这和你给出的下一阶段方案完全一致，且不需要重做整条链路。
