# 生成每集纲要和每集剧本：前端状态展示 + Persist 风险控制 + Layer5 精细注入实现报告

## 1. 修改文件清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `apps/api/src/pipeline/pipeline-episode-script.service.ts` | 修改 | Layer 5 证据注入、NULL 边界 SQL 增强、预算常量 |
| `apps/web/src/components/PipelinePanel.tsx` | 修改 | 新增状态变量、捕获新响应字段、persist 前完整性校验 |
| `apps/web/src/components/pipeline/PipelineEpisodeScriptDialog.tsx` | 修改 | 新增生成状态展示区、persist 按钮视觉防护 |
| `apps/web/src/types/pipeline.ts` | 无需修改 | 第三阶段已添加 `finalCompletenessOk`、`repairSummary`、`batchInfo` 等类型 |

## 2. Persist 风险控制实现说明

### 前端阻断（主防线）

在 `PipelinePanel.tsx` 的 `handlePersistEpisodeScriptDraft()` 中新增完整性判断：

**逻辑**：
- 若 `episodeScriptFinalCompletenessOk === false`，弹出 `window.confirm` 二次强确认
- 提示内容包含实际集数、目标集数、明确警告"草稿不完整"
- 用户点"取消"时中止 persist，点"确定"时继续（强制写入）
- 若 `finalCompletenessOk` 为 `true` 或 `undefined`（旧版 legacy 不返回该字段），正常允许 persist

**按钮视觉防护**：
- 当 `finalCompletenessOk === false` 时，按钮背景色从蓝色 `#1890ff` 变为橙色 `#ff7a45`
- 按钮文本从"确认写入数据库"变为"⚠ 强制写入（草稿不完整）"
- 视觉上明确提醒用户这是一次风险操作

### 后端保护（辅助）

后端 `persistDraft()` 方法保持原有逻辑不变。原因：
- `PersistDto` 不包含 `finalCompletenessOk` 字段，修改 DTO 会破坏接口兼容性
- 前端阻断已提供足够保护
- 后端日志中已有 `[episode-script][persist][start]` 记录实际集数，可事后审计

## 3. 前端状态展示实现说明

### 生成状态区

在 `PipelineEpisodeScriptDialog.tsx` 中新增"生成状态"信息区，位于草稿预览之后、warnings 之前。

**展示条件**：`draft` 存在且 `batchInfo` 有数据时显示（即多阶段生成返回结果后）

**视觉设计**：
- 完整时：绿色边框 `#b7eb8f` + 浅绿背景 `#f6ffed`，状态文字"完整"绿色 `#52c41a`
- 不完整时：红色边框 `#ffccc7` + 浅红背景 `#fff2f0`，状态文字"不完整"红色 `#ff4d4f`

**展示内容**：

| 信息项 | 说明 |
|--------|------|
| 目标集数 | `targetEpisodeCount` |
| 实际集数 | `actualEpisodeCount`，与目标不等时橙色高亮 |
| 批次总数 | `batchInfo.length` |
| 失败批次 | 仅 > 0 时显示，红色 |
| 重试批次 | 仅 > 0 时显示 |
| 修复批次 | 仅 > 0 时显示 |

**修复摘要子区**：
- 当 `repairSummary` 存在且有任意修复发生时显示
- 展示：Plan已修复 / N个批次已修复 / 缺集已补生

**失败批次明细子区**：
- 当 `failedBatches` 非空时显示
- 展示每个失败批次的 `batchIndex`、`range`、`error`（截取前 120 字符）

**不完整警告**：
- 当 `finalCompletenessOk === false` 时，底部显示红色加粗警告"⚠ 草稿不完整，不建议直接写入数据库"

### 状态变量管理

在 `PipelinePanel.tsx` 中新增 4 个 state：
- `episodeScriptFinalCompletenessOk`
- `episodeScriptBatchInfo`
- `episodeScriptFailedBatches`
- `episodeScriptRepairSummary`

