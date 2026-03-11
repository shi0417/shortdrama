# Worldview Closed-Loop MVP v1 开发与验证报告

## 1. 本次开发摘要

本次在不改动 worldview 主体 schema、不扩散到 extract/review/set_core 的前提下，完成了一个可控的闭环 MVP：

- 新增闭环四层：`generation -> validation -> repair planning -> targeted repair/regenerate`。
- 闭环执行策略固定为“最多一轮修复/局部重跑”，避免无限循环。
- 将现有 `quality/alignment/inference` 与新增 `semantic/relevance` 校验统一为结构化 `ValidationReport`。
- 支持 evidence 串题识别（含张士诚/陈友谅/蓝玉/胡惟庸类弱相关历史词）。
- 支持模块级重生成（只重跑 `opponents/traitor/story_phase/payoff/power` 指定模块，非整份重跑）。
- 前端新增“闭环修复结果 + 初次/修复后校验摘要”可视化，支持修复前后分数与问题数量对比。

---

## 2. 修改文件清单

### 后端新增

- `apps/api/src/pipeline/worldview-closure.types.ts`
  - 闭环核心类型定义：Issue/Report/Plan/ClosureResult/RepairSummary。
- `apps/api/src/pipeline/worldview-validation-orchestrator.ts`
  - 统一编排 structure/semantic/relevance/alignment 校验结果。
- `apps/api/src/pipeline/worldview-semantic-validator.ts`
  - opponents/traitor/story_phase/payoff/power 语义规则校验。
- `apps/api/src/pipeline/worldview-relevance-validator.ts`
  - evidence 串题与弱相关证据污染检测。
- `apps/api/src/pipeline/worldview-repair-planner.ts`
  - 闭环决策器：accept / repair / regenerate_modules。
- `apps/api/src/pipeline/worldview-module-repair.service.ts`
  - 局部修复与模块重生成服务（含指定模块 merge 回原 draft）。

### 后端修改

- `apps/api/src/pipeline/pipeline-worldview.service.ts`
  - preview 接入 `validationReportPreview`
  - generate 接入完整闭环流程与新增返回字段
  - persist 接入持久化前校验与闭环状态回传

### 前端修改

- `apps/web/src/types/pipeline.ts`
  - 新增闭环相关类型与三接口响应字段扩展。
- `apps/web/src/components/PipelinePanel.tsx`
  - 接入闭环状态（validationReport/repairSummary/closureStatus 等）。
- `apps/web/src/components/pipeline/PipelineWorldviewDialog.tsx`
  - 新增“闭环修复结果”“闭环校验摘要”展示区，并增强 persist 前风险提示。

---

## 3. 闭环架构说明

闭环仅作用于 worldview 三接口，流程如下：

1. **初始生成**
   - 复用现有 prompt + AI 调用 + normalize + inference + quality/alignment。
2. **结构化校验**
   - orchestrator 合并多源问题，产出 `ValidationReport`（score/fatal/major/minor/issues）。
3. **修复决策**
   - planner 根据报告给出 `accept / repair / regenerate_modules`。
4. **最多一轮修复**
   - 优先 `fix_in_place`；
   - 必要时模块重生成（只改指定模块并 merge）；
   - 若 relevance 明显串题，先做 evidence 二次筛除后再修复/重生。
5. **二次校验并收敛**
   - 产出 `initialValidationReport` 与 `finalValidationReport`；
   - 给出 `closureStatus`（`accepted | repaired | low_confidence`）。

---

## 4. ValidationReport 结构说明

核心结构（后端与前端已对齐）：

```json
{
  "passed": true,
  "score": 84,
  "fatalCount": 0,
  "majorCount": 2,
  "minorCount": 4,
  "issues": [
    {
      "moduleKey": "opponents",
      "path": "setOpponentMatrix.opponents[1].opponent_name",
      "severity": "major",
      "reason": "opponent_name 仍为占位值",
      "repairStrategy": "regenerate_module",
      "source": "semantic"
    }
  ],
  "recommendedAction": "repair"
}
```

字段语义：

- `severity`: `fatal | major | minor`
- `repairStrategy`: `fix_in_place | regenerate_module | reselect_evidence`
- `source`: `structure | semantic | relevance | alignment`

---

## 5. Repair Planner 决策规则

已固化规则（MVP）：

- **直接放行（accept）**
  - `fatalCount = 0`
  - `majorCount <= 2`
  - `score >= 80`
  - 且无 evidence relevance major 问题
