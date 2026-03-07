# set_core AI 完善质量与落库闭环审计报告

## 审计范围
- 前端
  - `apps/web/src/components/PipelinePanel.tsx`
  - `apps/web/src/components/pipeline/SetCoreEditor.tsx`
  - `apps/web/src/components/pipeline/SetCoreEnhanceDialog.tsx`
  - `apps/web/src/lib/set-core-api.ts`
  - `apps/web/src/types/pipeline.ts`
- 后端
  - `apps/api/src/set-core/set-core.controller.ts`
  - `apps/api/src/set-core/set-core.service.ts`
  - `apps/api/src/set-core/dto/enhance-set-core.dto.ts`
  - `apps/api/src/set-core/dto/upsert-set-core.dto.ts`
  - `apps/api/src/ai-model-catalog/ai-model-catalog.service.ts`
  - `apps/api/src/pipeline/pipeline.service.ts`

## 结论摘要
- 当前 AI enhance 结果 **不会自动写入 `set_core` 表**。
- 当前链路真实行为是：**AI 生成 -> 回填前端编辑器 state -> 弹窗关闭 -> 提示“请检查后再保存” -> 用户手动点击“保存 set_core”才入库**。
- `coreText` 质量不高的主因更偏 **prompt 设计问题**，不是持久化问题本身。
- 但同时存在明显的 **UI 文案/交互认知偏差**：页面底部有“生成后需要我确认才写入数据库”开关，但当前代码里这个开关并未参与任何 AI enhance 或保存决策。

---

## A. 前端链路：enhance 结果最后流向哪里

### 1. 入口按钮
`SetCoreEditor` 中“生成/完善（本地预览）”按钮只调用父组件传入的 `onOpenEnhanceDialog`：

```tsx
<button
  onClick={onOpenEnhanceDialog}
>
  生成/完善（本地预览）
</button>
```

来源：`apps/web/src/components/pipeline/SetCoreEditor.tsx`

### 2. 打开弹窗
在 `PipelinePanel` 中，`SetCoreEditor` 把点击事件绑定到：

```tsx
onOpenEnhanceDialog={() => void handleOpenEnhanceDialog()}
```

`handleOpenEnhanceDialog()` 的行为是：
- `setSetCoreEnhanceDialogOpen(true)` 打开弹窗
- 拉模型列表 `loadEnhanceModels()`
- 初始化默认参考表
- 刷新 prompt 预览 `refreshEnhancePromptPreview(...)`

关键代码：

```ts
const handleOpenEnhanceDialog = async () => {
  try {
    setSetCoreEnhanceDialogOpen(true)

    let resolvedModelKey = enhanceSelectedModelKey
    let models = enhanceModels
    if (!models.length) {
      models = await loadEnhanceModels()
    }
    if (!resolvedModelKey && models.length) {
      resolvedModelKey = models[0].modelKey
      setEnhanceSelectedModelKey(resolvedModelKey)
    }

    if (!enhanceReferenceTables.length) {
      setEnhanceReferenceTables(defaultEnhanceReferenceTables)
    }

    if (resolvedModelKey) {
      await refreshEnhancePromptPreview(resolvedModelKey)
    }
  } catch (err: any) {
    alert(err?.message || '打开 AI 完善弹窗失败')
  }
}
```

来源：`apps/web/src/components/PipelinePanel.tsx`

### 3. dialog 点击“生成并回填”
`SetCoreEnhanceDialog` 的主按钮只是调用 `onSubmit`：

```tsx
<button
  onClick={onSubmit}
  disabled={submitting || loading || !selectedModelKey}
>
  {submitting ? '生成中...' : '生成并回填'}
</button>
```

来源：`apps/web/src/components/pipeline/SetCoreEnhanceDialog.tsx`

在 `PipelinePanel` 中，这个 `onSubmit` 绑定到：

```tsx
onSubmit={() => void handleSubmitEnhance()}
```

