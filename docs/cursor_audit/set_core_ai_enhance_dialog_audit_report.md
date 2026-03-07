# set_core AI 完善弹窗只读审计报告

## 审计说明

- 审计类型：只读
- 未执行：业务代码修改、数据库写入、migration、新接口实现、git 提交
- 项目根目录：`D:/project/duanju/shortdrama`

本报告围绕目标功能进行现状摸底：

1. `/projects -> Pipeline -> Step3 -> set_core`
2. 点击 `生成/完善（本地预览）`
3. 弹出 AI 完善对话框
4. 选择模型、勾选参考表、预览/编辑 prompt
5. 调用后端 `POST /novels/:novelId/set-core:enhance`
6. 回填 `SetCoreEditor`
7. 不自动写库，仍由用户手动保存

---

## A. 前端现状审计

### A1. `/projects -> Pipeline -> set_core` 当前链路

- 页面入口：`apps/web/src/app/projects/page.tsx`
- 详情容器：`apps/web/src/components/ProjectDetail.tsx`
- Pipeline 主面板：`apps/web/src/components/PipelinePanel.tsx`
- set_core 编辑器：`apps/web/src/components/pipeline/SetCoreEditor.tsx`

链路关系：

1. `ProjectsPage` 负责选中小说并渲染 `ProjectDetail`
2. `ProjectDetail` 通过 `activeTab === 'pipeline'` 渲染 `PipelinePanel`
3. `PipelinePanel` 在 Step3 的 `set_core` 行内通过 `expandedEditors.set_core` 条件渲染 `SetCoreEditor`
4. `SetCoreEditor` 接收当前 `coreSettingText/coreFields` 和按钮回调

### A2. 当前【生成/完善（本地预览）】按钮现状

按钮位于：`apps/web/src/components/pipeline/SetCoreEditor.tsx`

关键 JSX：

```tsx
<button
  onClick={onGenerate}
  style={{
    flex: 1,
    padding: '8px 10px',
    border: 'none',
    background: '#1890ff',
    color: 'white',
    borderRadius: '4px',
    cursor: 'pointer',
  }}
>
  生成/完善（本地预览）
</button>
```

`SetCoreEditor` 并不自己处理逻辑，而是把点击事件交给父组件传入的 `onGenerate`。

在 `PipelinePanel.tsx` 中，该按钮当前绑定的真实函数是：

- `handleAiGenerate`

当前实现：

```tsx
const handleAiGenerate = () => {
  console.log({
    action: 'local_generate_or_refine_preview',
    novelId,
    novelName,
    coreSettingText,
    coreFields,
  })
}
```

结论：

- 当前点击后**只会 `console.log`**
- 没有弹窗
- 没有 API 调用
- 没有 prompt 组装
- 没有任何 AI 相关前端状态

### A3. 当前 set_core 相关前端 state

位于 `PipelinePanel.tsx` 的现有核心 state：

- `coreSettingText`
- `coreFields`
- `setCoreVersions`
- `activeSetCoreVersionId`
- `setCoreVersionActionValue`
- `expandedEditors`
- `expandedDataLists`
- `step3Expanded`
- `loading`
- `error`
- `worldview`

具体职责：

- `coreSettingText`：左侧大文本框内容
- `coreFields`：右侧 title / protagonistName / protagonistIdentity / targetStory / rewriteGoal / coreConstraint
- `setCoreVersions`：版本列表
- `activeSetCoreVersionId`：当前 active 版本 id
- `setCoreVersionActionValue`：版本操作下拉当前值
- `expandedEditors.set_core`：是否显示 `SetCoreEditor`
- `expandedDataLists.set_core`：是否显示下方 set_core 数据列表

AI 弹窗相关现状：

- **没有现成 state**
- 未见 `modalOpen / dialogOpen / selectedModel / promptPreview / selectedReferenceTables / allowPromptEdit` 等状态

### A4. 当前项目中可复用的弹窗 / 对话框能力

结论：**没有通用 Modal/Dialog 组件**，但有两处可复用实现模式：

1. `apps/web/src/components/pipeline/AdaptationStrategyToolbar.tsx`
   - 已实现一个固定定位遮罩层弹窗
   - 支持表单、展开高级 Prompt、提交/取消
   - 很接近本次 `set_core AI 完善弹窗` 所需交互模式

