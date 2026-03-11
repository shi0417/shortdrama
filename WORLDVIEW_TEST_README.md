# Worldview 闭环补测使用说明

## 概述
本测试套件用于验证 shortdrama 项目中 worldview 闭环修复功能的完整性。测试通过 API 调用方式执行 preview->generate->persist->overview 完整流程，并采集前后对比证据。

## 文件说明

### 测试脚本
1. **execute_worldview_test.py** (推荐)
   - 完整的测试脚本，包含详细日志和错误处理
   - 自动生成 JSON 格式的测试结果
   - 输出文件: `worldview_test_result.json`, `test_execution.log`

2. **test_direct.py**
   - 简化版测试脚本
   - 输出文件: `test_result.json`, `test_log.txt`

3. **test-worldview-closure.js**
   - Node.js 版本的测试脚本
   - 需要 Node.js 环境

### 文档
1. **worldview_closure_test_report.md**
   - 详细的测试报告文档
   - 包含预期结果、关键证据点、代码实现参考

2. **worldview_test_result_expected.json**
   - 基于代码实现的预期结果模板
   - 用于对比实际测试结果

3. **WORLDVIEW_TEST_README.md** (本文件)
   - 使用说明

## 前置条件

### 1. 环境要求
- Python 3.7+ (推荐使用 Python 脚本)
- 或 Node.js 14+ (如使用 JS 脚本)
- requests 库 (Python): `pip install requests`

### 2. 服务启动
确保前端和后端服务已启动：

```bash
# 启动后端 (在 apps/api 目录)
cd apps/api
npm run start:dev

# 启动前端 (在 apps/web 目录，新终端)
cd apps/web
npm run dev
```

### 3. 数据准备
确保数据库中存在 novel_id=1 的数据，并且相关表已创建。

## 执行测试

### 方法 1: 使用 Python 脚本 (推荐)

```bash
# 进入项目根目录
cd d:\project\duanju\shortdrama

# 执行测试
python execute_worldview_test.py

# 查看结果
type worldview_test_result.json
type test_execution.log
```

### 方法 2: 使用 Node.js 脚本

```bash
# 进入项目根目录
cd d:\project\duanju\shortdrama

# 执行测试
node test-worldview-closure.js

# 查看结果（如果脚本成功生成）
type test_result.json
```

## 测试流程

测试脚本会按以下顺序执行：

