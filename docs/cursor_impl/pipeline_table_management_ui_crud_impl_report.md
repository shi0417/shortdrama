# Pipeline 表格区块管理化改造实现报告

## 1. 修改/新增文件清单

### 后端
- `apps/api/src/pipeline/dto/pipeline-resource.dto.ts`
- `apps/api/src/pipeline/pipeline-resource.service.ts`
- `apps/api/src/pipeline/pipeline-resource.controller.ts`
- `apps/api/src/pipeline/pipeline.controller.ts`
- `apps/api/src/pipeline/pipeline.module.ts`

### 前端
- `apps/web/src/types/pipeline-resource.ts`
- `apps/web/src/lib/pipeline-resource-api.ts`
- `apps/web/src/components/pipeline/PipelineDataTable.tsx`
- `apps/web/src/components/pipeline/PipelineRowEditDialog.tsx`
- `apps/web/src/components/pipeline/PipelineDataSection.tsx`
- `apps/web/src/components/pipeline/PipelineResourceManagerPage.tsx`
- `apps/web/src/app/projects/[novelId]/pipeline/[resource]/page.tsx`
- `apps/web/src/components/PipelinePanel.tsx`

### 报告
- `docs/cursor_impl/pipeline_table_management_ui_crud_impl_report.md`

## 2. 新增后端接口清单

新增资源白名单：
- `timelines`
- `characters`
- `key-nodes`
- `explosions`
- `skeleton-topics`
- `skeleton-topic-items`

新增接口：

### 列表
- `GET /novels/:novelId/pipeline-resources/:resource`

说明：
- 按 `novel_id` 过滤
- 默认按 `sort_order ASC, id ASC`
- `skeleton-topic-items` 支持 `topicId` query

### 单条详情
- `GET /pipeline-resources/:resource/:id`

### 新增
- `POST /novels/:novelId/pipeline-resources/:resource`

### 更新
- `PATCH /pipeline-resources/:resource/:id`

### 删除
- `DELETE /pipeline-resources/:resource/:id`

实现方式：
- 使用 `PipelineResourceService` 做资源配置驱动映射
- 严格白名单映射资源名到真实表
- 仅允许白名单字段写入
- `skeleton-topic-items` 校验 `topic_id` 属于当前 `novel_id`
- `key-nodes` / `explosions` 若带 `timeline_id`，校验其属于当前 `novel_id`

## 3. 前端当前页区块改造说明

本次没有继续把更多逻辑硬塞在 `PipelinePanel.tsx` 里，而是抽成通用资源区块组件：
- `PipelineDataSection.tsx`
- `PipelineDataTable.tsx`
- `PipelineRowEditDialog.tsx`

### 当前页已接入的区块
在 `PipelinePanel.tsx` 中，以下区块已切换到新框架：
- 时间线列表
- 人物列表
- 关键节点列表
- 爆点列表
- 骨架主题抽取结果（topic items）

### 当前页新能力
每个已接入区块现在支持：
- 标题可点击跳转整页管理
- 右侧“字段显示”入口
- 当前页字段多选显示
- 字段显示配置按 `resource + novelId + section` 存进 `localStorage`
- 点击任意行，弹出通用编辑弹窗
- 在弹窗里保存 / 删除

### 当前页样板完成情况
按你的优先级要求，这一版已经让 `novel_characters` 作为样板完整进入同一套框架。
同时由于区块组件已抽通，`timelines / key-nodes / explosions / skeleton-topic-items` 也共享了同一机制。

## 4. 整页管理页面实现说明

新增路由：
- `apps/web/src/app/projects/[novelId]/pipeline/[resource]/page.tsx`

新增页面组件：
- `apps/web/src/components/pipeline/PipelineResourceManagerPage.tsx`

### 支持的资源页面
- `/projects/[novelId]/pipeline/timelines`
- `/projects/[novelId]/pipeline/characters`
- `/projects/[novelId]/pipeline/key-nodes`
- `/projects/[novelId]/pipeline/explosions`
- `/projects/[novelId]/pipeline/skeleton-topics`
- `/projects/[novelId]/pipeline/skeleton-topic-items`

### 页面能力
- 顶部显示当前资源标题和 `novelId`
- 返回 `/projects` 按钮
- `新增` 按钮
- `字段显示` 设置
- `刷新` 按钮
- 列表展示当前 `novel_id` 下的全部数据
- 点击行打开编辑弹窗
- 弹窗支持新增 / 编辑 / 删除

### 字段显示配置
整页字段显示配置按：
- `resource + novelId + page`

保存到 `localStorage`

## 5. 通用字段多选与行编辑弹窗说明