2. `apps/web/src/components/ProjectList.tsx`
   - 已实现简单创建项目弹窗
   - 更轻量，但功能较少

当前没有发现：

- 通用 Modal 组件
- 通用 Dialog 组件
- 模型选择弹窗
- Prompt 预览弹窗
- 通用 checkbox group 组件
- 通用表单弹窗组件

最适合复用的前端弹窗样式来源：

- `AdaptationStrategyToolbar.tsx` 的内联 overlay 模式

### A5. 当前前端 API 调用层现状

文件：

- `apps/web/src/lib/api.ts`
- `apps/web/src/lib/set-core-api.ts`

现状：

- `api.ts`
  - 有 `apiClient`
  - 负责 `Authorization` 注入
  - 读取 `NEXT_PUBLIC_API_BASE_URL`
  - 已有 `getPipelineOverview`
  - **没有 `ai_model_catalog` 读取方法**

- `set-core-api.ts`
  - 已有：
    - `getActiveSetCore`
    - `upsertSetCore`
    - `listSetCoreVersions`
    - `activateSetCoreVersion`
    - `deleteSetCore`
  - **没有 `enhanceSetCore`**
  - **没有 `listAiModels`**

前端是否已有“外部 AI 调用”逻辑：

- 审计结果：**未发现前端直连外部 AI 的现有实现**
- 结论：这符合目标设计，AI 调用应放在后端

### A6. 当前前端类型定义现状

文件：`apps/web/src/types/pipeline.ts`

已有可复用类型：

- `SetCoreDto`
- `SetCoreVersionDto`
- `UpsertSetCorePayload`

对本次 AI 完善返回结构的复用性判断：

- `SetCoreDto` 已包含目标返回字段：
  - `title`
  - `coreText`
  - `protagonistName`
  - `protagonistIdentity`
  - `targetStory`
  - `rewriteGoal`
  - `constraintText`
- 但它还包含 `id/version/isActive/createdAt/updatedAt`

结论：

- **结构上基本可复用**
- 但从语义上更清晰的做法是新增一个预览用类型，例如：
  - `EnhanceSetCoreResponseDto`

---

## B. 后端现状审计

### B1. `set-core` 模块现状

文件：

- `apps/api/src/set-core/set-core.controller.ts`
- `apps/api/src/set-core/set-core.service.ts`
- `apps/api/src/set-core/dto/upsert-set-core.dto.ts`

当前已有接口：

- `GET /novels/:novelId/set-core`
- `GET /novels/:novelId/set-core/versions`
- `POST /novels/:novelId/set-core:upsert`
- `POST /set-core/:id/activate`
- `DELETE /set-core/:id`

当前 DTO：

- `UpsertSetCoreDto`

当前服务职责：

- 读 active set_core
- 读 versions
- 激活版本
- 删除版本
- upsert 保存版本

判断：

- **最适合把 `POST /novels/:novelId/set-core:enhance` 放进现有 `set-core` 模块**
- 原因：
  - 领域完全一致
  - 可直接复用 `novelId` 校验
  - 可直接复用 `SetCoreEditor` 回填字段结构
  - 与“只预览不落库”的语义相邻

### B2. `ai_model_catalog` 现状

数据库表：

- `ai_model_catalog` 已存在
- 当前行数：`525`

代码层：

- 未发现 `apps/api/src/ai-model*` 模块
- 未发现 `ai_model_catalog` controller/service/module
- 未发现获取模型选项接口

结论：

- 数据库表已具备做下拉的数据源
- **但当前还不能直接给前端提供模型下拉**
- 原因：缺少后端读接口 + 缺少前端 API 封装

建议：

- 最合理是新增轻量只读模块，例如：
  - `apps/api/src/ai-model-catalog/ai-model-catalog.controller.ts`
  - `apps/api/src/ai-model-catalog/ai-model-catalog.service.ts`
  - `apps/api/src/ai-model-catalog/ai-model-catalog.module.ts`

如果只追求最小改动，也可临时放进 `set-core` 模块里增加一个模型列表接口，但不如独立模块清晰。

