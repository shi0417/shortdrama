# Batch 2B-9：set_core AI 质量提升与自动保存

## 修改文件清单
- `apps/api/src/set-core/set-core.service.ts`
- `apps/api/src/set-core/set-core.controller.ts`
- `apps/web/src/components/PipelinePanel.tsx`
- `apps/web/src/components/pipeline/SetCoreEditor.tsx`
- `apps/web/src/components/pipeline/SetCoreEnhanceDialog.tsx`

## 实现概要
本批次同时解决了两类问题：
- AI enhance 输出偏弱，更像摘要/轻微改写
- AI enhance 成功后只回填编辑器，没有根据前端开关自动保存

另外在联调过程中还修复了一个实际阻塞自动保存的底层问题：
- `set-core:enhance / set-core:enhance-preview-prompt / set-core:upsert` 三个 POST 路由在 Nest 中存在字面冒号歧义
- 实际请求 `set-core:upsert` 时可能误打到 `enhance`
- 现已改为统一 `set-core*` POST 路由分发，外部 URL 不变，但服务端会按真实 path 分流到 preview/enhance/upsert

---

## 1. Prompt 改造说明

### 改造前
原 prompt 更像：
- 根据当前内容和参考资料补全字段
- 输出严格 JSON

模型容易走：
- 摘要
- 复述
- 同义改写

### 改造后
`buildPrompt()` 已重写为“强化核心设定”导向，显式要求模型：
- 不是在补齐数据库表单，而是在强化一条短剧核心设定
- `coreText` 必须做深度细化与增强
- 不能只做轻微改写、同义替换、摘要复述
- 必须补强链路：
  - 主角是谁
  - 主角身份与处境
  - 主角知道什么
  - 主角要改写什么
  - 为什么不能直接做
  - 必须如何借力布局
  - 为什么会形成爽点与张力
- 必须突出：
  - 冲突
  - 限制
  - 目标
  - 改写路径
  - 权谋/爽点张力

### 字段级要求
Prompt 里已分别约束：
- `title`
- `coreText`
- `protagonistName`
- `protagonistIdentity`
- `targetStory`
- `rewriteGoal`
- `constraintText`

并明确要求：
- 不要只复述原文
- 不要输出空字段
- 不要输出解释
- 不要输出 markdown
- 不要输出额外字段
- 必须输出严格 JSON

---

## 2. 参考资料组织调整说明

`buildReferenceBlocks()` 保持默认重点参考不变：
- `drama_source_text`
- `novel_characters`
- `novel_key_nodes`
- `novel_adaptation_strategy`
- `adaptation_modes`

但已优化为更清晰的分段结构：
- `【背景原始资料】`
- `【人物信息】`
- `【关键节点】`
- `【改编策略】`
- `【改编模式】`
- 若勾选其他表，也按：
  - `【时间线】`
  - `【骨架主题】`
  - `【骨架主题详情】`
  - `【爆点设计】`

### 长度控制优化
- `drama_source_text` 截断长度从 `8000` 收紧到 `5000`
- 人物最多 `12` 条
- 关键节点最多 `15` 条
- 骨架主题最多 `12` 条
- 骨架主题详情最多 `20` 条
- 爆点最多 `12` 条

目标是让 prompt 更聚焦“支撑改写逻辑与设定强化”的信息，而不是把过多材料机械堆进去。

---

## 3. 质量兜底规则说明

在 `enhanceSetCore()` 中新增了质量校验：

### 已生效规则
1. `coreText` 不能为空
2. `coreText` 长度不能过短
   - 当前阈值：`< 100` 直接失败
3. `coreText` 不能与输入 `currentCoreText` 完全相同
4. `coreText` 不能与输入过于接近
   - 使用归一化文本 + Dice 相似度
   - 当前阈值：`>= 0.90` 直接失败

### 失败时的错误信息
例如：
- `AI enhance result coreText is empty`
- `AI enhance result coreText is too short`
- `AI enhance result is too similar to the original coreText`

### 其他字段的保底
对以下字段做了“AI 优先、原值兜底”：
- `title`
- `protagonistName`
- `protagonistIdentity`
- `targetStory`
- `rewriteGoal`
- `constraintText`

如果 AI 某字段返回空串，不会把前端原有值冲掉。

---

## 4. `requireConfirm` 真正接线说明

之前：
- `requireConfirm` 只是前端 UI state
- 不参与真实保存逻辑

现在：
- 已真正接入 `PipelinePanel.handleSubmitEnhance()`

### `requireConfirm = true`
- AI 成功后：
  - 回填编辑器
  - 不自动保存
  - 不自动刷新 `worldview.core`
- 提示文案：
  - `AI 完善结果已回填，未自动保存，请检查后手动保存`

### `requireConfirm = false`
- AI 成功后：
  - 先回填编辑器
  - 再自动调用 `upsertSetCore(...)`
  - 自动刷新：
    - active set_core
    - versions
    - `worldview.core`
- 提示文案：
  - `AI 完善结果已自动保存到 set_core（vX）`

### UI 对齐
`SetCoreEnhanceDialog` 中新增了保存行为说明：
- 当前模式：只回填不保存
- 或当前模式：自动保存到 set_core（新建版本 / 更新当前激活版本）