1. **服务检查**
   - 检查前端服务 (http://localhost:3000)
   - 检查后端服务 (http://localhost:4000/health)

2. **登录**
   - 使用账号 s01 / 123456 登录
   - 获取 JWT token

3. **Preview (预览世界观)**
   - POST /pipeline/1/worldview/preview
   - 检查 validationReportPreview 字段
   - 记录证据摘要和质量警告

4. **Generate (生成世界观草稿)**
   - POST /pipeline/1/worldview/generate
   - **关键步骤**: 执行闭环修复逻辑
   - 记录 initialValidationReport (修复前)
   - 记录 finalValidationReport (修复后)
   - 记录 repairSummary, closureStatus, repairApplied, evidenceReselected
   - 抽样模块数据 (payoff, opponents, power, traitors, traitorStages, storyPhases)

5. **Persist (持久化世界观)**
   - POST /pipeline/1/worldview/persist
   - 将 Generate 的 draft 持久化到数据库
   - 记录 validationReport 和 closureStatus

6. **Overview (获取世界观概览)**
   - GET /pipeline/1/overview
   - 验证持久化后的数据
   - 统计各模块的记录数

7. **生成判定**
   - PASS: 所有接口成功，闭环字段完整
   - PARTIAL: 部分接口成功
   - FAIL: 关键接口失败

## 结果解读

### 判定标准

#### PASS (通过)
所有以下条件满足：
- ✓ 后端服务可达
- ✓ 登录成功
- ✓ Preview 返回 200
- ✓ Generate 返回 200
- ✓ Persist 返回 200
- ✓ Overview 返回 200
- ✓ 运行时闭环字段已加载 (runtimeFieldsLoaded = true)

#### PARTIAL (部分通过)
- ✓ 登录成功
- ✓ 至少 Preview 或 Generate 成功
- ✗ 但存在部分接口失败

#### FAIL (失败)
- ✗ 后端服务不可达
- ✗ 登录失败
- ✗ 主要接口调用失败

### 关键字段说明

#### closureStatus (闭环状态)
- `accepted`: 直接接受，无需修复
- `accepted_with_repair`: 应用修复后接受
- `rejected`: 拒绝（存在 fatal 问题）

#### repairApplied (修复已应用)
- `true`: Generate 阶段执行了模块修复
- `false`: 未执行修复（质量足够好或 Persist 阶段）

#### evidenceReselected (证据已重选)
- `true`: 过滤了弱相关性证据
- `false`: 未重新选择证据

#### repairSummary (修复摘要)
```json
{
  "actionType": "repair_module",      // 修复类型
  "targetModules": ["payoff", "..."], // 修复目标模块
  "issueCountBefore": 7,              // 修复前问题数
  "issueCountAfter": 2,               // 修复后问题数
  "scoreBefore": 65,                  // 修复前分数
  "scoreAfter": 85                    // 修复后分数
}
```

#### delta (前后对比)
```json
{
  "score": {
    "before": 65,
    "after": 85,
    "improvement": 20    // 分数改善
  },
  "fatal": {
    "before": 0,
    "after": 0,
    "reduction": 0       // Fatal 问题减少数
  },
  "major": {
    "before": 3,
    "after": 0,
    "reduction": 3       // Major 问题减少数
  },
  "minor": {
    "before": 4,
    "after": 2,
    "reduction": 2       // Minor 问题减少数
  }
}
```

## 常见问题

### Q1: 测试脚本执行后没有输出
**A**: 这可能是终端配置问题。解决方案：
1. 检查 Python 是否正确安装: `python --version`
2. 检查 requests 库是否安装: `pip list | findstr requests`
3. 尝试直接查看输出文件: `type worldview_test_result.json`

### Q2: 后端服务不可达
**A**: 确保后端服务已启动：
```bash
cd apps/api
npm run start:dev
```
检查端口占用: `netstat -an | findstr ":4000"`

### Q3: 登录失败
**A**: 检查：
1. 数据库中是否存在用户 s01
2. 密码是否正确 (123456)
3. JWT 配置是否正确

### Q4: Generate 接口超时
**A**: Generate 接口会调用 AI 模型，可能耗时较长。解决方案：
1. 增加超时时间（脚本中已设置为 120 秒）
2. 检查 AI 模型服务是否正常
3. 查看后端日志了解详细错误

### Q5: 如何验证闭环修复是否真的执行了？
**A**: 检查以下证据：
1. `repairApplied` 字段为 `true`
2. `initialValidationReport` 和 `finalValidationReport` 不同
3. `repairSummary.issueCountAfter` < `repairSummary.issueCountBefore`
4. `repairSummary.scoreAfter` > `repairSummary.scoreBefore`
5. `repairSummary.targetModules` 列出了修复的模块

## 代码实现参考

### 核心文件
- `apps/api/src/pipeline/pipeline-worldview.service.ts`
  - L216-269: previewPrompt 方法
  - L271-422: generateDraft 方法（包含闭环逻辑）
  - L424-486: persistDraft 方法

- `apps/api/src/pipeline/worldview-closure.types.ts`
  - 闭环相关类型定义

- `apps/api/src/pipeline/worldview-validation-orchestrator.ts`
  - 校验编排器

- `apps/api/src/pipeline/worldview-repair-planner.ts`
  - 修复计划器

- `apps/api/src/pipeline/worldview-module-repair.service.ts`
  - 模块修复服务

### 闭环逻辑流程 (generateDraft 方法)
```typescript
// 1. 生成初始草稿
const draft = await this.callLcAiApi(usedModelKey, finalPrompt);

// 2. 初始校验
const initialValidationReport = this.validationOrchestrator.evaluate({...});

// 3. 制定修复计划
const repairPlan = this.repairPlanner.buildPlan(initialValidationReport);

// 4. 执行修复 (如果需要)
if (repairPlan.actionType !== 'accept') {
  repairApplied = true;
  
  // 4.1 证据重选 (如果需要)
  if (repairPlan.needsEvidenceReselect) {
    const filtered = this.filterWeakRelevanceEvidence(repairPrompt);
    evidenceReselected = filtered.removedCount > 0;
  }
  
  // 4.2 应用模块修复
  const repairedDraft = await this.moduleRepairService.apply({...});
  
  // 4.3 最终校验
  finalValidationReport = this.validationOrchestrator.evaluate({...});
}

// 5. 确定闭环状态
closureStatus = this.resolveClosureStatus(finalValidationReport, repairApplied);

// 6. 返回闭环结果
return {
  draft,
  initialValidationReport,
  finalValidationReport,
  repairSummary,
  closureStatus,
  repairApplied,
  evidenceReselected,
  ...
};
```

## 下一步

1. **执行测试**: 运行 `python execute_worldview_test.py`
2. **查看结果**: 检查 `worldview_test_result.json`
3. **对比预期**: 与 `worldview_test_result_expected.json` 对比
4. **分析差异**: 如有差异，查看 `test_execution.log` 了解详情
5. **验证 UI**: 在前端界面中验证闭环修复结果的显示

## 联系与支持

如有问题，请查看：
- 详细测试报告: `worldview_closure_test_report.md`
- 实现文档: `docs/cursor_impl/worldview_closed_loop_mvp_v1_report.md`
- 代码实现: `apps/api/src/pipeline/pipeline-worldview.service.ts`