### 资源配置驱动
新增：
- `apps/web/src/types/pipeline-resource.ts`

其中集中定义了：
- 资源名
- 标题
- 路由段
- 当前页默认字段
- 整页默认字段
- 每个字段的 label / type / editable / readonly

这保证：
- 不需要为 6 张表手写 6 套重复逻辑
- 当前页和整页都能走同一套字段配置

### 通用表格
`PipelineDataTable.tsx`

能力：
- 动态列
- 行点击
- 长文本截断显示
- JSON 字段字符串化显示

### 通用弹窗
`PipelineRowEditDialog.tsx`

能力：
- 新增 / 编辑共用
- 短字段走 `input`
- 长文本和 JSON 走 `textarea`
- `boolean` 字段走下拉
- `revision_notes_json` 只读展示
- `created_at / updated_at / id / novel_id` 只读展示
- 支持保存 / 删除 / 取消

## 6. skeleton topics / topic items 特殊处理说明

### `novel_skeleton_topics`
保留了现有：
- `SkeletonTopicsPanel.tsx`
- topic 的 create / inline edit / delete / toggle enabled / expand items

并补了：
- 当前页标题跳整页管理
- 可进入 `/projects/[novelId]/pipeline/skeleton-topics`

### `novel_skeleton_topic_items`
本次没有去硬改 `SkeletonTopicsPanel` 里原有的只读 items 展开逻辑，
而是新增了统一管理路径：
- 当前页 `PipelineDataSection`
- 整页 `/projects/[novelId]/pipeline/skeleton-topic-items`

配套后端也补了：
- `skeleton-topic-items` 资源化 CRUD

说明：
- 这样既保留现有 topics panel 的工作流
- 又把 topic items 纳入统一的字段配置 / 弹窗编辑 / 整页管理体验

## 7. build 结果

本轮执行了：
- `pnpm --dir apps/api build`
- `pnpm --dir apps/web build`

在当前 shell 工具环境里，命令返回 `exit code 0`，但标准输出没有稳定回传完整日志。

补充验证：
- `ReadLints` 未发现本轮改动文件的 linter / 类型错误

因此本报告保守表述为：
- 后端构建命令返回成功
- 前端构建命令返回成功
- 当前改动文件范围内无已知 lint 报错

## 8. 联调结果

本轮完成的是：
- 后端资源化 CRUD 接口落地
- 前端当前页区块管理化接入
- 独立整页管理页落地
- `novel_characters` 样板链路进入统一框架
- 其余资源按同一套配置与组件复用

本轮未完成的是：
- 完整浏览器手点回归
- 对每一个资源分别做真实 create / update / delete 联调记录

因此当前联调结论应视为：
- **代码闭环已建立**
- **静态构建与类型层面无阻塞**
- **浏览器级完整 CRUD 回归仍建议下一步执行**

## 9. 已知限制

### 1. `skeleton-topics` 当前页还是旧 panel + 新跳转入口的混合形态
即：
- 当前页仍保留 `SkeletonTopicsPanel` 的原有 inline 管理
- 整页管理另走新框架

这是为了不破坏现有使用习惯，但也意味着当前页和整页的 UI 一致性还不是完全统一。

### 2. `topic_type` 当前在通用弹窗里先按普通文本字段编辑
没有额外做严格枚举下拉优化。

### 3. `content_json` 当前在通用弹窗里按 JSON textarea 编辑
具备基础 JSON 校验，但没有做结构化 JSON 表单。

### 4. 当前返回 `/projects` 只能回到项目页入口
不会自动恢复你上一次在 `/projects` 中选中的具体 novel 和 tab 状态。

### 5. 本轮优先保证统一框架与 `novel_characters` 样板
所以一些资源的“更友好的字段展示”仍可继续细化，例如：
- `skeleton-topic-items` 可追加 `topic_name/topic_key`
- `key-nodes / explosions` 可追加 timeline 的展示别名

## 结论
本轮已经把 `/projects -> Pipeline` 的数据区块从“只读摘要表”推进到“可配置显示 + 行弹窗编辑 + 可跳独立管理页”的统一框架：
- 后端不再只靠 overview 聚合读
- 前端不再只有 `renderSimpleTable(...)`
- `novel_characters` 样板已经完整跑进新框架
- 其它资源已在同一套配置/组件上复用

如果下一步继续推进，最自然的后续是：
- 先做一轮浏览器联调验收，确认 `novel_characters` 的新增/编辑/删除完整跑通
- 再补一轮细化，重点提升：
  - `skeleton-topics` 当前页与整页的一致性
  - `skeleton-topic-items` 的 topic 上下文展示
  - 若需要，再补真正的表单级枚举/关联选择器体验
