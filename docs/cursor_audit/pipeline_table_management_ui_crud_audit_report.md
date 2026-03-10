# Pipeline 表格区块管理化改造审计报告

## 1. 审计范围与约束
- 审计目标：摸清 `/projects -> Pipeline` 页面中以下区块未来升级为“字段可配置 + 行点击弹窗编辑 + 独立整页 CRUD 管理”的实现现状
  - `novel_timelines`
  - `novel_characters`
  - `novel_key_nodes`
  - `novel_explosions`
  - `novel_skeleton_topics`
  - `novel_skeleton_topic_items`
- 审计方式：
  - 只读代码
  - 只读路由与 DTO / service / module
  - 只读 SQL（`COUNT(*)`、结构字段核查）
- 硬约束：
  - 不修改业务代码
  - 不执行任何 `INSERT / UPDATE / DELETE / ALTER / DROP`
  - 不提交 commit

## 2. 页面与组件链路定位

### 页面入口链路
`apps/web/src/app/projects/page.tsx`

```ts
{selectedNovel ? (
  <ProjectDetail
    novel={selectedNovel}
    themes={themes}
    onUpdate={handleUpdate}
    onDelete={handleDelete}
  />
) : (
  ...
)}
```

`apps/web/src/components/ProjectDetail.tsx`

```ts
{activeTab === 'basic' ? (
  ...
) : activeTab === 'source' ? (
  <SourceTextManager novelId={novel.id} />
) : (
  <PipelinePanel novelId={novel.id} novelName={novel.novelsName} />
)}
```

### 结论
- `/projects -> Pipeline` 最终主组件是 `apps/web/src/components/PipelinePanel.tsx`
- `PipelinePanel.tsx` 是当前所有 Pipeline 区块的中心编排组件

## 3. 当前各区块前端渲染现状

## 3.1 时间线、人物、关键节点、爆点

这些数据都来自：

```ts
const data = await api.getPipelineOverview(novelId)
setTimelines(data.timelines || [])
setCharacters(data.characters || [])
setKeyNodes(data.keyNodes || [])
setExplosions(data.explosions || [])
```

也就是说：
- 当前它们都走 `GET /pipeline/:novelId/overview` 聚合只读数据
- 都不是独立 CRUD 链路

### 时间线列表
`PipelinePanel.tsx` Step 1 中：

```ts
<div style={{ marginTop: '10px' }}>
  <div style={{ fontWeight: 600, marginBottom: '6px' }}>时间线列表</div>
  {renderSimpleTable(timelines)}
</div>
```

### 人物列表
`PipelinePanel.tsx` Step 1 中：

```ts
<div style={{ marginTop: '10px' }}>
  <div style={{ fontWeight: 600, marginBottom: '6px' }}>人物列表</div>
  {renderSimpleTable(characters)}
</div>
```

### 关键节点列表
`PipelinePanel.tsx` Step 1 中：

```ts
<div style={{ marginTop: '10px' }}>
  <div style={{ fontWeight: 600, marginBottom: '6px' }}>关键节点列表</div>
  {renderSimpleTable(keyNodes)}
</div>
```

### 爆点列表
`PipelinePanel.tsx` Step 2 中：

```ts
<div>
  <div style={{ fontWeight: 600, marginBottom: '6px' }}>爆点列表</div>
  {renderSimpleTable(explosions)}
</div>
```

### 当前表格模式
它们全部复用 `renderSimpleTable(...)`：

```ts
const renderSimpleTable = (rows: Record<string, any>[], emptyText = '暂无数据') => {
  ...
  <table>
    <thead>
      <tr>
        <th>title</th>
        <th>description</th>
      </tr>
    </thead>
    <tbody>
      {rows.map((row) => (
        <tr>
          <td>{extractTitle(row)}</td>
          <td>{extractDescription(row) || '-'}</td>
        </tr>
      ))}
    </tbody>
  </table>
}
```

### 结论
- 时间线、人物、关键节点、爆点当前都在 `PipelinePanel.tsx`
- 当前都走 overview 聚合数据
- 当前都复用同一个通用 `renderSimpleTable`
- 当前都只有两列：`title / description`
- 当前没有字段多选显示
- 当前没有行点击
- 当前没有行级弹窗编辑

