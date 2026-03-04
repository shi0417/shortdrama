# Batch 2A-2 实现报告：Skeleton Topics 前端 CRUD UI

## 1. 实现范围与约束确认

- 仅改动 `apps/web` 前端代码
- 未改 `apps/api` 后端代码
- 未改数据库结构、未新增 migration
- 本批实现范围：
  - Topic 管理（新增/编辑/删除/启用状态切换）
  - Topic Items 只读查看（展开加载）
- 未实现：
  - items 写入
  - AI 调用/生成

---

## 2. 新增/修改文件清单

### 新增文件

- `apps/web/src/types/pipeline.ts`
- `apps/web/src/lib/skeleton-topics-api.ts`
- `apps/web/src/components/pipeline/SkeletonTopicsPanel.tsx`

### 修改文件

- `apps/web/src/components/PipelinePanel.tsx`
- `apps/web/src/lib/api.ts`

---

## 3. 关键 API 方法签名（前端）

### 3.1 可复用请求助手

文件：`apps/web/src/lib/api.ts`

```ts
export async function apiClient(endpoint: string, options: RequestInit = {})
```

说明：继续复用同一套 `API_BASE_URL + Bearer token(localStorage.accessToken)` 逻辑。

### 3.2 Skeleton Topics API

文件：`apps/web/src/lib/skeleton-topics-api.ts`

```ts
listSkeletonTopics(novelId: number): Promise<SkeletonTopicDto[]>
createSkeletonTopic(novelId: number, payload: CreateSkeletonTopicPayload): Promise<SkeletonTopicDto>
updateSkeletonTopic(id: number, payload: UpdateSkeletonTopicPayload): Promise<SkeletonTopicDto>
deleteSkeletonTopic(id: number): Promise<{ ok: true }>
listSkeletonTopicItems(topicId: number): Promise<SkeletonTopicItemDto[]>
```

---

## 4. UI 改动说明（/projects -> Pipeline -> Step1）

文件：`apps/web/src/components/PipelinePanel.tsx`

- 在 Step1 中：
  - 保留 timeline/characters/keyNodes 只读列表
  - 将“骨架主题列表”改为真实管理区：
    - `<SkeletonTopicsPanel novelId={novelId} />`
  - 去掉原来的“新增骨架分析主题”静态 checkbox 行，避免误导

文件：`apps/web/src/components/pipeline/SkeletonTopicsPanel.tsx`

### 已实现功能

1. **新增主题表单**（默认折叠）
   - 字段：`topicName`（必填）、`topicType`、`description`、`sortOrder`、`isEnabled`
   - `topicKey` 两种模式：
     - 自动生成（默认）：由 `topicName` slugify 成 `[a-z0-9_]`
     - 手动模式（高级）：用户可手填
   - 自动模式下遇到 409 冲突：自动重试 key（`_2/_3`）最多 3 次

2. **主题列表管理**
   - 显示：`topicName/topicKey/topicType/isEnabled/sortOrder`
   - 操作：`Edit/Save/Cancel/Delete/Toggle Enabled/Refresh Items/Expand Items`

3. **Items 只读展开**
   - `Expand Items` 时调用 `GET /skeleton-topics/:id/items`
   - 显示 `itemTitle + content`
   - content 超长支持 `show more / show less`
   - 无数据时显示“暂无 items”

4. **错误处理与刷新策略**
   - 409：提示冲突
   - 其他错误：`alert` 或 inline error（与现有风格一致）
   - 新增/编辑/删除/切换启用后：重新拉取 `listSkeletonTopics(novelId)`

---

## 5. 验证结果

### 构建验证

执行：

```bash
pnpm --dir apps/web build
```

结果：通过。

### UI 验证步骤（验收点）

1. 打开 `/projects`
2. 选择一个 project
3. 切换到 `Pipeline` -> `Step1`
4. 在“骨架分析主题管理”区域验证：
   - 新增主题：提交后列表立即出现
   - 编辑主题：修改 `topicName/description/type/sortOrder/isEnabled` 后保存
   - 删除主题：二次确认后删除
   - 展开 items：可看到 items 列表或“暂无 items”
5. 刷新页面后再次进入同项目 Pipeline：
   - 已新增主题仍存在（说明写入成功）
6. 回到 Basic / Reference Tabs：
   - 功能不受影响

---

## 6. 已知限制（本批）

- 不包含 items 创建/编辑/删除写入能力
- 不调用 AI，不包含“抽取生成 items”逻辑
- 列表/编辑使用内联样式，保持与现有 `PipelinePanel` 风格一致，未引入新 UI 框架