### B3. 当前项目里是否已有通用外部 LLM 调用能力

审计方式：

- 搜索 `llm` / `client` / `adapter` / `http` / `axios` / `fetch(` / `HttpService`

结果：

- `apps/api/src` 中**未发现通用外部 LLM client / adapter / http 封装**
- 也未发现现成第三方 AI API 调用模式

已有查询模式主要是：

- `DataSource.query(...)`
- `createQueryBuilder(...)`
- TypeORM Repository（如 `source-texts`）

结论：

- 本次 `:enhance` 需要新增一段外部 HTTP 调用逻辑
- 当前没有现成的 AI/LLM service 可直接复用

### B4. 环境变量读取方式现状

文件：

- `apps/api/src/app.module.ts`
- `apps/api/src/config/database.config.ts`
- `apps/api/.env`
- `apps/web/.env.local`
- 根目录 `.env.local`

结论：

1. Nest 已启用：
   - `ConfigModule.forRoot({ isGlobal: true })`

2. 但当前代码读取环境变量的方式仍主要是：
   - `process.env.*`

3. `apps/api/.env` 当前存在：
   - `DB_*`
   - `JWT_SECRET`
   - `PORT`
   - `API_PORT`
   - `WEB_ORIGIN`
   - **没有 `lc_api_key` / `lc_api_url`**

4. `apps/web/.env.local` 只有：
   - `NEXT_PUBLIC_API_BASE_URL`
   - `DB_*`
   - **没有 `lc_api_key` / `lc_api_url`**

5. 根目录 `.env.local` 中存在：
   - `lc_api_key`
   - `lc_api_url`

6. 但代码引用检索结果：
   - **没有任何代码引用 `lc_api_key` / `lc_api_url`**

关键风险：

- 当前 `ConfigModule.forRoot()` 没有显式指定 `envFilePath: ['.env.local', '.env']`
- 所以根目录 `.env.local` 是否会被后端 Nest 自动加载，当前并不可靠
- 就“最小且稳妥”的后续实现来看：
  - 更安全的做法是把 `lc_api_key` / `lc_api_url` 放进 `apps/api/.env`
  - 或显式配置后端加载 `.env.local`

结论：

- **`lc_api_key` / `lc_api_url` 现在没有接入代码**
- **仅在根目录 `.env.local` 存在条目，不等于后端已可用**

### B5. 当前是否已有这些参考表的读取逻辑可复用

在 `apps/api/src/pipeline/pipeline.service.ts` 中已直接可复用的读取逻辑：

- `novel_timelines`
- `novel_characters`
- `novel_key_nodes`
- `novel_skeleton_topics`
- `novel_skeleton_topic_items`
- `novel_explosions`

说明：

- `PipelineService.getOverview()` 已通过 `selectByNovel()` 统一查询这些按 `novel_id` 过滤的表
- 其中：
  - `novel_skeleton_topics` 与 `novel_skeleton_topic_items` 已做组装
  - `set_core` 也已有读取逻辑

当前**未在 `pipeline.service.ts` 中读取**：

- `drama_source_text`
- `novel_adaptation_strategy`
- `adaptation_modes`

不过项目中已有相关读能力：

- `source-texts.service.ts`
  - 可按 `novelId` 查 source_text 列表
  - 可按 `id` 读取完整文本或分段文本

- `adaptation.service.ts`
  - 可读 `adaptation_modes`
  - 可读 `novels/:novelId/adaptation-strategies`

### B6. 是否已有通用“按 novelId 取多表资料”的服务函数

结论：

- **有一半**
- `PipelineService.selectByNovel(tableName, alias, novelId, options?)` 可复用给所有 `novel_id` 型表

但它不适合：

- `drama_source_text`（字段是 `novels_id`，不是 `novel_id`）
- `adaptation_modes`（无 `novel_id`）

因此：

- 对 `novel_timelines / characters / key_nodes / skeleton / explosions` 可直接复用
- 对 `drama_source_text / adaptation_modes / novel_adaptation_strategy` 需要补专用读取逻辑或直接调用现有 service

---

## C. 数据库只读审计

### C1. 汇总表