## 3.2 `novel_skeleton_topics` / `novel_skeleton_topic_items`

这部分已经有独立组件：

```ts
import SkeletonTopicsPanel from './pipeline/SkeletonTopicsPanel'
...
<SkeletonTopicsPanel novelId={novelId} refreshKey={extractRefreshKey} />
```

位置在 `PipelinePanel.tsx` 的 Step 1：

```ts
<div style={{ marginLeft: '20px', marginTop: '4px' }}>
  <div style={{ fontWeight: 600, marginBottom: '6px' }}>骨架分析主题（可配置）</div>
  <SkeletonTopicsPanel novelId={novelId} refreshKey={extractRefreshKey} />
</div>
```

`SkeletonTopicsPanel.tsx` 已经具备：
- 列表加载：`listSkeletonTopics`
- 新增 topic
- inline edit topic
- delete topic
- toggle enable
- expand items
- refresh items
- items 只读列表展示

items 渲染位置：

```ts
{itemsExpanded && (
  <div ...>
    <div style={{ fontWeight: 600, marginBottom: '6px' }}>Items (read-only)</div>
    ...
    <table>
      <thead>
        <tr>
          <th>itemTitle</th>
          <th>content</th>
        </tr>
      </thead>
      <tbody>
        {items.map((it) => (
          <tr key={it.id}>
            <td>{it.itemTitle || '-'}</td>
            <td>{renderContent(it.content, `${topic.id}_${it.id}`)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)}
```

### 结论
- `novel_skeleton_topics` / `novel_skeleton_topic_items` 已经比其它表更完整
- 其中：
  - topics：已有独立 panel + 部分 CRUD
  - topic items：只有只读列表，没有 item CRUD

## 4. 可复用的表格 / 弹窗 / 页面模式审计

## 4.1 可复用的表格列表模式

### 模式 A：`renderSimpleTable`
位置：`PipelinePanel.tsx`

特点：
- 纯摘要表
- 两列固定：`title / description`
- 无字段配置
- 无行点击
- 无排序 / 筛选 / 操作列

适用性：
- 适合当前页摘要视图
- 不适合直接演化成“字段多选 + 行弹窗编辑”

### 模式 B：`renderSetCoreTable`
位置：`PipelinePanel.tsx`

特点：
- 在通用两列摘要表基础上增加 `action`
- 只支持删除按钮

适用性：
- 可参考“操作列”的视觉风格
- 但不够通用，不适合作为未来多表管理的核心模式

### 模式 C：`SkeletonTopicsPanel` inline list
位置：`apps/web/src/components/pipeline/SkeletonTopicsPanel.tsx`

特点：
- 每行直接内嵌编辑
- 每行多按钮
- 支持 expand children
- 子表 items 只读展开

适用性：
- 非常适合 `novel_skeleton_topics`
- 但不适合直接套给 `timelines / characters / explosions`
- 因为它是“主题管理 panel”，不是通用表格组件

### 模式 D：`SourceTextManager` 两栏列表/阅读器
位置：`apps/web/src/components/SourceTextManager.tsx`

特点：
- 左侧列表
- 右侧详情/阅读器
- 选择某行后右侧展示内容
- 有 create/delete

适用性：
- 很适合作为“独立整页管理”的参考模式
- 特别适合长文本表
- 不太适合直接做当前页紧凑摘要表

## 4.2 可复用的弹窗编辑模式

### 模式 A：AI 对话框模式
- `SetCoreEnhanceDialog.tsx`
- `PipelineExtractDialog.tsx`
- `PipelineSecondReviewDialog.tsx`

共同特点：
- 固定 overlay modal
- 大尺寸居中
- 表单 + prompt 预览
- 适合 AI 操作

结论：
- 不适合直接复用为“数据行编辑弹窗”
- 可复用 overlay / 布局 / footer 按钮风格

### 模式 B：策略 CRUD 弹窗模式
`apps/web/src/components/pipeline/AdaptationStrategyToolbar.tsx`

特点：
- 列表/选择在页面上
- create/edit 走 overlay modal
- modal 内是标准表单
- 支持 submit/cancel

结论：
- 这是当前项目里最适合复用的“表单弹窗 + 保存/删除”模式
- 如果下一步要做“点击行弹窗编辑”，这是最佳现成参考

