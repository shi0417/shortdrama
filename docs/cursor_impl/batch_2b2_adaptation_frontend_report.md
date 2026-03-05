# Batch 2B-2 Adaptation Frontend Report

## 1) 新增/修改文件清单

- `apps/web/src/types/adaptation.ts` (new)
- `apps/web/src/lib/adaptation-api.ts` (new)
- `apps/web/src/components/pipeline/AdaptationStrategyToolbar.tsx` (new)
- `apps/web/src/components/PipelinePanel.tsx` (modified: Step3 header toolbar integration)

## 2) 关键实现点

### 2.1 Step3 Header 按钮位置（红框语义）

`PipelinePanel` 的 Step3 header 右侧已改为按钮组：

- 主按钮：`新增重构模型`
- 旁边：`Collapse/Expand`（保留原逻辑）

同时在 header 区域补充“当前策略版本”展示与版本切换入口，语义上作为 Step3 全局策略入口，而非任一模块子操作。

### 2.2 Adaptation API 封装

`apps/web/src/lib/adaptation-api.ts`:

- `listAdaptationModes()`
- `listNovelAdaptationStrategies(novelId)`
- `createNovelAdaptationStrategy(novelId, payload)`
- `updateAdaptationStrategy(id, payload)`
- `deleteAdaptationStrategy(id)`

全部复用 `apiClient`（即 `localStorage.accessToken` + `NEXT_PUBLIC_API_BASE_URL`）。

### 2.3 Toolbar 组件能力

`AdaptationStrategyToolbar` 提供：

- 首次加载并发拉取模式字典与策略列表
- 默认选中最新版本（后端返回已按 `version DESC` 排序）
- 顶部状态显示：`modeName + v{version} + updatedAt`
- 下拉切换历史策略
- 弹窗创建策略（mode/title/description/prompt）
- 编辑当前策略（预填并 PATCH）
- 删除当前策略（confirm 二次确认）

注意：本批次未接入任何 AI 调用，Step3 六模块按钮仍保持原 `console.log` 行为。

## 3) Build 验证

Command:

```bash
pnpm --dir apps/web build
```

Result: passed.

## 4) 手动验证步骤

1. 打开 `/projects`，选择任意项目
2. 进入 `Pipeline`，展开 Step3
3. 点击 `新增重构模型`，填写并提交
4. 观察 header 显示当前 `mode + version`
5. 使用下拉切换历史版本
6. 对当前版本执行 `编辑`、`删除`

## 5) 兼容性说明

- 本次仅改 `apps/web`（前端）并新增适配 API 文件；未引入新 UI 框架。
- `PipelinePanel` 中 Step3 六模块渲染与原有 world-view 展示逻辑未被改写。
