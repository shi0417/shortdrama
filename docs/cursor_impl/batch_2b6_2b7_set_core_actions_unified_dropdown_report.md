# Batch 2B-6/2B-7（合并版）实现报告

## 1. 修改/新增文件清单

- `apps/api/src/set-core/set-core.controller.ts`
- `apps/api/src/set-core/set-core.service.ts`
- `apps/web/src/lib/set-core-api.ts`
- `apps/web/src/components/PipelinePanel.tsx`
- `apps/web/src/components/pipeline/SetCoreEditor.tsx`

## 2. 新增 DELETE 接口说明

### 路由

- `DELETE /set-core/:id`（受 `JwtAuthGuard` 保护）

### 行为规则（已实现）

1. 按 `id` 查询目标记录，不存在返回 `404`
2. 取目标记录的 `novel_id` 与 `is_active`
3. 事务中删除目标记录
4. 若被删记录原本是 active：
   - 查询同一 `novel_id` 下剩余记录最新一条（`ORDER BY version DESC, id DESC LIMIT 1`）
   - 若存在，则设为 `is_active = 1`
   - 若不存在，不补 active（后续 `GET /novels/:novelId/set-core` 返回 `null`）

> 关键点：所有 active 切换/删除影响范围都限定在**同一个 `novel_id`**。

## 3. 合并下拉的状态与分流逻辑

### 3.1 取消旧双下拉

已移除：
- “保存模式（update_active/new_version）”独立下拉
- “历史版本”独立下拉

### 3.2 新下拉

在 `SetCoreEditor` 中新增单一下拉“版本操作”，选项结构：
- `action:new_version`（新建版本）
- `version:<id>`（切换到某历史版本）

### 3.3 前端状态

在 `PipelinePanel` 中新增：
- `setCoreVersionActionValue: string`
  - 有 active 时：`version:<activeId>`
  - 无 active 时：`action:new_version`

### 3.4 onChange 分流

- 选中 `action:new_version`
  - 仅更新本地状态，不立即写库
- 选中 `version:<id>`
  - 若有未保存改动，先 `confirm`
  - 调 `activateSetCoreVersion(id)` 立即切 active
  - 成功后刷新 active/versions/overview 并回填编辑器

### 3.5 保存按钮分流

保存时根据 `setCoreVersionActionValue` 决定 upsert mode：
- 当前值为 `action:new_version` -> `mode: "new_version"`
- 当前值为 `version:<id>` -> `mode: "update_active"`

保存成功后会刷新 active/versions/overview，并把下拉自动对齐到 `version:<newActiveId>`。

## 4. 列表展开/收起（set_core 专属）

在 `PipelinePanel` 增加状态：
- `expandedDataLists.set_core`（默认 `true`）

在 set_core 模块右侧按钮区增加：
- `列表收起 / 列表展开` 按钮

该按钮只控制 `worldview.core` 列表显示，不影响：
- `SetCoreEditor` 的展开/收起
- 其他模块列表

## 5. 列表删除按钮（set_core 专属）

### 5.1 专用表格渲染

为避免影响其它模块，`set_core` 改为专用 `renderSetCoreTable`，包含列：
- `title`
- `description`
- `action`

其它模块仍沿用 `renderSimpleTable`。

### 5.2 删除交互

- 每行右侧提供“删除”按钮
- 点击后 `confirm('确定删除该版本吗？')`
- 调用 `deleteSetCore(id)`
- 成功后刷新：
  - active set_core
  - versions
  - `worldview.core`（通过 `loadOverview`）
  - 编辑器回填

## 6. API 返回样例（实测）

> 以下实测流程：
> 1) 登录拿 token  
> 2) `GET /novels/1/set-core/versions`  
> 3) 先创建两个新版本（便于验证删除非 active 和删除 active）  
> 4) 删除非 active  
> 5) 删除 active  
> 6) 再 `GET /novels/1/set-core`

### 6.1 `GET /novels/1/set-core/versions`（节选）

```json
[
  { "id": 6, "novelId": 1, "version": 6, "isActive": 1 },
  { "id": 5, "novelId": 1, "version": 5, "isActive": 0 },
  { "id": 4, "novelId": 1, "version": 4, "isActive": 0 }
]
```

### 6.2 删除非 active：`DELETE /set-core/5`

```json
{ "ok": true }
```

删除后 active 仍为 `id=6`（符合预期）。

### 6.3 删除 active：`DELETE /set-core/6`

```json
{ "ok": true }
```

删除后自动激活同 novel 下剩余最新版本：

```json
{
  "id": 4,
  "novelId": 1,
  "version": 4,
  "isActive": 1
}
```

## 7. build 结果

- `pnpm --dir apps/api build` ✅ 通过
- `pnpm --dir apps/web build` ✅ 通过

## 8. UI 验证结果

按以下路径验证：
1. 打开 `/projects`
2. 进入 `Pipeline`
3. 展开 Step3 并打开 `set_core` 编辑器

结果：
- 已显示“列表展开/收起”按钮（仅影响 set_core 列表）
- set_core 列表每行已显示“删除”按钮
- 编辑器中仅保留一个“版本操作”下拉
- 选择“新建版本”后保存会创建新版本并成为 active
- 选择某历史版本会立即切 active 并回填编辑器
- 删除版本后列表与 active 同步刷新

## 9. 已知限制

- 当前“删除”按钮仅在 `worldview.core` 数据有 `id` 时可用；无 `id` 行会自动禁用按钮。
- 本批次未扩展 `pipeline overview` 结构，仍保持现有返回格式与字段。