| 表名 | 是否存在 | COUNT(*) |
|---|---|---:|
| `ai_model_catalog` | 是 | 525 |
| `drama_source_text` | 是 | 1 |
| `novel_timelines` | 是 | 0 |
| `novel_characters` | 是 | 19 |
| `novel_key_nodes` | 是 | 0 |
| `novel_skeleton_topics` | 是 | 2 |
| `novel_skeleton_topic_items` | 是 | 0 |
| `novel_explosions` | 是 | 10 |
| `novel_adaptation_strategy` | 是 | 1 |
| `adaptation_modes` | 是 | 3 |
| `set_core` | 是 | 1 |

### C2. 各表字段摘要与 AI 参考适用性

#### 1) `ai_model_catalog`

关键字段：

- `model_key`
- `display_name`
- `provider`
- `family`
- `model_group`
- `modality`
- `capability_tags`
- `version_label`
- `is_active`
- `sort_order`

适合用于：

- AI 模型下拉
- provider/family/model_group 辅助筛选

不适合直接喂给 AI prompt：

- `id`
- `sort_order`
- `raw_meta`
- `created_at`
- `updated_at`

#### 2) `drama_source_text`

关键字段：

- `id`
- `novels_id`
- `source_text`
- `update_time`

适合用于 prompt：

- `source_text`

不适合直接喂给 AI：

- `id`
- `novels_id`
- `update_time`

备注：

- 这是最关键的原始素材表，但长度风险最大

#### 3) `novel_timelines`

关键字段：

- `time_node`
- `event`
- `sort_order`

适合用于 prompt：

- `time_node`
- `event`

不适合直接喂给 AI：

- `id`
- `novel_id`
- `sort_order`
- `created_at`

#### 4) `novel_characters`

关键字段：

- `name`
- `faction`
- `description`
- `personality`
- `setting_words`

适合用于 prompt：

- `name`
- `faction`
- `description`
- `personality`
- `setting_words`

不适合直接喂给 AI：

- `id`
- `novel_id`
- `image_path`
- `sort_order`
- `created_at`

#### 5) `novel_key_nodes`

关键字段：

- `category`
- `title`
- `description`
- `sort_order`

适合用于 prompt：

- `category`
- `title`
- `description`

不适合直接喂给 AI：

- `id`
- `novel_id`
- `timeline_id`
- `sort_order`
- `created_at`

#### 6) `novel_skeleton_topics`

关键字段：

- `topic_key`
- `topic_name`
- `topic_type`
- `description`
- `sort_order`
- `is_enabled`

适合用于 prompt：

- `topic_name`
- `topic_key`
- `topic_type`
- `description`

不适合直接喂给 AI：

- `id`
- `novel_id`
- `sort_order`
- `is_enabled`
- `created_at`
- `updated_at`

#### 7) `novel_skeleton_topic_items`

关键字段：

- `item_title`
- `content`
- `content_json`
- `source_ref`
- `sort_order`

适合用于 prompt：

- `item_title`
- `content`
- `content_json`（需谨慎序列化）
- `source_ref`

不适合直接喂给 AI：

- `id`
- `novel_id`
- `topic_id`
- `sort_order`
- `created_at`
- `updated_at`

#### 8) `novel_explosions`

关键字段：

- `explosion_type`
- `title`
- `subtitle`
- `scene_restoration`
- `dramatic_quality`
- `adaptability`

适合用于 prompt：

- `explosion_type`
- `title`
- `subtitle`
- `scene_restoration`
- `dramatic_quality`
- `adaptability`

不适合直接喂给 AI：

- `id`
- `novel_id`
- `timeline_id`
- `sort_order`
- `created_at`

#### 9) `novel_adaptation_strategy`

关键字段：

- `mode_id`
- `strategy_title`
- `strategy_description`
- `ai_prompt_template`
- `version`

适合用于 prompt：

- `strategy_title`
- `strategy_description`
- `ai_prompt_template`

不适合直接喂给 AI：

- `id`
- `novel_id`
- `mode_id`（建议 join 后转 `mode_name` 再喂）
- `version`
- `created_at`
- `updated_at`

#### 10) `adaptation_modes`

关键字段：

- `mode_key`
- `mode_name`
- `description`
- `is_active`
- `sort_order`

