# Current Schema Optimization 开发与验证报告

## 1. 本次开发摘要
- 在不改 schema 的前提下，落地了 `payoff/power/traitor_stage/story_phase` 四类区间推断。
- 增加了 opponent 字段 hardening，降低 `对手1/层级1/threat_type 空值` 的占位问题。
- 增加了 cross-table phase alignment 检查，并把 `alignmentSummary/alignmentWarnings` 回传前端。
- 扩展了前端 warning mapping 到 `payoff_lines/power_ladder/opponents` 条目级提示。

## 2. 修改文件清单

### 后端
- `apps/api/src/pipeline/pipeline-worldview.service.ts`
  - 接入 current schema optimization 总入口；
  - 三接口（preview/generate/persist）统一回传 inference + alignment；
  - 增强 worldview prompt 的 opponent 字段硬约束；
  - 增加 opponent hardening（level/opponent/threat type）。
- `apps/api/src/pipeline/worldview-quality-checker.ts`
  - 扩展 draft shape 对 interval/opponent 结构兼容；
  - 新增 opponent 占位值识别规则。
- `apps/api/src/pipeline/payoff-interval-inference.ts`（新增）
- `apps/api/src/pipeline/power-interval-inference.ts`（新增）
- `apps/api/src/pipeline/traitor-stage-interval-inference.ts`（新增）
- `apps/api/src/pipeline/worldview-cross-table-alignment-checker.ts`（新增）

### 前端
- `apps/web/src/types/pipeline.ts`
  - 扩展 inference summary 为四模块结构；
  - 新增 alignment summary/warnings 类型并接入三接口返回体。
- `apps/web/src/components/PipelinePanel.tsx`
  - 新增 worldview alignment state；
  - 接收并下发 alignment 数据给 dialog。
- `apps/web/src/components/pipeline/worldview-warning-utils.ts`
  - 扩展 path 解析到 `payoff.lines / power.items / opponents.items`。
- `apps/web/src/components/pipeline/PipelineWorldviewDialog.tsx`
  - 展示四类 inference 统计；
  - 展示 cross-table alignment 摘要；
  - 条目级 warning 扩展到 payoff/power/opponents；
  - persist 前提示补充 opponents 与 cross-table 风险信息。

## 3. payoff interval inference 落地情况
- 规则：
  - 已有合法区间优先保留；
  - 缺失时按 line 语义（full/early/mid/late）+ story phase/均分基线推断；
  - 保证最小区间跨度；
  - `stage_text` 缺失时按区间自动补齐（如“全程贯穿/前期密集/中期推进/后期收束”）。
- 输出：
  - `inferenceSummary.payoff`；
  - 对应 warning 以 `(auto-fixed/inferred)` 标记返回。

## 4. power interval inference 落地情况
- 规则：
  - 按 `level_no` 单调推进；
  - 总集数均分后结合语义轻微修正（早/中/晚）；
  - 自动修复逆序与越界。
- 输出：
  - `inferenceSummary.power`；
  - 字段级 warning 回传。

## 5. traitor stage interval inference 落地情况
- 规则：
  - 按阶段顺序单调向后；
  - 基于 `stage_title/stage_desc` 识别 early/mid/late；
  - 缺失区间自动补齐并与总集数对齐。
- 输出：
  - `inferenceSummary.traitorStage`；
  - 字段级 warning 回传。

## 6. opponent field hardening 落地情况
- `level_name`：
  - 占位值（层级/分类数字）优先按文本归类到 `军事/情报/政治/身份危机` 等层。
- `opponent_name`：
  - 占位值（对手1/角色1）优先从描述中抽取命名实体，否则回填“关键威胁角色X”。
- `threat_type`：
  - 为空时按描述推断 `军事威胁/情报威胁/身份危机/决策干扰`，兜底 `复合威胁`。

## 7. cross-table phase alignment checks 落地情况
- 检查模块：
  - `set_story_phases / set_payoff_lines / set_power_ladder / set_traitor_stages`。
- 检查点：
  - 区间缺失、逆序、越界；
  - 单调顺序冲突；
  - 语义与区间明显冲突（如“终局”落前段）。
- 输出：
  - `alignmentSummary`（总问题数 + 按模块计数）；
  - `alignmentWarnings`（路径级）。

## 8. 验证结果
- 已执行：
  - API/Web 构建检查；
  - 关键改动文件 lint 诊断检查。
- 受本地运行态限制，本报告未附带完整 MCP 浏览器链路与在线接口实测截图；建议在本地 dev server 启动后按 v5 验收步骤复测 preview/generate/persist 三接口与 dialog 告警映射。

## 9. 数据库结果前后对比（预期影响）
- `set_payoff_lines.start_ep/end_ep/stage_text`：空值显著下降。
- `set_power_ladder.start_ep/end_ep`：区间锚点更稳定。
- `set_traitor_stages.start_ep/end_ep`：阶段节奏可落库。
- `set_opponents.level_name/opponent_name/threat_type`：占位值与空 threat_type 明显减少。

## 10. 回归结果
- 本轮未触碰：
  - `pipeline-extract.service.ts`
  - `pipeline-review.service.ts`
  - `set-core.service.ts`
  - `segments/retrieval` 主流程
- 目标是只影响 worldview 三段式链路。

## 11. 下一步建议
- 若 v5 实测通过，当前 schema 已接近“可用产品数据”状态；
- 下一步优先建议做“字段语义强化 + 模块分步生成策略”A/B 对比，再决定是否进入“两阶段总蓝图生成”。
