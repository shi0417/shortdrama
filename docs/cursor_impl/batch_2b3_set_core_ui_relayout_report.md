# Batch 2B-3 set_core UI Relayout Report

## 1) 改动/新增文件清单

- `apps/web/src/components/PipelinePanel.tsx`（modified）
- `apps/web/src/components/pipeline/SetCoreEditor.tsx`（new）

本批次仅改 `apps/web`，未改 `apps/api`、未改数据库结构、未新增后端接口。

## 2) 关键实现说明（expandedEditors）

在 `PipelinePanel` 新增模块级展开状态：

```ts
const [expandedEditors, setExpandedEditors] = useState<Record<string, boolean>>({
  set_core: false,
})
```

并新增切换方法：

```ts
const toggleEditor = (moduleKey: string) => {
  setExpandedEditors((prev) => ({ ...prev, [moduleKey]: !prev[moduleKey] }))
}
```

### set_core 行行为

- 点击 `set_core` 行的【编辑】：
  - 切换 `expandedEditors.set_core`
  - 保留原 `console.log` 行为（`handleModuleAction`）
- 当 `expandedEditors.set_core === true` 时，在该行下方渲染：
  - `<SetCoreEditor ... />`
- 在 `SetCoreEditor` 中提供【收起】按钮，二次折叠编辑器。

### 保存按钮联动

- `set_core` 行【保存】改为调用 `handleSetCoreSave`
  - 保留 `console.log`（提示未接接口）
  - 同时确保 `expandedEditors.set_core = true`，点击后有可见 UI 反馈

## 3) 旧底部编辑器移除证据

已从 `PipelinePanel.tsx` 删除原先位于 Step3 区块之后的整段“核心设定”独立编辑器 JSX（原红框位置）。

当前结构为：

- Step3 `modules.map` 中的 `set_core` 行下方条件渲染编辑器（行内展开）
- 页面底部不再渲染重复编辑器

## 4) SetCoreEditor 抽离情况

新增 `SetCoreEditor` 组件并复用原输入 UI（保持 inline style 风格）：

- `coreSettingText / setCoreSettingText`
- `coreFields / setCoreFields`
- `onInsertCharacters`
- `onGenerate`
- `onSave`
- `onCollapse`

保留原交互语义：

- 插入人物按钮：`console.log`（未接写库）
- 生成/完善按钮：`console.log`（本地预览）
- 保存按钮：`console.log`（未接保存接口）

## 5) worldview.core 展示逻辑

未改动 Step3 现有只读展示：

- `worldview.core` 仍通过 `renderSimpleTable(worldview.core)` 显示
- 数据仍来自 `GET /pipeline/:novelId/overview`
- 本批次未合并展示流与编辑流，仅做 UI 重排

## 6) 构建验证

执行：

```bash
pnpm --dir apps/web build
```

结果：通过（exit code 0）。

## 7) UI 验证步骤

1. 打开 `/projects`
2. 选择任一项目 -> 切到 `Pipeline`
3. 展开 Step3
4. 在 `1 核心设定 set_core` 行点击【编辑】
   - 期望：该行下方展开 `SetCoreEditor`
5. 再次点击【编辑】或点编辑器内【收起】
   - 期望：编辑器折叠
6. 观察页面底部
   - 期望：不再出现旧版独立 set_core 编辑器
