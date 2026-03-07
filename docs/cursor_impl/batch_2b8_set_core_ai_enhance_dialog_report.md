# Batch 2B-8 set_core AI 完善弹窗实现报告

## 1. 修改/新增文件清单

### 前端

- `apps/web/src/components/PipelinePanel.tsx`
- `apps/web/src/components/pipeline/SetCoreEditor.tsx`
- `apps/web/src/components/pipeline/SetCoreEnhanceDialog.tsx`
- `apps/web/src/lib/set-core-api.ts`
- `apps/web/src/types/pipeline.ts`

### 后端

- `apps/api/src/app.module.ts`
- `apps/api/src/set-core/set-core.controller.ts`
- `apps/api/src/set-core/set-core.service.ts`
- `apps/api/src/set-core/dto/enhance-set-core.dto.ts`
- `apps/api/src/ai-model-catalog/ai-model-catalog.module.ts`
- `apps/api/src/ai-model-catalog/ai-model-catalog.controller.ts`
- `apps/api/src/ai-model-catalog/ai-model-catalog.service.ts`
- `apps/api/.env`

## 2. 新增接口清单

### `GET /ai-model-catalog/options`

- 作用：为前端模型下拉提供数据
- 鉴权：`JwtAuthGuard`
- 返回字段：
  - `id`
  - `modelKey`
  - `displayName`
  - `provider`
  - `family`
  - `modality`

### `POST /novels/:novelId/set-core:enhance-preview-prompt`

- 作用：由后端统一生成 prompt preview
- 鉴权：`JwtAuthGuard`
- 不调用外部 AI，只返回：
  - `promptPreview`
  - `usedModelKey`
  - `referenceTables`

### `POST /novels/:novelId/set-core:enhance`

- 作用：调用外部 AI 并返回 set_core 预览字段
- 鉴权：`JwtAuthGuard`
- 返回字段：
  - `title`
  - `coreText`
  - `protagonistName`
  - `protagonistIdentity`
  - `targetStory`
  - `rewriteGoal`
  - `constraintText`
  - `usedModelKey`
  - `promptPreview`

## 3. 前端实现摘要

### 3.1 新增弹窗组件

新增：

- `SetCoreEnhanceDialog.tsx`

功能：

- 模型下拉
- 参考表多选
- 用户附加要求输入框
- prompt 预览区
- “允许手工编辑 prompt”开关
- “刷新 Prompt 预览”
- “生成并回填”

### 3.2 `SetCoreEditor` 按钮改造

原来的【生成/完善（本地预览）】按钮不再 `console.log`，改为触发父组件回调：

- `onOpenEnhanceDialog`

### 3.3 `PipelinePanel` 新增 AI 完善状态

已新增并接通：

- `setCoreEnhanceDialogOpen`
- `enhanceModels`
- `enhanceLoading`
- `enhanceSubmitting`
- `enhanceReferenceTables`
- `enhancePromptPreview`
- `enhanceAllowPromptEdit`
- `enhanceUserInstruction`
- `enhanceSelectedModelKey`

并实现：

- 打开弹窗时加载模型列表
- 调后端 preview 接口生成 prompt
- 调后端 enhance 接口获取 AI 结果
- 成功后回填：
  - `coreSettingText`
  - `coreFields.title`
  - `coreFields.protagonistName`
  - `coreFields.protagonistIdentity`
  - `coreFields.targetStory`
  - `coreFields.rewriteGoal`
  - `coreFields.coreConstraint`

注意：

- 只回填，不写库
- 仍由现有【保存 set_core】走 upsert

## 4. 环境变量接入说明

后端已新增读取逻辑：

- `process.env.lc_api_key`
- `process.env.lc_api_url`

并在：

- `apps/api/.env`

中补了占位：

```env
lc_api_key=
lc_api_url=
```

当前实现行为：

- 若 `lc_api_url` 缺失：抛 `500 lc_api_url is not configured`
- 若 `lc_api_key` 缺失：抛 `500 lc_api_key is not configured`

说明：

- 本次实现已完成“后端读取逻辑接入”
- 但本地联调时，`apps/api/.env` 仍为空值，所以外部 AI 调用尚未成功打通

## 5. prompt 组装规则摘要