适合用于 prompt：

- `mode_key`
- `mode_name`
- `description`

不适合直接喂给 AI：

- `id`
- `is_active`
- `sort_order`
- `created_at`

#### 11) `set_core`

关键字段：

- `title`
- `core_text`
- `protagonist_name`
- `protagonist_identity`
- `target_story`
- `rewrite_goal`
- `constraint_text`
- `version`
- `is_active`

适合用于 prompt：

- `title`
- `core_text`
- `protagonist_name`
- `protagonist_identity`
- `target_story`
- `rewrite_goal`
- `constraint_text`

不适合直接喂给 AI：

- `id`
- `novel_id`
- `version`
- `is_active`
- `created_at`
- `updated_at`

---

## D. Prompt 组装可行性审计

### D1. 第一版建议取字段清单

#### `drama_source_text`

建议取：

- `source_text`

建议处理：

- 只取最新一条或当前选中小说最新更新时间的一条
- 第一版建议最大截断：**8000 字符**

原因：

- 这是最核心原始素材
- 但长度风险最大，必须严格截断

#### `novel_timelines`

建议取：

- `time_node`
- `event`

建议格式：

- 按 `sort_order ASC`
- 每条拼成：`[time_node] event`

#### `novel_characters`

建议取：

- `name`
- `faction`
- `description`
- `personality`
- `setting_words`

建议格式：

- 每人一段，按 `sort_order ASC`

#### `novel_key_nodes`

建议取：

- `category`
- `title`
- `description`

建议格式：

- 每节点一段
- `category` 作为前缀标签

#### `novel_skeleton_topics`

建议取：

- `topic_name`
- `topic_key`
- `topic_type`
- `description`

用途：

- 提供“当前骨架主题配置”的结构信息

#### `novel_skeleton_topic_items`

建议取：

- `item_title`
- `content`
- `content_json`
- `source_ref`

建议：

- **按 topic 分组后再拼 prompt**
- 如果 `content_json` 太长，第一版只取字符串化后的前若干字符

#### `novel_explosions`

建议取：

- `explosion_type`
- `title`
- `subtitle`
- `scene_restoration`
- `dramatic_quality`
- `adaptability`

用途：

- 给 AI 一个“爽点/爆点设计”的参考轮廓

#### `novel_adaptation_strategy`

建议取：

- `strategy_title`
- `strategy_description`
- `ai_prompt_template`
- `version`

建议：

- 只取当前最新版本或当前使用版本

#### `adaptation_modes`

建议取：

- `mode_key`
- `mode_name`
- `description`

用途：

- 作为策略背景说明
- 体量小，适合作为辅助上下文

### D2. 第一版默认勾选建议

建议默认勾选：

- `drama_source_text`
- `novel_characters`
- `novel_key_nodes`
- `novel_adaptation_strategy`
- `adaptation_modes`

不建议第一版默认勾选：

- `novel_timelines`
- `novel_skeleton_topics`
- `novel_skeleton_topic_items`
- `novel_explosions`

原因：

- `novel_timelines` / `skeleton*` / `explosions` 更容易拉长 prompt
- 这些表更适合作为“按需补充上下文”

### D3. 最需要长度限制的表

按优先级排序：

1. `drama_source_text`
2. `novel_skeleton_topic_items`
3. `novel_adaptation_strategy.ai_prompt_template`
4. `novel_explosions`
5. `novel_characters.description/personality/setting_words`

---

## E. 必答问题

### 1. 当前【生成/完善（本地预览）】按钮真实绑定的是哪个函数？

- **`handleAiGenerate`**

### 2. 当前最适合新增 AI 弹窗的前端文件是哪个？

- 最合理做法：新增独立文件  
  - **`apps/web/src/components/pipeline/SetCoreEnhanceDialog.tsx`**

补充：

- 触发入口仍在 `SetCoreEditor.tsx`
- 状态编排与数据回填最适合放在 `PipelinePanel.tsx`

### 3. 当前最适合新增 `POST /novels/:novelId/set-core:enhance` 的后端模块是哪个？

- **`set-core` 模块**

### 4. `ai_model_catalog` 现在能不能直接提供模型下拉？

