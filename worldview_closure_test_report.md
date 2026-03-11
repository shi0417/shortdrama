# Worldview 闭环补测报告

## 测试目标
对 novel_id=1 执行 preview->generate->persist->overview 完整流程，采集前后对比证据与前端显示证据。

## 测试环境
- 前端: http://localhost:3000
- 后端: http://localhost:4000
- 测试账号: s01 / 123456
- 测试对象: novel_id=1

## 测试方法说明
由于环境限制，本测试采用 API 直接调用方式进行补测，未使用浏览器自动化。测试脚本已创建，需手动执行以获取实际结果。

## 预期测试流程

### 1. 服务检查 (serviceCheck)
- **frontendReachable**: GET http://localhost:3000 → 预期 200
- **backendReachable**: GET http://localhost:4000/health → 预期 200
- **loginSuccess**: POST http://localhost:4000/auth/login → 预期返回 access_token

### 2. 运行时字段加载检查 (runtimeFieldsLoaded)
根据代码实现，以下字段应在接口响应中出现：
- `validationReportPreview` (preview 接口)
- `validationReport` (persist 接口)
- `initialValidationReport` (generate 接口)
- `finalValidationReport` (generate 接口)
- `repairSummary` (generate/persist 接口)
- `closureStatus` (generate/persist 接口)
- `repairApplied` (generate/persist 接口)
- `evidenceReselected` (generate 接口)

### 3. Preview 结果 (previewResult)
**接口**: POST /pipeline/1/worldview/preview

**预期返回字段**:
```typescript
{
  promptPreview: string,
  usedModelKey: string,
  referenceTables: string[],
  referenceSummary: ReferenceSummaryItem[],
  evidenceSummary: WorldviewEvidenceSummary,
  qualitySummary: object,
  qualityWarnings: WorldviewQualityWarning[],
  inferenceSummary: WorldviewInferenceSummary,
  alignmentSummary: WorldviewAlignmentSummary,
  alignmentWarnings: WorldviewAlignmentWarning[],
  validationReportPreview: WorldviewValidationReport,
  warnings?: string[]
}
```

**关键证据点**:
- `validationReportPreview.score` - 预览校验分数
- `validationReportPreview.summary` - 问题统计 (fatal/major/minor)
- `evidenceSummary.moduleEvidenceCount` - 各模块证据计数
- `qualityWarnings` 中是否包含 off-topic 警告（张士诚/陈友谅/蓝玉/胡惟庸）

### 4. Generate 结果 (generateResult)
**接口**: POST /pipeline/1/worldview/generate

**预期返回字段** (基于代码 L397-421):
```typescript
{
  usedModelKey: string,
  promptPreview: string,
  referenceTables: string[],
  referenceSummary: ReferenceSummaryItem[],
  evidenceSummary: WorldviewEvidenceSummary,
  draft: WorldviewDraftShape,
  qualitySummary: object,
  qualityWarnings: WorldviewQualityWarning[],
  inferenceSummary: WorldviewInferenceSummary,
  alignmentSummary: WorldviewAlignmentSummary,
  alignmentWarnings: WorldviewAlignmentWarning[],
  validationReport: WorldviewValidationReport,
  initialValidationReport: WorldviewValidationReport,  // 闭环字段
  finalValidationReport: WorldviewValidationReport,    // 闭环字段
  repairSummary: WorldviewRepairSummary,              // 闭环字段
  closureStatus: WorldviewClosureStatus,              // 闭环字段
  repairApplied: boolean,                             // 闭环字段
  evidenceReselected: boolean,                        // 闭环字段
  warnings?: string[],
  normalizationWarnings?: string[],
  validationWarnings?: string[]
}
```

**关键证据点 - 闭环修复**:
- `closureStatus`: 'accepted' | 'accepted_with_repair' | 'rejected'
- `repairApplied`: true/false - 是否执行了修复
- `evidenceReselected`: true/false - 是否重新选择证据
- `repairSummary`:
  - `actionType`: 'accept' | 'repair_module' | 'regenerate_all'
  - `targetModules`: string[] - 修复目标模块
  - `issueCountBefore`: number - 修复前问题数
  - `issueCountAfter`: number - 修复后问题数
  - `scoreBefore`: number - 修复前分数
  - `scoreAfter`: number - 修复后分数

**关键证据点 - Delta 对比**:
- `initialValidationReport.score` vs `finalValidationReport.score`
- `initialValidationReport.summary.fatal` vs `finalValidationReport.summary.fatal`
- `initialValidationReport.summary.major` vs `finalValidationReport.summary.major`
- `initialValidationReport.summary.minor` vs `finalValidationReport.summary.minor`

**关键证据点 - 模块抽样**:
- `draft.payoff.lines` - payoff 台词列表（抽样前2条）
- `draft.opponents` - 对手列表（抽样前2条）
- `draft.power.ladder` - 权力阶梯（抽样前2条）
- `draft.traitors` - 叛徒列表（抽样前2条）
- `draft.traitorStages` - 叛徒阶段（抽样前2条）
- `draft.storyPhases` - 故事阶段（抽样前2条）

### 5. Persist 结果 (persistResult)
**接口**: POST /pipeline/1/worldview/persist