生成后从响应中捕获，关闭弹窗时清空。

## 4. Layer 5 精细注入实现说明

### 注入策略

- **仅注入** `novel_source_segments`，不恢复 `drama_source_text`
- **触发条件**：用户选择的 `referenceTables` 包含 `novel_source_segments`
- **注入位置**：与动态 Layer 4 上下文合并为 `combinedDynamicBlock`，注入到 batch prompt 的"动态关联资料"区块

### 关键词提取

新增 `extractBatchPlanKeywords(batch)` 方法：
- 从当前 batch 的 plan episodes 中提取关键词
- 来源字段：`arc`、`coreConflict`、`historyOutline`、`cliffhanger`、`episodeTitle`
- 清洗：去除标点、按空格分词、过滤长度 2-10 的词
- 每个字段最多取 4 个关键词，总计最多 12 个

### SQL 查询

基于关键词对 `novel_source_segments` 做 LIKE 模糊匹配：
- 匹配字段：`content_text`、`keyword_text`、`title_hint`
- 最多取 6 个关键词构建 OR 条件
- LIMIT 为 `maxItems * 3`（24 条候选），最终选取 `maxItems`（8 条）

### 预算控制

| 常量 | 默认值 | 说明 |
|------|--------|------|
| `BATCH_EVIDENCE_CHAR_BUDGET` | 6000 | 单 batch 证据字符上限 |
| `BATCH_EVIDENCE_MAX_ITEMS` | 8 | 单 batch 最大证据条数 |
| `BATCH_PROMPT_CHAR_BUDGET` | 60000 | batch prompt 总字符预算（预留） |

超预算行为：
- 当累计 `usedChars` 达到 `charBudget` 时停止添加证据
- 超出的证据被裁掉（`truncated = true`）
- 裁掉的永远是低优先级的 Layer 5，不影响 Layer 1/3/4

### 容错

- 若 `novel_source_segments` 表不存在，直接返回空结果，不影响生成
- 若无关键词可提取，跳过证据注入
- 若查询无命中，返回空 block

## 5. 动态区间筛选边界处理说明

### 已实现 NULL 边界增强

`EP_RANGE_DYNAMIC_QUERIES` 中所有 4 条 SQL 均已更新为：

```sql
WHERE novel_id = ?
  AND (start_ep IS NULL OR start_ep <= ?)
  AND (end_ep IS NULL OR end_ep >= ?)
```

**语义**：
- `start_ep IS NULL` → 视为从第 1 集开始有效（从开头有效）
- `end_ep IS NULL` → 视为直到最后一集有效（直到结尾有效）
- 这确保了以下场景正确命中：
  - 故事阶段只定义了 `start_ep`，未定义结束集号
  - 爽点线横跨整部剧，未限定具体范围
  - 内鬼阶段从某集开始但未明确结束

**影响的表**：
- `set_story_phases`
- `set_power_ladder`
- `set_traitor_stages`
- `set_payoff_lines`

## 6. 日志增强说明

### 新增日志点位

| 标签 | 阶段 | 内容 |
|------|------|------|
| `[batch][evidence]` | Batch Evidence | batchIndex, episodeRange, evidenceCount, usedChars, truncated, queryKeywords |
| `[layers][batch]` 扩展 | Batch Layers | 新增 `evidenceLayer` 字段（Layer5_BudgetControlled / Layer5_Skipped）、`hasEvidence` |
| `[batch][dynamic_context]` 扩展 | Batch Dynamic | 新增 `hasEvidence` 布尔标记 |

### 前端日志

`handleGenerateEpisodeScriptDraft` 中的 `console.info` 扩展了：
- `finalCompletenessOk`
- `batchCount`
- `failedBatchCount`

## 7. 兼容性说明

### 后端