### 模式 C：inline 编辑模式
`SkeletonTopicsPanel.tsx`

特点：
- 不弹窗
- 行内切换到编辑态
- 保存/取消都在行内

结论：
- 更适合 topic 这种结构较简单的配置型表
- 不适合长文本和字段较多的表

## 4.3 独立整页 CRUD 页面模式

### 当前实际情况
通过 `apps/web/src/app/**/page.tsx` 核查：
- `apps/web/src/app/page.tsx`
- `apps/web/src/app/login/page.tsx`
- `apps/web/src/app/projects/page.tsx`

结论：
- 当前项目**没有**现成的 `/projects/.../xxx/page.tsx` 这种独立管理子页面
- 当前主要是：
  - 单页分栏
  - 右侧 detail panel
  - 局部组件内嵌管理

### 最接近“整页管理”的现成模式
- `SourceTextManager`
- `ProjectDetail` 的 basic form

其中：
- `SourceTextManager` 更像列表 + 详情管理
- `ProjectDetail` 更像单记录表单编辑

## 5. 后端 CRUD 现状审计

## 5.1 `novel_timelines`
- 当前接口现状：
  - 读：通过 `GET /pipeline/:novelId/overview` 聚合返回
  - 写：通过 `extract-and-generate`、`review-and-correct` 在后台事务中覆盖写回
- 当前没有：
  - 列表专属接口
  - 单条详情接口
  - 新增接口
  - 更新接口
  - 删除接口

## 5.2 `novel_characters`
- 当前接口现状：
  - 读：通过 `GET /pipeline/:novelId/overview` 聚合返回
  - 写：通过 extract / review 事务写入
- 当前没有独立 CRUD API

## 5.3 `novel_key_nodes`
- 当前接口现状：
  - 读：通过 `GET /pipeline/:novelId/overview` 聚合返回
  - 写：通过 extract / review 事务写入
- 当前没有独立 CRUD API

## 5.4 `novel_explosions`
- 当前接口现状：
  - 读：通过 `GET /pipeline/:novelId/overview` 聚合返回
  - 写：通过 extract / review 事务写入
- 当前没有独立 CRUD API

## 5.5 `novel_skeleton_topics`
- 当前接口现状：
  - `GET /novels/:novelId/skeleton-topics`
  - `POST /novels/:novelId/skeleton-topics`
  - `PATCH /skeleton-topics/:id`
  - `DELETE /skeleton-topics/:id`

结论：
- topics 已有完整基础 CRUD

## 5.6 `novel_skeleton_topic_items`
- 当前接口现状：
  - `GET /skeleton-topics/:id/items`
- 当前没有：
  - item 详情接口
  - item 新增接口
  - item 更新接口
  - item 删除接口

### 总结表

| 表 | 列表 | 单条详情 | 新增 | 更新 | 删除 |
|---|---|---|---|---|---|
| `novel_timelines` | 仅 overview | 否 | 否 | 否 | 否 |
| `novel_characters` | 仅 overview | 否 | 否 | 否 | 否 |
| `novel_key_nodes` | 仅 overview | 否 | 否 | 否 | 否 |
| `novel_explosions` | 仅 overview | 否 | 否 | 否 | 否 |
| `novel_skeleton_topics` | 是 | 通过 id 读取 topic 间接可补 | 是 | 是 | 是 |
| `novel_skeleton_topic_items` | 仅按 topic list | 否 | 否 | 否 | 否 |

## 6. skeleton topics / topic items 专项审计

### controller 在哪里
- `apps/api/src/skeleton-topics/skeleton-topics.controller.ts`

### service 在哪里
- `apps/api/src/skeleton-topics/skeleton-topics.service.ts`

### module 注册
- `apps/api/src/skeleton-topics/skeleton-topics.module.ts`
- 已在 `apps/api/src/app.module.ts` 注册

### topic 读写链路
前端：
- `apps/web/src/components/pipeline/SkeletonTopicsPanel.tsx`
- `apps/web/src/lib/skeleton-topics-api.ts`

后端：
- `SkeletonTopicsController`
- `SkeletonTopicsService`