同时把 `SetCoreEditor` 按钮文案从：
- `生成/完善（本地预览）`

调整为：
- `生成/完善（AI）`

避免在自动保存打开时仍给用户“纯本地预览”的误导。

---

## 5. 自动保存规则说明

自动保存仍复用现有接口：
- `POST /novels/:novelId/set-core:upsert`

后端 `enhance` 仍保持“只返回增强结果”的语义，不直接写库。

### 自动保存 mode 规则
根据当前版本操作下拉决定：
- 若当前值是 `action:new_version`
  - 自动保存时使用 `mode: 'new_version'`
- 若当前值是 `version:<id>`
  - 自动保存时使用 `mode: 'update_active'`

### 自动保存成功后刷新链路
统一复用：
1. `fillSetCoreEditor(saved)`
2. `await refreshSetCoreStates()`
3. `await loadOverview()`

确保：
- 版本列表更新
- active 版本更新
- `worldview.core` 更新
- 编辑器内容与数据库一致

---

## 6. 路由歧义修复说明

联调时发现：
- `POST /novels/:novelId/set-core:upsert`
- `POST /novels/:novelId/set-core:enhance`
- `POST /novels/:novelId/set-core:enhance-preview-prompt`

这三条使用了带冒号的路径，但在 Nest/Express 路由层里会产生歧义。

### 现象
- `set-core:upsert` 请求可能误打到 `enhance`
- 导致自动保存实际上被错误路由拦住

### 修复方式
将三条 POST 收口为：
- `@Post('novels/:novelId/set-core*')`

然后根据 `request.path` 做服务端分发：
- `.../set-core:enhance-preview-prompt` -> `previewEnhancePrompt`
- `.../set-core:enhance` -> `enhanceSetCore`
- `.../set-core:upsert` -> `upsertSetCore`

外部接口 URL 不变。

---

## 7. Build 结果

执行结果：
- `pnpm --dir apps/api build`：通过
- `pnpm --dir apps/web build`：通过

---

## 8. 本地联调结果

### 8.1 Preview + Enhance 成功
使用本地 dev API 验证：
- `POST /novels/1/set-core:enhance-preview-prompt`
- `POST /novels/1/set-core:enhance`

结果：
- `previewLength = 7253`
- `usedModelKey = gpt-4o`
- `coreTextLength = 362`

说明：
- Prompt 预览链路正常
- Enhance 路由在修复后仍正常
- 返回的 `coreText` 明显长于输入

### 8.2 质量兜底命中
使用“故意要求原样返回”的 `promptOverride` 验证：

返回：
```json
{
  "status": 400,
  "body": "{\"message\":\"AI enhance result coreText is too short\",\"error\":\"Bad Request\",\"statusCode\":400}"
}
```

说明：
- 质量兜底已生效
- 低质量结果不会继续放行到前端

### 8.3 自动保存底层落库链路验证
使用 Node `fetch` 直接调用：
- `POST /novels/1/set-core:upsert`
- `GET /novels/1/set-core`
- `GET /pipeline/1/overview`

验证时：
- 临时写入一条带 `[AUTO-SAVE TEST]` 的更新
- 确认保存成功后立即恢复原始数据

结果：
```json
{
  "savedVersion": 2,
  "activeMatchesSaved": true,
  "overviewContainsSavedRow": true,
  "restoredBackToOriginal": true
}
```

说明：
- 自动保存复用的 `upsert` 路径已打通
- `GET /novels/:novelId/set-core` 能读取到保存后的 active 内容
- `GET /pipeline/:novelId/overview` 能看到同步后的 `worldview.core`
- 验证结束后已恢复原始 `set_core`

### 8.4 UI 两种场景的真实行为

#### 场景 1：`requireConfirm = true`
已通过代码路径确认：
- AI 成功 -> 回填编辑器
- 不自动调用 `upsert`
- 需要用户再手动点“保存 set_core”

#### 场景 2：`requireConfirm = false`
已通过代码路径 + 底层 `upsert` 联调确认：
- AI 成功 -> 回填编辑器
- 自动调用 `upsert`
- 自动刷新 active / versions / `worldview.core`

注：
- 本次未额外做浏览器可视化点击录屏验证
- 但前端 build 通过，关键函数链路和底层接口均已实测

---

## 9. 剩余限制 / 风险

### 已知剩余限制
外部 AI 服务偶发会返回：
- `content-type: text/event-stream`

而当前 `callLcAiApi()` 仍按普通 JSON 一次性响应解析。

### 影响
- 当上游返回流式 chunk 时，当前后端会报：
  - `AI enhance response is not valid JSON`

### 当前状态
- 本批次目标已完成
- 但若后续想进一步提升联调稳定性，建议下一步补：
  - 对 `text/event-stream` 的流式响应解析支持
  - 或显式要求上游关闭 stream

---

## 最终结论
- AI enhance 现在已支持“按开关决定是否自动写库”
- `requireConfirm=true`：只回填，不自动保存
- `requireConfirm=false`：回填后自动保存并刷新 Step3
- `coreText` 质量兜底已生效
- 自动保存底层被路由歧义拦截的问题已一并修复