### 4. 前端实际调用的 API
`handleSubmitEnhance()` 调用的是：

```ts
const result = await setCoreApi.enhanceSetCore(novelId, {
  modelKey: enhanceSelectedModelKey,
  referenceTables: enhanceReferenceTables,
  currentCoreText: coreSettingText || undefined,
  currentFields: getCurrentEnhanceFields(),
  userInstruction: enhanceUserInstruction || undefined,
  allowPromptEdit: enhanceAllowPromptEdit,
  promptOverride:
    enhanceAllowPromptEdit && enhancePromptPreview.trim()
      ? enhancePromptPreview
      : undefined,
})
```

`setCoreApi.enhanceSetCore(...)` 实际请求：

```ts
apiClient(`/novels/${novelId}/set-core:enhance`, {
  method: 'POST',
  body: JSON.stringify(payload),
})
```

来源：
- `apps/web/src/components/PipelinePanel.tsx`
- `apps/web/src/lib/set-core-api.ts`

### 5. API 返回后回填了哪些 state
返回后，前端只做了以下事情：

```ts
setCoreSettingText(result.coreText || '')
setCoreFields({
  title: result.title || '',
  protagonistName: result.protagonistName || '',
  protagonistIdentity: result.protagonistIdentity || '',
  targetStory: result.targetStory || '',
  rewriteGoal: result.rewriteGoal || '',
  coreConstraint: result.constraintText || '',
})
setEnhancePromptPreview(result.promptPreview || enhancePromptPreview)
setSetCoreEnhanceDialogOpen(false)
alert('AI 完善结果已回填，请检查后再保存')
```

### 6. 它没有做什么
`handleSubmitEnhance()` 内 **没有**：
- 调用 `setCoreApi.upsertSetCore(...)`
- 调用 `loadOverview()`
- 调用 `setCoreApi.getActiveSetCore(...)`
- 调用 `refreshSetCoreStates()`
- 触发任何数据库保存

### A 节结论
- **AI 结果当前是“只回填前端”，没有自动写库。**
- 前端断点停在：
  - `coreSettingText`
  - `coreFields`
  - `enhancePromptPreview`
- 之后只弹出提示：
  - `AI 完善结果已回填，请检查后再保存`

---

## B. 后端链路：enhance 接口到底做了什么

### 1. Controller 到 Service
接口定义：

```ts
@Post('novels/:novelId/set-core:enhance')
enhanceSetCore(
  @Param('novelId', ParseIntPipe) novelId: number,
  @Body() dto: EnhanceSetCoreDto,
) {
  return this.setCoreService.enhanceSetCore(novelId, dto);
}
```

来源：`apps/api/src/set-core/set-core.controller.ts`

### 2. Service 主流程
`enhanceSetCore()` 主流程如下：

```ts
async enhanceSetCore(
  novelId: number,
  dto: EnhanceSetCoreDto,
): Promise<EnhanceSetCoreResultRow> {
  await this.assertNovelExists(novelId);

  const usedModelKey = await this.resolveModelKey(dto.modelKey);
  const referenceTables = this.resolveReferenceTables(dto.referenceTables);
  const promptPreview =
    dto.allowPromptEdit && dto.promptOverride?.trim()
      ? dto.promptOverride.trim()
      : await this.buildPrompt(
          novelId,
          dto.currentCoreText,
          dto.currentFields,
          dto.userInstruction,
          referenceTables,
        );

  const aiJson = await this.callLcAiApi(usedModelKey, promptPreview);

  return {
    title: this.normalizeText(aiJson.title),
    coreText: this.normalizeText(aiJson.coreText),
    protagonistName: this.normalizeText(aiJson.protagonistName),
    protagonistIdentity: this.normalizeText(aiJson.protagonistIdentity),
    targetStory: this.normalizeText(aiJson.targetStory),
    rewriteGoal: this.normalizeText(aiJson.rewriteGoal),
    constraintText: this.normalizeText(aiJson.constraintText),
    usedModelKey,
    promptPreview,
  };
}
```

