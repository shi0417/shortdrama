# Pipeline 二次AI自检实现报告

## 1. 修改/新增文件清单

### 数据库 / SQL
- `apps/api/sql/20260308_add_revision_notes_json_to_pipeline_result_tables.sql`

### 后端
- `apps/api/src/pipeline/dto/pipeline-second-review.dto.ts`
- `apps/api/src/pipeline/pipeline-review.service.ts`
- `apps/api/src/pipeline/pipeline.controller.ts`
- `apps/api/src/pipeline/pipeline.module.ts`

### 前端
- `apps/web/src/types/pipeline-review.ts`
- `apps/web/src/lib/pipeline-review-api.ts`
- `apps/web/src/components/pipeline/PipelineSecondReviewDialog.tsx`
- `apps/web/src/components/PipelinePanel.tsx`

## 2. 新增接口清单
- `POST /pipeline/:novelId/review-preview-prompt`
  - 作用：组装二次AI自检 prompt 预览
  - 鉴权：`JwtAuthGuard`
- `POST /pipeline/:novelId/review-and-correct`
  - 作用：执行单轮 review / 纠偏，并按勾选目标表事务覆盖写回
  - 鉴权：`JwtAuthGuard`

## 3. review prompt 设计摘要
- review 语义与首轮 extract 分离，明确告诉 AI：这不是重新裸生成，而是对“当前数据库已生成结果”做核对、补漏、去重、纠偏、强化爆点质量。
- prompt 输入分三块：
  - 当前检测对象表的现有结果
  - 参考资料表内容
  - 启用中的 `novel_skeleton_topics`
- 对 `skeletonTopicItems` 的输入不是只喂 item 表，而是带上 `topicKey / topicName / topicType / description / 当前 items`，保证 AI 能围绕 topic 定义纠偏。
- 对未勾选的目标表，prompt 明确要求 AI 返回空数组，避免误覆盖。

## 4. targetTables / referenceTables 处理规则

### targetTables
- 支持：
  - `novel_timelines`
  - `novel_characters`
  - `novel_key_nodes`
  - `novel_skeleton_topic_items`
  - `novel_explosions`
- 后端只删除、只重写用户勾选的目标表。
- 未勾选的表不会被主动删除或重写。
- 特殊保护：
  - 若勾选 `novel_timelines`，必须同时勾选 `novel_key_nodes` 和 `novel_explosions`
  - 原因：这两个表带 `timeline_id` 外键，若单独删改 timelines，会导致未勾选表出现被动关联变化

### referenceTables
- 支持：
  - `drama_novels`
  - `drama_source_text`
  - `novel_adaptation_strategy`
  - `adaptation_modes`
  - `set_core`
- 前端可多选；后端默认兜底为这 5 张表全选。
- 系统固定自动补充启用中的 `novel_skeleton_topics`，不暴露给前端勾选。

## 5. revision_notes_json 落地方式
- 已通过 SQL 给以下 5 张结果表新增 `revision_notes_json LONGTEXT NULL`
  - `novel_timelines`
  - `novel_characters`
  - `novel_key_nodes`
  - `novel_skeleton_topic_items`
  - `novel_explosions`
- 保存格式：JSON 字符串
- 当前实现写法：
  - 由于 review 采用“删旧重建”的覆盖策略，新插入的每一行都会带上当前批次的 revision notes
  - notes 字段至少包含：
    - `reviewedAt`
    - `reviewModel`
    - `reviewBatchId`
    - `targetTable`
    - `action`
    - `reason`
    - `beforeSummary`
    - `afterSummary`
- 当前批次 notes 来源：
  - 优先使用 AI 返回的 `reviewNotes[]`
  - 若某张表没有 AI 明确说明，则后端为该表补一条通用 `reviewed` 记录

## 6. 写库覆盖策略
- 整体采用单事务。
- 删除顺序：
  - `novel_key_nodes`
  - `novel_explosions`
  - `novel_skeleton_topic_items`
  - `novel_characters`
  - `novel_timelines`
- 插入顺序：
  - `novel_timelines`
  - `novel_characters`
  - `novel_key_nodes`
  - `novel_skeleton_topic_items`
  - `novel_explosions`
- 若没有勾选 `novel_timelines`，但勾选了 `keyNodes / explosions`，后端会读取现有 timelines 建立弱匹配 lookup，用 `timelineRef` 回填已有 timeline。

## 7. 前端交互实现摘要
- Step2 和 Step3 之间的“预处理操作”区已改为两个主按钮：
  - `抽取历史骨架和生成爆点`
  - `二次AI自检`
- 新弹窗：`PipelineSecondReviewDialog`
- 弹窗能力：
  - AI 模型下拉
  - 检测对象表多选
  - 参考资料表多选
  - 用户附加要求
  - prompt 预览
  - allowPromptEdit
  - 字体大小切换
  - 执行按钮
- 成功后刷新链路：
  - `await loadOverview()`
  - `setExtractRefreshKey(prev => prev + 1)`，复用已有 `SkeletonTopicsPanel` 刷新机制

## 8. 本地验证结果

### SQL 迁移
- 已执行：
  - `apps/api/sql/20260308_add_revision_notes_json_to_pipeline_result_tables.sql`
- 已验证 5 张表都存在 `revision_notes_json longtext`

### build
- `pnpm --dir apps/api build`：通过
- `pnpm --dir apps/web build`：通过

### API 最小联调
- `GET /health`：200
- 登录 `s01 / 123456`：成功
- `POST /pipeline/1/review-preview-prompt`：201，成功返回 promptPreview
- `POST /pipeline/1/review-and-correct`：
  - 做了“非法 targetTables 组合”只读验证
  - 返回 400，错误信息清晰，说明后端保护逻辑生效
- 为避免直接覆盖用户当前项目数据，本次未在报告生成阶段自动执行一次真实成功写回

## 9. 已知限制
- 当前 `revision_notes_json` 主要保存“当前这一轮 review 写回说明”。
- 由于 review 仍是删旧重建，旧行 id 不保留，因此还没有实现“跨旧行 id 的累计历史串联”。
- 目前后端对“勾选 timelines 但不勾选 keyNodes / explosions”的情况采取显式拒绝，而不是自动补选。
- review prompt 仍是单轮模式，尚未做“双轮高质量 review”。
- 本次没有改动现有 extract-and-generate 的行为，只新增 parallel 的 second review 能力。

## 10. 说明
- 前端 review 类型单独放在 `apps/web/src/types/pipeline-review.ts`，没有继续并入 `pipeline.ts`，目的是让 extract / review / set_core 三套 AI 交互类型分层更清晰，避免后续继续膨胀在同一个类型文件里。
