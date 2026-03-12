# 生成每集纲要和每集剧本：输入分层 + 动态选料 + 修复机制增强实现报告

## 1. 修改文件清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `apps/api/src/pipeline/pipeline-episode-script.service.ts` | 修改 | 核心服务：输入分层、动态选料、plan/batch/final 修复、日志增强 |
| `apps/web/src/types/pipeline.ts` | 修改 | 前端类型：新增 repaired、layerUsage、repairSummary、finalCompletenessOk |

## 2. 输入分层实现说明

### 层级定义（代码常量，非注释）

| 层级 | 常量名 | 包含表 | 用途 |
|------|--------|--------|------|
| Layer 1 | `LAYER_1_CORE_CONSTRAINT` | `drama_novels`, `set_core`, `novel_adaptation_strategy`, `adaptation_modes` | 核心约束层（必须） |
| Layer 2 | `LAYER_2_PLOT_SKELETON` | `novel_timelines`, `novel_key_nodes`, `novel_skeleton_topics`, `novel_skeleton_topic_items` | 剧情骨架层（强相关） |
| Layer 3 | `LAYER_3_CHARACTER_FACTION` | `novel_characters`, `set_opponent_matrix`, `set_opponents`, `set_traitor_system`, `set_traitors`, `set_traitor_stages` | 角色阵营层（中强相关） |
| Layer 4 | `LAYER_4_RHYTHM_CONTROL` | `novel_explosions`, `set_payoff_arch`, `set_payoff_lines`, `set_power_ladder`, `set_story_phases` | 节奏控制层（增强，按 ep range 动态查询） |
| Layer 5 | `LAYER_5_EVIDENCE` | `novel_source_segments`, `drama_source_text` | 证据素材层（预算受控） |

### 组合常量

| 常量名 | 组合 | 使用场景 |
|--------|------|----------|
| `PLAN_LAYERS` | Layer 1 + Layer 2 | plan prompt |
| `BATCH_STATIC_LAYERS` | Layer 1 + Layer 3 | batch prompt 静态部分 |
| `EP_RANGE_DYNAMIC_QUERIES` | Layer 4 四张表的区间查询定义 | batch prompt 动态部分 |

### 日志验证点

- `[episode-script][layers][plan]` — 记录 plan 阶段使用/跳过的层和表
- `[episode-script][layers][batch]` — 记录每个 batch 的静态层 + 动态层使用情况

## 3. Plan 阶段增强说明

### 选料策略

- **使用层级**: Layer 1（核心约束） + Layer 2（剧情骨架）
- **跳过层级**: Layer 3（角色阵营）、Layer 4（节奏控制）、Layer 5（证据素材）
- **理由**: plan 阶段只需轻量骨架规划，不需要详细的角色/节奏/证据资料

### Plan 修复机制

**触发条件**: `validateAndNormalizePlan()` 之后，若 `planMissing.length > 0` 且缺失数 ≤ 目标集数的 50%

**修复流程**:
1. 构建 repair prompt，包含：已有 plan 摘要 + 缺失集号列表 + Layer 1+2 参考资料
2. 调用 AI（system prompt: "你是短剧全集规划修复助手"），只要求补齐缺失集
3. 合并修复结果回原 plan，按 episodeNumber 排序
4. 重新计算 missingEpisodeNumbers

**限制**: 最多修复 1 次（`REPAIR_MAX_ATTEMPTS = 1`）

**日志**:
- `[episode-script][plan][repair][start]` — 记录缺失数、已有数
- `[episode-script][plan][repair][done]` — 记录补齐数、合并后总数、耗时
- `[episode-script][plan][repair][error]` — 修复失败时记录错误

## 4. Batch 阶段动态选料说明

### 静态层 (每个 batch 固定)

Layer 1（核心约束） + Layer 3（角色阵营），从预构建的 reference blocks 中过滤

### 动态层 (按 episode range 区间查询)

通过 `buildDynamicBatchContext()` 方法，针对当前 batch 的 `[startEpisode, endEpisode]` 范围，查询以下四张表：

| 表名 | 筛选逻辑 | 注入内容 |
|------|----------|----------|
| `set_story_phases` | `start_ep <= batch.endEp AND end_ep >= batch.startEp` | 命中的故事阶段摘要 |
| `set_power_ladder` | 同上 | 当前权力等级摘要 |
| `set_traitor_stages` | 同上 | 当前内鬼阶段摘要 |
| `set_payoff_lines` | 同上 | 命中的爽点线摘要 |