### 3. Prompt 在哪里 build
由 `buildPrompt(...)` 构造：
- 拼接“当前待完善内容”
- 拼接“用户附加要求”
- 拼接参考表块 `buildReferenceBlocks(...)`
- 拼接 JSON 输出格式

### 4. 参考表数据在哪里读取
在 `buildReferenceBlocks(...)` 中直接通过 `DataSource` 查询读取：
- `drama_source_text`
- `novel_timelines`
- `novel_characters`
- `novel_key_nodes`
- `novel_skeleton_topics`
- `novel_skeleton_topic_items`
- `novel_explosions`
- `novel_adaptation_strategy`
- `adaptation_modes`

### 5. 外部 AI 在哪里调用
由 `callLcAiApi(...)` 调用外部 OpenAI 兼容接口：

```ts
const response = await fetch(endpoint, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  },
  body: JSON.stringify({
    model: modelKey,
    temperature: 0.7,
    messages: [
      {
        role: 'system',
        content:
          '你是短剧核心设定完善助手。你必须输出严格 JSON，不要输出 markdown，不要输出解释。',
      },
      {
        role: 'user',
        content: promptPreview,
      },
    ],
  }),
});
```

### 6. AI 返回 JSON 在哪里解析
解析链路：
- `response.text()`
- `JSON.parse(rawText)` 解析外层 API payload
- `extractAiText(payload)` 提取文本内容
- `parseJsonObjectFromText(content)` 再解析模型产出的 JSON

### 7. 最终返回给前端的对象结构
返回字段固定为：
- `title`
- `coreText`
- `protagonistName`
- `protagonistIdentity`
- `targetStory`
- `rewriteGoal`
- `constraintText`
- `usedModelKey`
- `promptPreview`

### B 节结论
- 后端 `enhance` 接口 **没有任何 SQL INSERT / UPDATE / upsert 到 `set_core`**。
- `set_core` 的真正写库能力只存在于 `upsertSetCore(...)`。
- **当前 `enhance` 是纯预览/生成接口，不落库。**

---

## C. 当前 prompt 为什么没有把 `coreText` 真正细化

### 当前 prompt 核心片段

```ts
return [
  '【System Prompt】',
  '你是短剧核心设定完善助手。',
  '你的任务是根据当前 set_core 内容与参考资料，完善并补全 set_core 的字段。',
  '你必须输出严格 JSON，不要输出 markdown，不要输出解释。',
  '',
  currentSection,
  '',
  userInstructionSection,
  '',
  referenceBlocks || '【参考资料】\n无',
  '',
  outputFormat,
].join('\n');
```

来源：`apps/api/src/set-core/set-core.service.ts`

### 观察结果
当前 prompt 更偏向：
- “根据现有内容整理并补全字段”
- “按 JSON schema 填空”

而不是明确要求：
- 扩写 `coreText`
- 细化冲突链
- 增强戏剧张力
- 补足动机与限制
- 给出比原文更强的世界观核心设定文案

### 具体缺失
当前 prompt **没有明确强制要求**：
- `coreText` 不能只是复述或轻微改写原文
- 必须在原文基础上新增信息密度
- 必须强化“主角身份 -> 目标 -> 阻碍 -> 改写逻辑 -> 爽点张力”的链路
- 必须补足人物身份、目标、限制之间的因果关系
- 若输入字段为空，需主动从参考资料中补全，而不是返回空串

### 输出风格更像什么
当前输出风格明显更像：
- **数据库字段填写**

而不是：
- **真正强化后的核心设定文案**

原因是 prompt 把注意力集中在“输出严格 JSON + 7 个字段”，而不是“产出更强、更细、更戏剧化的 `coreText`”。

### 参考资料块是否过散过杂
是，存在这个问题。