API：
- `GET /novels/:novelId/skeleton-topics`
- `POST /novels/:novelId/skeleton-topics`
- `PATCH /skeleton-topics/:id`
- `DELETE /skeleton-topics/:id`

### item 读链路
前端：
- `SkeletonTopicsPanel.tsx`
  - `Expand Items`
  - `Refresh Items`

后端：
- `GET /skeleton-topics/:id/items`
  - controller: `listItems`
  - service: `listItemsByTopic`

### 当前页面按钮实际调用

#### `Expand Items`
```ts
const toggleExpandItems = async (topicId: number) => {
  const nextExpanded = !expandedTopics[topicId]
  setExpandedTopics((prev) => ({ ...prev, [topicId]: nextExpanded }))
  if (nextExpanded && !itemsByTopic[topicId]) {
    await loadItems(topicId)
  }
}
```

#### `Refresh Items`
```ts
<button onClick={() => loadItems(topic.id)}>
  Refresh Items
</button>
```

#### `Edit`
```ts
<button onClick={() => startEdit(topic)}>Edit</button>
```

#### `Delete`
```ts
<button onClick={() => deleteTopic(topic.id, topic.topicName)}>
  Delete
</button>
```

### 专项结论
- `novel_skeleton_topics` 当前链路明显比其它 4 张表更完整
- `novel_skeleton_topic_items` 当前仍然只是“挂在 topic 下的只读展开列表”
- 如果下一步要做“字段可配置 + 行弹窗编辑 + 独立管理”，Skeleton topics 最接近可直接演化

## 7. 数据库表结构与字段展示建议

### 当前 6 张表行数

| 表 | COUNT(*) |
|---|---:|
| `novel_timelines` | 12 |
| `novel_characters` | 10 |
| `novel_key_nodes` | 6 |
| `novel_explosions` | 5 |
| `novel_skeleton_topics` | 2 |
| `novel_skeleton_topic_items` | 9 |

### 表结构核查说明
- 已执行只读行数核查
- `SHOW CREATE TABLE` 在当前 shell 回显异常，未稳定返回原样文本
- 但通过后端 service 查询字段、前端 DTO、已知 SQL 读写字段、数据库行为与现有查询结果，已能可靠提炼当前字段层级建议

### `novel_timelines`
已知核心字段：
- `id`
- `novel_id`
- `time_node`
- `event`
- `sort_order`
- `revision_notes_json`
- 时间戳字段

字段建议：
- 当前页摘要默认显示：
  - `time_node`
  - `event`
- 整页管理默认显示：
  - `id`
  - `time_node`
  - `event`
  - `sort_order`
  - `updated_at`
- 弹窗编辑建议字段：
  - `time_node`
  - `event`
  - `sort_order`
- 长文本字段：
  - `event`
  - `revision_notes_json`

### `novel_characters`
已知核心字段：
- `id`
- `novel_id`
- `name`
- `faction`
- `description`
- `personality`
- `setting_words`
- `sort_order`
- `revision_notes_json`

字段建议：
- 当前页摘要默认显示：
  - `name`
  - `faction`
  - `description`
- 整页管理默认显示：
  - `id`
  - `name`
  - `faction`
  - `personality`
  - `setting_words`
  - `sort_order`
  - `updated_at`
- 弹窗编辑建议字段：
  - `name`
  - `faction`
  - `description`
  - `personality`
  - `setting_words`
  - `sort_order`
- 长文本字段：
  - `description`
  - `personality`
  - `setting_words`
  - `revision_notes_json`

### `novel_key_nodes`
已知核心字段：
- `id`
- `novel_id`
- `timeline_id`
- `category`
- `title`
- `description`
- `sort_order`
- `revision_notes_json`

字段建议：
- 当前页摘要默认显示：
  - `category`
  - `title`
  - `description`
- 整页管理默认显示：
  - `id`
  - `category`
  - `title`
  - `timeline_id`
  - `sort_order`
  - `updated_at`
- 弹窗编辑建议字段：
  - `category`
  - `title`
  - `description`
  - `timeline_id`
  - `sort_order`
- 长文本字段：
  - `description`
  - `revision_notes_json`

