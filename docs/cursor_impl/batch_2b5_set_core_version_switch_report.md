# Batch 2B-5 set_core 历史版本切换实现报告

## 1) 修改/新增文件清单

- `apps/api/src/set-core/set-core.controller.ts`
- `apps/api/src/set-core/set-core.service.ts`
- `apps/web/src/types/pipeline.ts`
- `apps/web/src/lib/set-core-api.ts`
- `apps/web/src/components/PipelinePanel.tsx`
- `apps/web/src/components/pipeline/SetCoreEditor.tsx`

## 2) 新增接口清单

### GET `/novels/:novelId/set-core/versions`

- 鉴权：`JwtAuthGuard`
- 功能：查询指定 `novelId` 的全部 set_core 版本列表
- 排序：`ORDER BY version DESC, id DESC`
- 返回字段（camelCase）：
  - `id`
  - `novelId`
  - `title`
  - `version`
  - `isActive`
  - `createdAt`
  - `updatedAt`

### POST `/set-core/:id/activate`

- 鉴权：`JwtAuthGuard`
- 功能：将指定 `set_core.id` 激活为当前版本
- 规则：
  1. 先按 `id` 查记录，不存在返回 404
  2. 取该记录的 `novel_id`
  3. 事务内执行：
     - `UPDATE set_core SET is_active = 0 WHERE novel_id = ?`
     - `UPDATE set_core SET is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  4. 返回激活后的完整记录（字段同 `GET /novels/:novelId/set-core`）

## 3) 版本切换规则说明

- 切换 active 时，只影响**同一个 `novel_id`** 的 set_core 记录。
- 不会影响其他小说的 set_core 记录。
- `GET /novels/:novelId/set-core` 仍只返回当前 active 版本。
- 现有 `POST /novels/:novelId/set-core:upsert` 逻辑保持不变（`update_active` / `new_version`）。

## 4) UI 交互说明（两个下拉职责）

在 `SetCoreEditor` 中新增了两个独立控件：

- **保存模式**
  - `update_active`：更新当前 active 版本
  - `new_version`：创建新版本并置为 active

- **历史版本**
  - 列出当前 `novelId` 下的全部版本（示例：`v3 - 标题`）
  - 当前 active 版本默认选中
  - 切换时先判断编辑器是否有未保存改动：
    - 有改动先弹出 `confirm('切换版本会覆盖当前编辑内容，是否继续？')`
    - 确认后调用激活接口
  - 激活成功后：
    1. 立即回填编辑器
    2. 重新拉取 versions 列表
    3. 刷新 `loadOverview()`，使 `worldview.core` 同步

## 5) API 返回样例（实测）

> 说明：以下实测基于 `novelId=1`，先通过 `/auth/login` 获取 token 后调用。

### `GET /novels/1/set-core/versions`

返回（节选）：

```json
[
  {
    "id": 4,
    "novelId": 1,
    "title": "",
    "version": 4,
    "isActive": 1,
    "createdAt": "2026-03-06T03:04:42.000Z",
    "updatedAt": "2026-03-06T03:04:42.000Z"
  },
  {
    "id": 3,
    "novelId": 1,
    "title": "",
    "version": 3,
    "isActive": 0,
    "createdAt": "2026-03-06T02:37:25.000Z",
    "updatedAt": "2026-03-06T02:37:25.000Z"
  }
]
```

### `POST /set-core/3/activate`

返回（节选）：

```json
{
  "id": 3,
  "novelId": 1,
  "title": "",
  "coreText": "（略）",
  "version": 3,
  "isActive": 1,
  "createdAt": "2026-03-06T02:37:25.000Z",
  "updatedAt": "2026-03-06T03:04:42.000Z"
}
```

### 再次 `GET /novels/1/set-core`

返回（节选）：

```json
{
  "id": 3,
  "novelId": 1,
  "version": 3,
  "isActive": 1
}
```

## 6) build 结果

- `pnpm --dir apps/api build` ✅ 通过
- `pnpm --dir apps/web build` ✅ 通过

## 7) 已知限制

- 历史版本切换目前是“选择即激活”，尚未增加“先预览后确认激活”的独立预览态。
- 未保存改动判断基于编辑器字段快照对比；若未来新增字段，需要同步更新快照结构。