后端统一通过 `buildPrompt()` 生成最终 prompt，包含四段：

1. `System Prompt`
2. `当前待完善内容`
3. `用户附加要求`
4. `参考资料块`
5. `输出格式要求`

输出格式要求强制为 JSON：

```json
{
  "title": "",
  "coreText": "",
  "protagonistName": "",
  "protagonistIdentity": "",
  "targetStory": "",
  "rewriteGoal": "",
  "constraintText": ""
}
```

### 参考资料提取规则（第一版）

- `drama_source_text`
  - 取同 novel 最新一条
  - 仅取 `source_text`
  - 截断前 8000 字符

- `novel_timelines`
  - `time_node + event`

- `novel_characters`
  - `name / faction / description / personality / setting_words`

- `novel_key_nodes`
  - `category / title / description`

- `novel_skeleton_topics`
  - `topic_name / topic_key / topic_type / description`

- `novel_skeleton_topic_items`
  - `item_title / content / source_ref`
  - 按 topic 分组
  - 最多 30 条

- `novel_explosions`
  - `explosion_type / title / subtitle / scene_restoration / dramatic_quality / adaptability`
  - 最多 20 条

- `novel_adaptation_strategy`
  - 当前最新版本
  - `strategy_title / strategy_description / ai_prompt_template / version`

- `adaptation_modes`
  - 取最新 strategy 对应的 mode
  - `mode_key / mode_name / description`

## 6. 默认勾选参考表

前后端统一默认值：

- `drama_source_text`
- `novel_characters`
- `novel_key_nodes`
- `novel_adaptation_strategy`
- `adaptation_modes`

## 7. AI 返回字段到编辑器字段映射

后端返回：

- `title`
- `coreText`
- `protagonistName`
- `protagonistIdentity`
- `targetStory`
- `rewriteGoal`
- `constraintText`

前端回填：

- `title -> coreFields.title`
- `coreText -> coreSettingText`
- `protagonistName -> coreFields.protagonistName`
- `protagonistIdentity -> coreFields.protagonistIdentity`
- `targetStory -> coreFields.targetStory`
- `rewriteGoal -> coreFields.rewriteGoal`
- `constraintText -> coreFields.coreConstraint`

## 8. build 结果

- `pnpm --dir apps/api build` ✅ 通过
- `pnpm --dir apps/web build` ✅ 通过

## 9. 本地接口实测

### 9.1 `GET /ai-model-catalog/options`

结果：✅ 成功

- 返回条数：`525`
- 首条样例（节选）：

```json
{
  "id": "1",
  "modelKey": "chat_fast_imagine",
  "displayName": "chat_fast_imagine",
  "provider": "midjourney",
  "family": "midjourney",
  "modality": "text"
}
```

### 9.2 `POST /novels/1/set-core:enhance-preview-prompt`

结果：✅ 成功

- `usedModelKey = gpt-4o`
- `promptPreview` 已返回
- 本次预览长度约：`9713` 字符

### 9.3 `POST /novels/1/set-core:enhance`

结果：⚠️ 已进入后端增强逻辑，但外部 AI 调用未成功打通

实际返回：

```json
{
  "message": "lc_api_url is not configured",
  "error": "Internal Server Error",
  "statusCode": 500
}
```

## 10. 外部 AI 调用失败原因与位置

失败位置：

- `apps/api/src/set-core/set-core.service.ts`
- 私有方法：`getLcApiEndpoint()`

失败原因：

- 当前运行时未读取到有效的 `lc_api_url`
- 因此在真正发外部请求前就被拦截并抛出 `500`

说明：

- 功能链路已打通到“后端准备调用外部 AI”这一层
- 阻塞点仅剩本地运行环境变量配置
- 只要把有效的 `lc_api_key` / `lc_api_url` 放进后端实际加载的环境文件，再重启 API，即可继续联调真实生成结果

## 11. 当前状态结论

- `ai_model_catalog` 已接通前端下拉：**是**
- `lc_api_key / lc_api_url` 已进入后端读取逻辑：**是**
- prompt preview 已由后端统一生成：**是**
- 生成后回填编辑器但不自动写库：**是**
- 外部 AI 实际调用已成功联通：**否，当前卡在 `lc_api_url` 未配置**