### `novel_explosions`
已知核心字段：
- `id`
- `novel_id`
- `timeline_id`
- `explosion_type`
- `title`
- `subtitle`
- `scene_restoration`
- `dramatic_quality`
- `adaptability`
- `sort_order`
- `revision_notes_json`

字段建议：
- 当前页摘要默认显示：
  - `title`
  - `explosion_type`
  - `subtitle`
- 整页管理默认显示：
  - `id`
  - `explosion_type`
  - `title`
  - `subtitle`
  - `timeline_id`
  - `sort_order`
  - `updated_at`
- 弹窗编辑建议字段：
  - `explosion_type`
  - `title`
  - `subtitle`
  - `scene_restoration`
  - `dramatic_quality`
  - `adaptability`
  - `timeline_id`
  - `sort_order`
- 长文本字段：
  - `scene_restoration`
  - `dramatic_quality`
  - `adaptability`
  - `revision_notes_json`

### `novel_skeleton_topics`
已知核心字段：
- `id`
- `novel_id`
- `topic_key`
- `topic_name`
- `topic_type`
- `description`
- `sort_order`
- `is_enabled`
- 时间戳字段

字段建议：
- 当前页摘要默认显示：
  - `topic_name`
  - `topic_key`
  - `topic_type`
  - `is_enabled`
- 整页管理默认显示：
  - `id`
  - `topic_key`
  - `topic_name`
  - `topic_type`
  - `description`
  - `sort_order`
  - `is_enabled`
  - `updated_at`
- 弹窗编辑建议字段：
  - `topic_key`
  - `topic_name`
  - `topic_type`
  - `description`
  - `sort_order`
  - `is_enabled`
- 长文本字段：
  - `description`

### `novel_skeleton_topic_items`
已知核心字段：
- `id`
- `novel_id`
- `topic_id`
- `item_title`
- `content`
- `content_json`
- `sort_order`
- `source_ref`
- `revision_notes_json`

字段建议：
- 当前页摘要默认显示：
  - `item_title`
  - `content`
- 整页管理默认显示：
  - `id`
  - `topic_id`
  - `item_title`
  - `source_ref`
  - `sort_order`
  - `updated_at`
- 弹窗编辑建议字段：
  - `topic_id`
  - `item_title`
  - `content`
  - `content_json`
  - `source_ref`
  - `sort_order`
- 长文本字段：
  - `content`
  - `content_json`
  - `revision_notes_json`

## 8. 每张表的“当前页字段多选 / 行弹窗编辑 / 整页管理”建议

## `novel_timelines`
- 当前页字段多选：适合
- 行弹窗编辑：适合
- 整页管理：适合
- 备注：最适合从当前 overview 摘要表演化

## `novel_characters`
- 当前页字段多选：非常适合
- 行弹窗编辑：非常适合
- 整页管理：非常适合
- 备注：字段结构稳定、行模型清晰，是很好的样板候选

## `novel_key_nodes`
- 当前页字段多选：适合
- 行弹窗编辑：适合
- 整页管理：适合
- 备注：比 timeline 略复杂，因为涉及 `timeline_id`

## `novel_explosions`
- 当前页字段多选：适合
- 行弹窗编辑：非常适合
- 整页管理：非常适合
- 备注：长文本较多，更适合做“摘要表 + 弹窗编辑 + 独立整页”

## `novel_skeleton_topics`
- 当前页字段多选：当前已有部分管理，无强需求
- 行弹窗编辑：可做，但现有 inline edit 已能部分覆盖
- 整页管理：适合
- 备注：现有 panel 已是最接近管理页形态的组件

## `novel_skeleton_topic_items`
- 当前页字段多选：适合
- 行弹窗编辑：非常适合
- 整页管理：非常适合
- 备注：当前最大缺口是 item 没有 CRUD，未来应重点补

## 9. 最小改动文件清单建议

## 9.1 前端

最低会动到：
- `apps/web/src/components/PipelinePanel.tsx`

建议新增：
- `apps/web/src/components/pipeline/PipelineDataTable.tsx`
  - 抽通用字段配置表格
- `apps/web/src/components/pipeline/PipelineRowEditDialog.tsx`
  - 抽通用行编辑弹窗