**预期返回字段** (基于代码 L469-485):
```typescript
{
  ok: true,
  summary: object,
  qualitySummary: object,
  qualityWarnings: WorldviewQualityWarning[],
  inferenceSummary: WorldviewInferenceSummary,
  alignmentSummary: WorldviewAlignmentSummary,
  alignmentWarnings: WorldviewAlignmentWarning[],
  validationReport: WorldviewValidationReport,
  closureStatus: WorldviewClosureStatus,              // 闭环字段
  repairApplied: false,                               // 闭环字段（persist 总是 false）
  evidenceReselected: false,                          // 闭环字段（persist 总是 false）
  normalizationWarnings?: string[],
  validationWarnings?: string[]
}
```

**关键证据点**:
- `validationReport.score` - 持久化后的校验分数
- `validationReport.summary` - 问题统计
- `closureStatus` - 闭环状态
- `summary` - 持久化摘要（插入的记录数等）

### 6. Overview 结果 (overviewResult)
**接口**: GET /pipeline/1/overview

**预期返回字段**:
```typescript
{
  worldview: {
    protagonist: { name: string, ... },
    setting: { era: string, ... },
    theme: string,
    payoff: { lines: PayoffLine[] },
    opponents: Opponent[],
    power: { ladder: PowerLevel[] },
    traitors: Traitor[],
    traitorStages: TraitorStage[],
    storyPhases: StoryPhase[]
  }
}
```

**关键证据点**:
- `worldview.payoff.lines.length` - payoff 台词数量
- `worldview.opponents.length` - 对手数量
- `worldview.power.ladder.length` - 权力层级数量
- `worldview.traitors.length` - 叛徒数量
- `worldview.traitorStages.length` - 叛徒阶段数量
- `worldview.storyPhases.length` - 故事阶段数量
- `worldview.protagonist.name` - 主角名称
- `worldview.setting.era` - 时代背景
- `worldview.theme` - 主题

### 7. 数据库检查 (dbChecks)
由于无法直接访问数据库，采用以下替代方案：
- `unableDirectDb`: true
- `alternativeEvidence`: 
  - 通过 overview 接口返回的持久化数据计数
  - 通过 persist 接口的 summary 字段
  - 通过 generate 接口的 draft 字段对比

### 8. UI 检查 (uiChecks)
由于采用 API 测试方式，无法直接验证前端 UI。预期 UI 应显示：

**在 Worldview Dialog 中**:
- "闭环修复结果" 区域
- "闭环校验摘要" 区域
- 显示 `closureStatus` 状态
- 显示 `repairApplied` 和 `evidenceReselected` 标记
- 显示 `repairSummary` 的详细信息

**Warning 映射模块**:
- payoff 相关警告
- opponents 相关警告
- power 相关警告
- traitor 相关警告
- story_phase 相关警告

### 9. 判定标准 (verdictCandidate)

**PASS 条件**:
- 所有服务可达
- 登录成功
- Preview/Generate/Persist/Overview 所有接口返回 200
- 运行时闭环字段已加载（runtimeFieldsLoaded = true）
- Generate 接口返回完整的闭环字段（initialValidationReport, finalValidationReport, repairSummary, closureStatus, repairApplied, evidenceReselected）
- Persist 接口返回闭环字段（validationReport, closureStatus, repairApplied, evidenceReselected）

**PARTIAL 条件**:
- 登录成功
- 至少 Preview 或 Generate 接口成功
- 但存在部分接口失败或字段缺失

**FAIL 条件**:
- 服务不可达
- 登录失败
- 主要接口调用失败

## 测试脚本
已创建以下测试脚本：
- `test_direct.py` - Python 测试脚本（推荐）
- `test_wv_simple.py` - 简化版 Python 脚本
- `test-worldview-closure.js` - Node.js 测试脚本

## 执行方式
```bash
# 确保服务已启动
# 前端: npm run dev (在 apps/web 目录)
# 后端: npm run start:dev (在 apps/api 目录)

# 执行测试脚本
cd d:\project\duanju\shortdrama
python test_direct.py

# 查看结果
cat test_result.json
cat test_log.txt
```

## 代码实现参考
- Preview: `apps/api/src/pipeline/pipeline-worldview.service.ts` L216-269
- Generate: `apps/api/src/pipeline/pipeline-worldview.service.ts` L271-422
- Persist: `apps/api/src/pipeline/pipeline-worldview.service.ts` L424-486
- 闭环逻辑: L308-395 (initialValidationReport → repairPlan → repair → finalValidationReport)
- 闭环类型定义: `apps/api/src/pipeline/worldview-closure.types.ts`

## 注意事项
1. Generate 接口可能耗时较长（调用 AI 模型），建议设置 120 秒超时
2. 闭环修复逻辑在 Generate 阶段执行，Persist 不执行修复
3. `repairApplied` 和 `evidenceReselected` 字段仅在 Generate 时可能为 true
4. `closureStatus` 可能的值：'accepted', 'accepted_with_repair', 'rejected'
5. 前端 UI 应根据这些字段动态显示闭环修复结果

## 下一步
1. 手动执行测试脚本获取实际结果
2. 将实际结果与本文档预期进行对比
3. 如有差异，分析原因并更新实现或文档