当前参考块有几个明显特征：
- `drama_source_text` 最长可塞到 `8000` 字符，量级远大于当前待完善内容
- 其它参考表又以列表条目形式零散拼接
- `adaptation strategy` 和 `adaptation mode` 也会额外混入
- 默认参考表里 **没有** `novel_timelines`、`novel_explosions`、`novel_skeleton_topics` 等更适合做结构增强的材料

这会让模型更容易做：
- 摘要
- 提炼
- 复述

而不是做：
- 重新组织
- 戏剧化强化
- 因果链细化

### 内容质量不高 Top 5
1. Prompt 目标过弱，只要求“完善并补全字段”，没有强约束“深度增强 `coreText`”。
2. 输出格式强约束为字段 JSON，模型天然更倾向于“填表式回答”，而不是写一段强化设定。
3. 参考资料体量大且杂，尤其原始资料块过长，模型更容易走摘要/压缩路线。
4. 默认参考表选择不够聚焦，缺少时间线、爆点、骨架主题等更能帮助结构强化的材料。
5. 后端没有任何质量兜底逻辑，哪怕 `coreText` 与输入几乎相同也会原样放行。

---

## D. AI 输出后的字段校验与兜底

### 1. 是否校验返回 JSON 必含字段
没有严格校验。

后端只是这样取值：

```ts
return {
  title: this.normalizeText(aiJson.title),
  coreText: this.normalizeText(aiJson.coreText),
  protagonistName: this.normalizeText(aiJson.protagonistName),
  protagonistIdentity: this.normalizeText(aiJson.protagonistIdentity),
  targetStory: this.normalizeText(aiJson.targetStory),
  rewriteGoal: this.normalizeText(aiJson.rewriteGoal),
  constraintText: this.normalizeText(aiJson.constraintText),
  usedModelKey,
  promptPreview,
};
```

而 `normalizeText(...)` 的逻辑是：

```ts
private normalizeText(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}
```

这意味着：
- 字段缺失 -> 直接变成空字符串
- 字段不是字符串 -> 直接变成空字符串
- 不会报“缺少必填字段”

### 2. 当前如何处理字段缺失
- 不报错
- 不补默认值
- 不做合并策略
- 直接返回空串给前端

### 3. `coreText` 太短或与输入几乎相同会不会拦截
不会。

当前没有：
- 最小长度校验
- 相似度校验
- “是否明显优于原文”的规则
- 二次提示或二次生成

### 4. 前端回填是否覆盖用户输入
会。

`handleSubmitEnhance()` 直接执行：
- `setCoreSettingText(result.coreText || '')`
- `setCoreFields(...)`

因此会覆盖当前编辑器中的本地内容。

### 5. 有没有“生成成功但内容质量差”的兜底提示
没有。

当前只有统一提示：

```ts
alert('AI 完善结果已回填，请检查后再保存')
```

这不是质量兜底，只是保存提醒。

---

## E. `set_core` 保存闭环现状

### 已有保存能力

#### 1. GET /novels/:novelId/set-core
- 读取 active 版本

#### 2. POST /novels/:novelId/set-core:upsert
- 真正写库
- 支持：
  - `update_active`
  - `new_version`

#### 3. 前端哪个按钮会真正调用 upsert
`SetCoreEditor` 中的“保存 set_core”按钮：

```tsx
<button onClick={onSave}>
  保存 set_core
</button>
```

最终落到 `PipelinePanel.handleSetCoreSave()`：

```ts
const saved = await setCoreApi.upsertSetCore(novelId, payload)
fillSetCoreEditor(saved)
await refreshSetCoreStates()
await loadOverview()
alert(`set_core 保存成功（v${saved.version}）`)
```

#### 4. AI enhance 完成后有没有自动 upsert
没有。

#### 5. 若没有自动 upsert，是否至少有明确提示
有，但只是一条 `alert`：

```ts
alert('AI 完善结果已回填，请检查后再保存')
```

### E 节结论
- 当前产品真实行为就是：
  - **AI 生成 -> 只回填编辑器 -> 用户再手动点“保存 set_core”才会入库**

---