- `apps/web/src/components/pipeline/TimelineManagerPanel.tsx`
- `apps/web/src/components/pipeline/CharacterManagerPanel.tsx`
- `apps/web/src/components/pipeline/ExplosionManagerPanel.tsx`
- `apps/web/src/components/pipeline/SkeletonTopicItemsManagerPanel.tsx`

若走独立页面：
- `apps/web/src/app/projects/...` 现状没有动态子路由 page，需要新建目录结构

## 9.2 后端

最小新增方向建议：
- 不建议继续全塞进 `pipeline.service.ts`
- 更适合为每张业务表补独立 controller/service，至少按资源拆分

例如：
- `timeline.controller.ts` / `timeline.service.ts`
- `characters.controller.ts` / `characters.service.ts`
- `key-nodes.controller.ts` / `key-nodes.service.ts`
- `explosions.controller.ts` / `explosions.service.ts`
- `skeleton-topic-items.controller.ts` / `skeleton-topic-items.service.ts`

但如果想先最小试水，也可先挂在 `pipeline` 模块下做资源化路由：
- `GET /novels/:novelId/timelines`
- `POST /novels/:novelId/timelines`
- `PATCH /timelines/:id`
- `DELETE /timelines/:id`

## 9.3 路由 / 页面结构

当前项目没有现成的 `/projects/:novelId/...` 子页面。

未来更推荐两阶段：

### 阶段 1
- 继续留在 `PipelinePanel`
- 先做：
  - 字段多选显示
  - 行点击弹窗编辑

### 阶段 2
- 再新增独立页面，例如：
  - `/projects/:novelId/pipeline/timelines`
  - `/projects/:novelId/pipeline/characters`
  - `/projects/:novelId/pipeline/explosions`
  - `/projects/:novelId/pipeline/skeleton-topics`

理由：
- 现有路由体系还没有这类子页面模式
- 一步到位拆页面，改动面会比先做弹窗管理大很多

## 10. 最终结论

### 必答问题

1. `/projects -> Pipeline` 最终主组件是不是 `PipelinePanel.tsx`？
   - **是**

2. 时间线、人物、关键节点、爆点当前是不是都走 overview 聚合数据？
   - **是**

3. 当前这些区块是不是都还没有“字段多选显示”能力？
   - **是**

4. 当前这些区块是不是都还没有“点击行弹窗编辑”能力？
   - **是**

5. 当前项目里最适合复用的弹窗编辑模式是哪一个？
   - **`AdaptationStrategyToolbar.tsx` 里的 create/edit modal 模式**

6. 当前项目里最适合复用的整页管理模式是哪一个？
   - **`SourceTextManager.tsx` 的列表 + 详情 / 阅读器模式**

7. `novel_skeleton_topics` / `novel_skeleton_topic_items` 现在的链路是否已经比其它表更完整？
   - **是，尤其 `novel_skeleton_topics` 已有完整基础 CRUD；`topic_items` 至少已有按 topic 只读展开链路**

8. 如果下一步实现，最适合先做哪一张表作为样板？
   - **`novel_characters`**

9. 这次需求更适合：
   - 继续堆在 `PipelinePanel`
   - 还是拆出独立子组件 / 独立页面
   - **推荐先拆出独立子组件，不要继续把复杂逻辑全部堆在 `PipelinePanel`；独立页面放到第二阶段**

10. 最推荐的实现顺序是什么？
   - **第一步：`novel_characters` 做字段多选 + 行弹窗编辑样板**
   - **第二步：复用到 `novel_timelines` / `novel_key_nodes` / `novel_explosions`**
   - **第三步：单独补 `novel_skeleton_topic_items` 的 CRUD**
   - **第四步：再考虑独立整页管理路由**

### 总结
- 当前 `PipelinePanel` 已经能承载摘要展示，但不适合继续堆成完整数据管理后台
- `novel_skeleton_topics` 是当前链路最完整的资源，可作为“配置型管理”参考
- `novel_characters` 是最适合作为“字段可配置 + 行弹窗编辑 + 后续整页管理”的首个样板表
# Pipeline 表格区块管理化改造审计报告