**查询定义**: 通过 `EP_RANGE_DYNAMIC_QUERIES` 常量数组集中管理，每项包含 `table`、`label`、`sql`、`fields`

**容错**: 若表不存在（query 抛异常），catch 后记录 `hits[table] = -1`，不影响生成

### Prompt 结构

batch prompt 中新增 `【当前批次动态关联资料（基于集数区间筛选）】` 区块，放在核心参考资料之后

### 日志验证点

- `[episode-script][batch][dynamic_context]` — 记录每个 batch 的 episode range 和命中数
- `[episode-script][layers][batch]` — 记录静态层 + 动态层使用情况

## 5. Plan / Batch 修复机制说明

### Batch 修复: assessBatchRepairNeeds + repairBatchEpisodes

**触发条件**（`assessBatchRepairNeeds()`，满足任一即触发）:
1. 实际 episode 数量 ≠ 期望 batch size
2. episodeNumber 集合与 plan 中期望集号不匹配（有缺号）
3. 关键字段严重缺失（coreConflict / fullContent / structureName / cliffhanger）超过期望集数

**修复流程** (`repairBatchEpisodes()`):
1. 构建 repair prompt，包含：问题摘要 + 当前 batch 规划 + 已有结果摘要 + Layer 1 参考资料
2. 调用 AI 重新生成当前 batch 的完整 episodePackage
3. 若成功，用修复结果替换原 batch episodes

**限制**: 每个 batch 最多修复 1 次

**日志**:
- `[episode-script][batch][repair][start]` — 记录 batch range、修复原因、已有集数
- `[episode-script][batch][repair][done]` — 记录修复集数、耗时
- `[episode-script][batch][repair][error]` — 修复失败记录

### Final Missing Repair: repairMissingEpisodesAfterMerge

**触发条件**: merge + validate 之后，仍有 `missingEpisodeNumbers`，且缺失数 ≤ `PLAN_BATCH_SIZE * 2`（即 10 集）

**修复流程**:
1. 从 plan 中提取缺失集号的规划信息
2. 构建补生 prompt，只要求生成缺失集号
3. 调用 AI 补生
4. 合并回已有 episodes，重新排序，再次 validate

**日志**:
- `[episode-script][merge][repair_missing][start|done|error]`

## 6. 最终完整性保障说明

### 完整性字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `finalCompletenessOk` | `boolean` | merge + repair 后是否所有集数完整 |
| `missingEpisodeNumbers` | `number[]` | 最终仍缺失的集号 |
| `failedBatches` | `Array<{batchIndex, range, error}>` | 失败的 batch 信息 |

### 不完整草稿警告

若 `finalCompletenessOk === false`，warnings 中自动追加：
```
[final] ⚠️ 草稿不完整，不建议直接 persist。缺失 N 集: 1, 3, 5...
```

### Persist 风险控制

当前未修改 persist API 本身，但响应中 `finalCompletenessOk` 和 warnings 中的明确提示可供前端在 persist 前做判断。

### 日志验证点

- `[episode-script][final][completeness]` — 记录 targetEpisodeCount、actualEpisodeCount、missingCount、finalCompletenessOk、finalMissingRepairApplied

## 7. 日志增强说明

### 新增日志点位汇总

| 标签 | 阶段 | 内容 |
|------|------|------|
| `[layers][plan]` | Plan | layersUsed, tablesUsed, tablesSkipped, blockCount |
| `[layers][batch]` | Batch | staticLayers, dynamicLayer, staticBlockCount, hasDynamicContext |
| `[batch][dynamic_context]` | Batch | batchIndex, episodeRange, hits (per table) |
| `[plan][repair][start/done/error]` | Plan Repair | missingCount, repairedCount, elapsedMs |
| `[batch][repair][start/done/error]` | Batch Repair | batchIndex, reasons, repairedCount, elapsedMs |
| `[merge][repair_missing][start/done/error]` | Final Repair | missingNumbers, receivedCount, elapsedMs |
| `[final][completeness]` | Final | targetEpisodeCount, actualEpisodeCount, finalCompletenessOk |

### 已有日志保留

所有前两阶段增强的日志点位均已保留：
- `[plan][start/done/ai_error]`
- `[batch][start/done/error/retry]`
- `[merge][summary]`
- `[generateDraft][multiStage][result]`（已扩展 planRepaired, repairedBatchCount, finalMissingRepairApplied, finalCompletenessOk）

## 8. 兼容性说明

### 后端