- **不能直接提供给前端**

原因：

- 表已存在
- 但当前没有 controller/service/module
- 也没有前端 API 调用层

### 5. `lc_api_key` / `lc_api_url` 现在是否已经接入代码？

- **没有**

现状：

- 根目录 `.env.local` 存在条目
- 但 `apps/api/.env` 没有
- `apps/web/.env.local` 没有
- 全仓库未发现代码引用

### 6. 第一版建议默认勾选哪些参考表？

- `drama_source_text`
- `novel_characters`
- `novel_key_nodes`
- `novel_adaptation_strategy`
- `adaptation_modes`

### 7. 第一版 prompt 是否建议在前端显示给用户确认？

- **建议显示**

原因：

- 当前按钮文案本身就带“本地预览”语义
- 目标又明确“不自动写库”
- 显示 prompt 可减少黑盒感，方便调试和追踪生成质量

### 8. 第一版是否建议允许用户手工编辑 prompt？

- **建议允许**

建议形态：

- 默认只读预览
- 提供一个开关/按钮：`允许编辑 prompt`

### 9. 为实现这个功能，最小改动文件清单是什么？

前端：

- `apps/web/src/components/PipelinePanel.tsx`
- `apps/web/src/components/pipeline/SetCoreEditor.tsx`
- `apps/web/src/components/pipeline/SetCoreEnhanceDialog.tsx`（建议新增）
- `apps/web/src/lib/set-core-api.ts`
- `apps/web/src/types/pipeline.ts`

后端：

- `apps/api/src/set-core/set-core.controller.ts`
- `apps/api/src/set-core/set-core.service.ts`
- `apps/api/src/set-core/dto/enhance-set-core.dto.ts`（建议新增）

模型目录读接口（建议新增轻量模块）：

- `apps/api/src/ai-model-catalog/ai-model-catalog.module.ts`
- `apps/api/src/ai-model-catalog/ai-model-catalog.controller.ts`
- `apps/api/src/ai-model-catalog/ai-model-catalog.service.ts`
- `apps/api/src/app.module.ts`

---

## F. 实施建议（最小可行版本）

### 前端最小方案

1. `SetCoreEditor` 的 `onGenerate` 不再 `console.log`
2. `PipelinePanel` 新增：
   - `enhanceDialogOpen`
   - `selectedModelKey`
   - `selectedReferenceTables`
   - `promptPreview`
   - `allowPromptEdit`
   - `enhancing`
3. 新建 `SetCoreEnhanceDialog.tsx`
4. 在弹窗内：
   - 拉模型下拉
   - 多选参考表
   - 显示/编辑 prompt
   - 提交调用 `setCoreApi.enhanceSetCore(...)`
5. 成功后只回填编辑器，不保存数据库

### 后端最小方案

1. 在 `set-core` 模块新增 `POST /novels/:novelId/set-core:enhance`
2. 新 DTO：
   - `modelKey`
   - `referenceTables: string[]`
   - `promptOverride?: string`
   - `allowPromptEdit?: boolean`
3. 服务内：
   - 读取当前编辑内容
   - 查询勾选参考表数据
   - 拼 prompt
   - 读取 `lc_api_key` / `lc_api_url`
   - 调外部 AI API
   - 返回 set_core 预览字段

---

## 核心结论摘要

- 当前【生成/完善（本地预览）】按钮真实只绑定到 **`handleAiGenerate`**，且仅 `console.log`。
- 当前最适合新增 AI 弹窗的前端实现方式，是新建 **`SetCoreEnhanceDialog.tsx`**，由 `PipelinePanel.tsx` 管状态，`SetCoreEditor.tsx` 负责触发。
- 当前最适合新增 `POST /novels/:novelId/set-core:enhance` 的后端模块，是现有 **`set-core` 模块**。
- `ai_model_catalog` 表已存在且有数据，但**当前没有接口，不能直接给前端做模型下拉**。
- `lc_api_key / lc_api_url` 目前**未接入代码**；只是根目录 `.env.local` 中存在条目。
- 第一版建议默认勾选：**`drama_source_text`、`novel_characters`、`novel_key_nodes`、`novel_adaptation_strategy`、`adaptation_modes`**。