- **repair**
  - 问题以可代码兜底项为主（空缺、模板化、同义复读等）
- **regenerate_modules**
  - 问题集中在特定模块语义（opponents/traitor/story_phase/payoff/power）
- **reselect_evidence**
  - relevance 检测到串题污染时触发二次证据筛除（然后再修复/重生）

---

## 6. Module Regenerate 的实际接法

模块重生并非整份重跑，采用“定向 repair prompt + 局部 merge”：

- 输入：
  - 当前完整 draft
  - 当前 evidence block
  - 指定模块列表
  - issues 列表
- 输出强约束：
  - 只返回指定模块 JSON key
  - 不允许改动其他模块
  - 不允许改变顶层结构

示例（概念）：

```json
{
  "setOpponentMatrix": {
    "name": "...",
    "description": "...",
    "opponents": [...]
  },
  "setStoryPhases": [...]
}
```

然后按模块 key merge 回原 draft，再进入二次 normalize/inference/validation。

---

## 7. 三接口验证结果

> 本轮已完成“编译/类型级验证”；接口运行级与页面实测未在本次文档编写环节追加执行。

### 已完成

- `pnpm --dir apps/api exec tsc -p tsconfig.build.json --noEmit`：通过
- `pnpm --dir apps/web exec tsc --noEmit`：通过
- `pnpm --dir apps/api build`：通过
- `pnpm --dir apps/web build`：通过

### 三接口新增返回字段（已落地）

- `POST /pipeline/:novelId/worldview-preview-prompt`
  - 新增：`validationReportPreview`
- `POST /pipeline/:novelId/worldview-generate-draft`
  - 新增：`validationReport`、`initialValidationReport`、`finalValidationReport`
  - 新增：`repairSummary`、`closureStatus`、`repairApplied`、`evidenceReselected`
- `POST /pipeline/:novelId/worldview-persist`
  - 新增：`validationReport`、`closureStatus`、`repairApplied`、`evidenceReselected`

---

## 8. 前端显示结果

`PipelineWorldviewDialog` 已新增并接线：

- **闭环修复结果**
  - `closure status`
  - `repair applied`
  - `evidence reselected`
  - `score before/after`
  - `issues before/after`
  - `action + targetModules`
- **闭环校验摘要**
  - `initialValidationReport`
  - `finalValidationReport`
  - `validationReportPreview`
  - `persist validationReport`
- 仍保留并兼容既有：
  - `qualitySummary/qualityWarnings`
  - `inferenceSummary`
  - `alignmentSummary/alignmentWarnings`
  - 模块条目 warning 映射展示

---

## 9. 对三类问题的验证结论（实现层）

### A. evidence 串题

- 已新增 relevance validator，检测弱相关历史词占预算问题；
- 已在闭环中支持 evidence reselect（弱相关证据行过滤）；
- 能形成 `source: relevance` + `repairStrategy: reselect_evidence` 的结构化 issue。

### B. opponent 跑偏

- 已新增 semantic validator：
  - 占位值（对手1/层级1）检测
  - `threat_type` 空检测
  - `detailed_desc` 仅简介/过短检测
  - 友军/中性角色混入对手矩阵检测（启发式）
- 可触发 `regenerate_module(opponents)`。

### C. traitor 边界过宽

- 已新增 traitor 语义校验：
  - `public_identity/real_identity` 同义复读
  - 普通情报协助者泛化为主内鬼角色
  - `mission/threat_desc/stage_desc` 缺失或推进性不足
  - `stage_title` 模板化检测
- 可触发 fix_in_place 与模块重生联动。

---

## 10. 遗留问题与下一步建议

### 当前遗留

- 本文档阶段未补跑 MCP/UI 端到端回归，暂不提供运行态真实样例响应截图。
- relevance 识别与 friend/foe 识别目前是启发式，仍有误判可能。
- 模块重生依赖单模型一次输出，若模型波动仍可能出现低置信结果。

### 下一步建议（保持 MVP 边界）

1. 先做一次 `novel_id=1` 的三接口实测与对库验证，记录闭环前后 `score/issues` 变化。
2. 按真实数据补充小规模白名单/黑名单词表（只限 worldview）。
3. 对 `repair prompt` 增加更严格的“只允许模块 key 输出”断言与异常日志。
4. 继续坚持“最多一轮修复”，避免自动化链路失控。