| 检查项 | 状态 |
|--------|------|
| 旧 legacy 单次生成 fallback | ✅ 保留，当 `targetEpisodeCount <= 10` 或有 `promptOverride` 时走旧路径 |
| 手动编辑 prompt 走 legacy | ✅ 保留 |
| `previewPrompt` API | ✅ 不受影响 |
| `persistDraft` API | ✅ 接口结构未改 |
| `validateAndNormalizeEpisodePackage` | ✅ 语义未改 |
| 数据库 schema | ✅ 未改动 |

### 前端

| 检查项 | 状态 |
|--------|------|
| `PipelineEpisodeScriptGenerateDraftResponse` | ✅ 全部新增字段均为 optional |
| `PipelinePanel.tsx` 消费逻辑 | ✅ 只用 `result.draft`、`result.warnings` 等已有字段 |
| 新增 `finalCompletenessOk` | ✅ optional，前端不消费不影响 |
| 新增 `layerUsageSummary` | ✅ optional，前端不消费不影响 |
| 新增 `repairSummary` | ✅ optional，前端不消费不影响 |

### 编译与类型检查

- `ReadLints` 检查：无 linter 错误
- 旧 `PLAN_CORE_TABLES`、`BATCH_CORE_TABLES` 引用已全部替换为 `PLAN_LAYERS`、`BATCH_STATIC_LAYERS`

## 9. 风险与后续优化项

### 当前风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 动态查询的表可能不存在 | query 报错 | 已 try-catch 处理，hits 记为 -1 |
| repair AI 调用可能再次返回不完整结果 | 修复无效 | 限制最多 1 次，失败记 warning |
| 大量 repair 调用增加 API 成本 | 费用上升 | 最多 plan repair 1 次 + batch repair 各 1 次 + final repair 1 次 |
| `start_ep`/`end_ep` 字段可能为 NULL | 区间查询漏匹配 | 当前使用严格比较，NULL 行将被过滤 |

### 后续优化建议

1. **Layer 5 预算控制精细化**: 目前 batch 阶段不注入 Layer 5 证据素材，后续可实现基于 token budget 的有限注入
2. **start_ep/end_ep NULL 处理**: 为动态查询 SQL 添加 `OR start_ep IS NULL` fallback
3. **前端消费 repair/completeness 信息**: 在弹窗中显示修复摘要和完整性状态
4. **Persist 阻断**: 如 `finalCompletenessOk === false`，前端可在 persist 前弹确认提示
5. **Repair prompt 微调**: 根据实际 AI 返回质量迭代 repair prompt 模板
6. **并行 batch 生成**: 当前为顺序 for 循环，后续可改为有限并发

## 10. 验收结果

| # | 验收项 | 结果 |
|---|--------|------|
| 1 | 代码中是否已显式实现输入分层 | ✅ `LAYER_1_CORE_CONSTRAINT` ~ `LAYER_5_EVIDENCE` 5 个常量 + `PLAN_LAYERS`、`BATCH_STATIC_LAYERS` 组合常量 |
| 2 | plan prompt 是否只使用核心约束层 + 剧情骨架层为主 | ✅ `filterRefBlocksByTables(allRefBlocks, referenceTables, PLAN_LAYERS)` |
| 3 | batch prompt 是否根据 episode range 动态补充阶段相关资料 | ✅ `buildDynamicBatchContext()` 对 4 张表做 `start_ep <= ? AND end_ep >= ?` 区间查询 |
| 4 | 是否实现了基于 start_ep/end_ep 的区间筛选 | ✅ `EP_RANGE_DYNAMIC_QUERIES` 定义 + `buildDynamicBatchContext()` 执行 |
| 5 | plan 缺集时是否会自动补齐一次 | ✅ `repairPlanMissingEpisodes()` 在 `planMissing > 0` 且 ≤ 50% 时触发 |
| 6 | batch 缺集/关键字段缺失时是否会自动 repair 一次 | ✅ `assessBatchRepairNeeds()` 判定 + `repairBatchEpisodes()` 执行 |
| 7 | merge 后是否明确给出最终完整性状态 | ✅ `finalCompletenessOk` 字段 + `[final][completeness]` 日志 + warnings 提示 |
| 8 | 日志中是否能看出 layer 使用与动态选料过程 | ✅ `[layers][plan]`、`[layers][batch]`、`[batch][dynamic_context]` 日志 |
| 9 | 单次请求体是否进一步得到控制 | ✅ plan 只用 Layer 1+2，batch 只用 Layer 1+3+动态 Layer 4（区间过滤），不堆全量资料 |
| 10 | 兼容性是否保持 | ✅ 所有新增字段 optional，frontend/persist/legacy 路径均不受影响 |