| 检查项 | 状态 |
|--------|------|
| 旧 legacy 单次生成 | ✅ 不受影响（不走多阶段，无 batchInfo/evidence） |
| `previewPrompt` API | ✅ 不受影响 |
| `persistDraft` API | ✅ 接口结构未改 |
| 多阶段生成返回结构 | ✅ 所有新字段均已在第三阶段声明为 optional |
| NULL 边界 SQL | ✅ 更宽松的匹配，向后兼容 |

### 前端

| 检查项 | 状态 |
|--------|------|
| 新状态变量默认值 | ✅ 均为 `undefined`，旧接口不返回时不影响 |
| 生成状态区条件渲染 | ✅ 仅当 `batchInfo` 有数据时显示 |
| persist 阻断逻辑 | ✅ 仅当 `finalCompletenessOk === false` 时触发，`undefined` 不触发 |
| 弹窗关闭清理 | ✅ 所有新状态在关闭时重置 |
| Linter 检查 | ✅ 无错误 |

## 8. 风险与后续优化项

### 当前风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 关键词 LIKE 查询效率 | 大量 segments 时慢 | 最多 6 个关键词 + LIMIT 24，可控 |
| 关键词质量取决于 plan | plan 质量差时无关证据 | 多字段综合提取，最多 12 个关键词 |
| window.confirm 样式有限 | 用户体验不够精致 | 明确信息 + 按钮变色，已足够清晰 |
| `BATCH_PROMPT_CHAR_BUDGET` 暂未强制使用 | 理论上 prompt 可能超大 | 预留常量，后续可加 prompt 裁剪逻辑 |

### 后续优化建议

1. **证据相关性提升**：基于 embedding / 向量检索替代 LIKE 模糊匹配
2. **Persist 后端强阻断**：在 `PersistDto` 中增加可选 `targetEpisodeCount`，后端校验后 warn
3. **前端 Modal 替代 confirm**：用自定义 Modal 组件替代 `window.confirm`，更美观
4. **Prompt 裁剪**：当总 prompt 超过 `BATCH_PROMPT_CHAR_BUDGET` 时，优先裁掉 Layer 5 → Layer 4 → Layer 3
5. **证据预算动态调整**：根据 batch size 和 plan 复杂度动态调整 `BATCH_EVIDENCE_CHAR_BUDGET`

## 9. 验收结果

| # | 验收项 | 结果 |
|---|--------|------|
| 1 | 不完整草稿时，前端是否不能无感直接 persist | ✅ `finalCompletenessOk === false` 时弹出 `confirm` 二次确认，默认阻断 |
| 2 | 用户是否能在弹窗里看到完整性状态 | ✅ 生成状态区显示"完整"/"不完整"，绿/红色区分 |
| 3 | 用户是否能看到失败批次与修复摘要 | ✅ 失败批次明细 + 修复摘要均有展示 |
| 4 | 完整草稿时原有 persist 流程是否不受影响 | ✅ `finalCompletenessOk !== false` 时直接进入 persist |
| 5 | batch 阶段是否开始有限注入 `novel_source_segments` | ✅ `buildBatchEvidenceBlock` 基于 plan 关键词查询并注入 |
| 6 | Layer 5 注入是否受预算控制 | ✅ `BATCH_EVIDENCE_CHAR_BUDGET=6000` + `BATCH_EVIDENCE_MAX_ITEMS=8`，超预算截断 |
| 7 | 动态区间筛选是否对 NULL 边界做了增强 | ✅ 4 条 SQL 均增加 `start_ep IS NULL OR` / `end_ep IS NULL OR` |
| 8 | UI 是否保持简洁，不破坏原功能 | ✅ 仅新增一个条件渲染的信息区，不改变原有布局和交互 |
| 9 | 兼容性是否保持 | ✅ 所有新状态默认 `undefined`，旧接口不返回时无影响 |
| 10 | 日志是否能反映 evidence 注入情况 | ✅ `[batch][evidence]` 记录 count/chars/truncated/keywords |
