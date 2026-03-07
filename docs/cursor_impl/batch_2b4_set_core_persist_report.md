# Batch 2B-4 set_core 保存闭环实现报告

## 1) 修改/新增文件清单

### apps/api

- `apps/api/src/app.module.ts`（modified，注册 `SetCoreModule`）
- `apps/api/src/set-core/set-core.module.ts`（new）
- `apps/api/src/set-core/set-core.controller.ts`（new）
- `apps/api/src/set-core/set-core.service.ts`（new）
- `apps/api/src/set-core/dto/upsert-set-core.dto.ts`（new）

### apps/web

- `apps/web/src/types/pipeline.ts`（modified，新增 `SetCoreDto` / `UpsertSetCorePayload`）
- `apps/web/src/lib/set-core-api.ts`（new）
- `apps/web/src/components/PipelinePanel.tsx`（modified）
- `apps/web/src/components/pipeline/SetCoreEditor.tsx`（modified）

## 2) 新增接口清单

均受 `JwtAuthGuard` 保护：

1. `GET /novels/:novelId/set-core`
   - 返回当前 active set_core（`is_active = 1`），无记录返回 `null`
2. `POST /novels/:novelId/set-core:upsert`
   - body: `UpsertSetCoreDto`
   - 支持 `mode: update_active | new_version`（默认 `update_active`）
   - 返回保存后的当前记录（camelCase）

## 3) DTO 与字段映射说明

### 后端 DTO：`UpsertSetCoreDto`

- `title?: string`（max 255）
- `coreText?: string`
- `protagonistName?: string`（max 100）
- `protagonistIdentity?: string`（max 255）
- `targetStory?: string`（max 100）
- `rewriteGoal?: string`（max 255）
- `constraintText?: string`（max 255）
- `mode?: 'update_active' | 'new_version'`

空 body 会返回 400（`Request body cannot be empty`）。

### DB -> API 返回字段（camelCase）

- `novel_id` -> `novelId`
- `core_text` -> `coreText`
- `protagonist_name` -> `protagonistName`
- `protagonist_identity` -> `protagonistIdentity`
- `target_story` -> `targetStory`
- `rewrite_goal` -> `rewriteGoal`
- `constraint_text` -> `constraintText`
- `is_active` -> `isActive`
- `created_at` -> `createdAt`
- `updated_at` -> `updatedAt`

## 4) 版本规则说明

### `mode = update_active`（默认）

- 若当前有 active 记录：更新该记录
- 若无 active：插入 `version = 1`, `is_active = 1`

### `mode = new_version`

- 事务内执行：
  1. 查询 `MAX(version)`
  2. 将该 novel 所有 active 置 `is_active = 0`
  3. 插入新记录 `version = max + 1`, `is_active = 1`

## 5) 前端接入说明（保存 + 回填 + 刷新）

### 新增前端 API

`apps/web/src/lib/set-core-api.ts`

- `getActiveSetCore(novelId)`
- `upsertSetCore(novelId, payload)`

### PipelinePanel 改动

- 新增 `setCoreSaveMode` 状态（默认 `update_active`）
- set_core 编辑器展开时调用 `getActiveSetCore` 回填：
  - `coreSettingText`
  - `coreFields`（含 `title/targetStory/...`）
- 保存 `handleSetCoreSave`：
  - 调用 `upsertSetCore`
  - 成功后 `await loadOverview()` 刷新 `worldview.core`
  - 保持编辑器展开并提示成功

### SetCoreEditor 改动

- 新增 `title` 输入框
- 新增保存模式下拉：
  - `update_active`
  - `new_version`
- 保存按钮仍通过父组件 `onSave` 执行

## 6) API 返回样例（实测）

> 通过本地 `http://localhost:4001` 开发服务实测（与 4000 主服务隔离），账号 `s01/123456`。

### GET /novels/1/set-core（初始）

```json
null
```

### POST update_active

请求体（示例）：

```json
{
  "coreText": "测试核心设定",
  "protagonistName": "沈照",
  "protagonistIdentity": "女官",
  "targetStory": "靖难之役",
  "rewriteGoal": "反杀朱棣",
  "constraintText": "身份卑微无法直接干预",
  "mode": "update_active"
}
```

返回（关键字段）：

```json
{
  "id": 1,
  "novelId": 1,
  "title": "",
  "coreText": "测试核心设定",
  "version": 1,
  "isActive": 1
}
```

### POST new_version

请求体：

```json
{
  "coreText": "第二版核心设定",
  "mode": "new_version"
}
```

返回（关键字段）：

```json
{
  "id": 2,
  "novelId": 1,
  "coreText": "第二版核心设定",
  "version": 2,
  "isActive": 1
}
```

### GET /novels/1/set-core（保存后）

```json
{
  "id": 2,
  "novelId": 1,
  "coreText": "第二版核心设定",
  "version": 2,
  "isActive": 1
}
```

## 7) 验证结果

- `pnpm --dir apps/api build`：通过
- `pnpm --dir apps/web build`：通过

## 8) UI 验证结果

代码层面已接通以下链路（可在本地页面手动确认）：

1. `/projects` -> `Pipeline` -> Step3 -> `set_core` -> 编辑
2. 展开后自动回填 active set_core（有数据时）
3. 保存后调用 upsert 接口
4. 保存成功后刷新 `worldview.core` 行内列表
5. 刷新页面再展开编辑器可回填最新 active

## 9) 已知限制

- `set_core` 目前未绑定 adaptation strategy（无 `strategy_id` 维度）。
- `GET /novels/:novelId/set-core` 在 `Invoke-RestMethod` 输出中表现为 `""`，语义上等价 `null`（接口本身返回 null JSON）。