## F. UI 文案与真实行为是否不一致

### 1. “生成/完善（本地预览）”是否准确
基本准确。

这句文案本身已经暗示：
- 本地预览
- 不直接落库

### 2. 弹窗“生成并回填”是否可能让用户误解
会。

“生成并回填”只说了“回填”，没有明确说：
- 仅回填编辑器
- 不自动保存

### 3. 当前页面是否存在更强的误导文案
有。

`PipelinePanel` 底部存在一个开关：

```tsx
<input
  type="checkbox"
  checked={requireConfirm}
  onChange={() => setRequireConfirm((prev) => !prev)}
/>
生成后需要我确认才写入数据库（默认勾选 true）
```

但审计发现：
- `requireConfirm` 只定义了 state
- 只在 UI 中展示和切换
- **没有参与任何 enhance 提交逻辑**
- **也没有参与任何保存逻辑**

所以这块文案与真实行为明显不一致，会让用户误以为：
- 不勾选时会自动写库

但当前实际上：
- 不管勾不勾，AI enhance 都不会自动写库

---

## G. 最终必须回答的问题

### 1. 当前 AI enhance 结果有没有自动写入 `set_core` 表
- **没有**

### 2. 如果没有，前端停在什么 state，后端停在什么返回
- 前端停在：
  - `coreSettingText`
  - `coreFields`
  - `enhancePromptPreview`
- 后端停在：
  - `enhanceSetCore()` 返回 JSON 对象给前端
  - 不会继续进入 `upsertSetCore()`

### 3. 当前 `core_text` 质量不高的 Top 3 根因
1. Prompt 目标太弱，强调“补全字段”，没有强调“深度强化 `coreText`”。
2. 输出格式过于字段化，模型更像在填数据库字段，而不是在写强化设定文案。
3. 参考资料又长又杂，默认参考表组合更像“摘要材料包”，不是“创作增强材料包”。

### 4. 是 prompt 问题为主，还是后处理问题为主，还是两者都有
- **两者都有，但以 prompt 问题为主。**
- Prompt 决定了模型输出上限。
- 后处理缺失则让低质量结果直接通过，没有兜底。

### 5. 若下一步要修，最小改动点应该落在哪些文件
- Prompt 质量：
  - `apps/api/src/set-core/set-core.service.ts`
- 自动写库/保存闭环：
  - `apps/web/src/components/PipelinePanel.tsx`
  - 如需文案同步：
    - `apps/web/src/components/pipeline/SetCoreEditor.tsx`
    - `apps/web/src/components/pipeline/SetCoreEnhanceDialog.tsx`
- 若要调整保存策略 DTO/接口行为：
  - `apps/web/src/lib/set-core-api.ts`
  - `apps/api/src/set-core/set-core.controller.ts`
  - `apps/api/src/set-core/set-core.service.ts`

### 6. 下一步更推荐 A / B / C 哪个
- **推荐 C：两个一起做。**

原因：
- 只提 prompt，不解决“为什么生成后没进库”的体验问题。
- 只补自动写库，会把当前质量一般的内容更快写进数据库。
- 更合理的顺序是：
  1. 在同一批里增强 prompt 与质量兜底
  2. 同时把“是否自动保存”做成明确、真实可用的行为
  3. 至少保证 UI 文案与真实保存策略一致

---

## 最终建议
- 第一优先：提升 `buildPrompt()`，把目标从“补全字段”改成“强化世界观核心设定文案 + 明确补齐人物/目标/限制/改写逻辑”。
- 第二优先：清理 UI 文案歧义，尤其是 `requireConfirm` 相关描述，避免用户误判为“会自动落库”。
- 第三优先：决定是否引入自动保存。如果要做，建议至少加一个明确的“生成后自动保存到当前版本/新版本”的真实开关，而不是只展示未接线的提示。

## 审计结论
- 本次为只读审计。
- 未修改业务代码。
- 未写库。
- 未新增 migration。
- 未提交 commit。