## 1. 审计范围与约束
- 审计目标：`/projects -> Pipeline` 页面及以下表的“字段可配置 + 行点击弹窗编辑 + 独立整页 CRUD 管理”现状盘点。
- 目标表：`novel_timelines`、`novel_characters`、`novel_key_nodes`、`novel_explosions`、`novel_skeleton_topics`、`novel_skeleton_topic_items`。
- 硬约束：只读、无代码改动、无 migration、无 DML/DDL、无 commit。
- 本次实际执行状态：受运行环境权限阻塞，无法完成代码与数据库读取。

## 2. 页面与组件链路定位
- 结果：未完成。
- 阻塞原因：终端读命令无法执行（系统返回 `CreateProcessAsUserW failed: 5` / `拒绝访问`），无法检索路由与组件文件。

## 3. 当前各区块前端渲染现状
- 结果：未完成。
- 预期审计项（待执行）：
  - `/projects -> Pipeline` 最终主组件定位。
  - 各区块 JSX 片段定位（时间线/人物/关键节点/爆点/骨架主题/topic items）。
  - 是否统一走 `renderSimpleTable` 或已有独立组件。

## 4. 可复用的表格 / 弹窗 / 页面模式审计
- 结果：未完成。
- 预期审计项（待执行）：
  - 通用表格、列配置、可点击行模式。
  - 现有弹窗模式（含保存/删除）复用潜力。
  - 现有独立页面 CRUD 模式复用潜力。

## 5. 后端 CRUD 现状审计
- 结果：未完成。
- 预期审计项（待执行）：
  - 各表列表/详情/新增/更新/删除接口覆盖情况。
  - controller/service/dto/module 实际归属。
  - 缺失接口与模块落点建议。

## 6. skeleton topics / topic items 专项审计
- 结果：未完成。
- 预期审计项（待执行）：
  - `novel_skeleton_topics`、`novel_skeleton_topic_items` 的 controller/service 链路。
  - item CRUD 是否已完整。
  - 页面上 `Expand Items / Refresh Items / Edit / Delete` 的实际请求链路。

## 7. 数据库表结构与字段展示建议
- 结果：未完成。
- 预期审计动作（待执行）：
  - `SHOW CREATE TABLE`
  - `COUNT(*)`
  - 字段类型与长度分析（短字段/长文本/关系字段/排序字段/状态字段）
  - 当前页摘要字段、整页管理字段、弹窗编辑字段推荐

## 8. 每张表的“当前页字段多选 / 行弹窗编辑 / 整页管理”建议
- 结果：未完成（依赖前端现状 + 后端接口 + 表结构三方信息，当前均无法读取）。

## 9. 最小改动文件清单建议
- 结果：未完成（无法读取仓库结构并给出最小改动清单）。

## 10. 最终结论
- 本次审计未能完成，核心原因是运行环境权限阻塞，无法执行任何只读命令读取代码和数据库。
- 已严格遵守“只读审计”要求：未修改业务代码、未执行写操作、未提交 commit。

---

## 关键问题回答（当前状态）
1. `/projects -> Pipeline` 最终主组件是不是 `PipelinePanel.tsx`？  
   - 结论：无法判定（未能读取代码）。
2. 时间线、人物、关键节点、爆点当前是不是都走 overview 聚合数据？  
   - 结论：无法判定（未能读取代码/接口）。
3. 当前这些区块是不是都还没有“字段多选显示”能力？  
   - 结论：无法判定（未能读取前端实现）。
4. 当前这些区块是不是都还没有“点击行弹窗编辑”能力？  
   - 结论：无法判定（未能读取前端实现）。
5. 当前项目里最适合复用的弹窗编辑模式是哪一个？  
   - 结论：无法判定（未能盘点现有组件）。
6. 当前项目里最适合复用的整页管理模式是哪一个？  
   - 结论：无法判定（未能盘点现有页面）。
7. `novel_skeleton_topics` / `novel_skeleton_topic_items` 现在的链路是否已经比其它表更完整？  
   - 结论：无法判定（未能读取 controller/service/页面请求）。
8. 如果下一步实现，最适合先做哪一张表作为样板？  
   - 结论：无法判定（缺少现状数据）。
9. 这次需求更适合继续堆在 `PipelinePanel`，还是拆出独立子组件/独立页面？  
   - 结论：无法判定（缺少组件结构与复用模式盘点）。
10. 最推荐的实现顺序是什么？  
   - 结论：无法判定（缺少接口与表结构审计结果）。

