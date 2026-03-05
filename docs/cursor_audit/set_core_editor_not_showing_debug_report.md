# Step3 set_core 行内编辑器不显示：只读调试报告

## 范围与约束

- 本报告基于只读检查：仅阅读前端代码并做渲染路径推断
- 未修改业务代码、未写库、未改 DB、未执行迁移

---

## A) 精确定位渲染点

### A.1 文件与模块定位

- 目标文件：`apps/web/src/components/PipelinePanel.tsx`
- Step3 渲染位于 `modules.map(...)` 代码块
- `SetCoreEditor` 组件存在并已 import：`import SetCoreEditor from './pipeline/SetCoreEditor'`

### A.2 关键代码摘录（原样）

#### 1) `modules` 数组中 `set_core` 的 key 值

```tsx
const modules = [
  { key: 'set_core', title: '1 核心设定', mapping: 'set_core' },
  { key: 'set_payoff', title: '2 核心爽点架构', mapping: 'set_payoff_arch / set_payoff_lines' },
  { key: 'set_opponent', title: '3 对手矩阵', mapping: 'set_opponent_matrix / set_opponents' },
  { key: 'set_power_ladder', title: '4 权力升级阶梯', mapping: 'set_power_ladder' },
  { key: 'set_traitor', title: '5 内鬼系统', mapping: 'set_traitor_system / set_traitors / set_traitor_stages' },
  { key: 'set_story_phases', title: '6 故事发展阶段', mapping: 'set_story_phases' },
]
```

#### 2) `expandedEditors` 初始化对象

```tsx
const [expandedEditors, setExpandedEditors] = useState<Record<string, boolean>>({
  set_core: false,
})
```

#### 3) `toggleEditor` 实现

```tsx
const toggleEditor = (moduleKey: string) => {
  setExpandedEditors((prev) => ({ ...prev, [moduleKey]: !prev[moduleKey] }))
}
```

#### 4) `set_core` 行“编辑”按钮 `onClick`

```tsx
<button
  onClick={() => {
    if (item.key === 'set_core') {
      toggleEditor('set_core')
      handleModuleAction(item.key, 'edit')
      return
    }
    handleModuleAction(item.key, 'edit')
  }}
  style={{ padding: '6px 12px', border: '1px solid #d9d9d9', background: 'white', borderRadius: '4px', cursor: 'pointer' }}
>
  {item.key === 'set_core' && expandedEditors.set_core ? '收起' : '编辑'}
</button>
```

#### 5) `set_core` 行下方条件渲染 `SetCoreEditor` 的 if 条件

```tsx
{item.key === 'set_core' && expandedEditors.set_core && (
  <SetCoreEditor
    coreSettingText={coreSettingText}
    setCoreSettingText={setCoreSettingText}
    coreFields={coreFields}
    setCoreFields={setCoreFields}
    onInsertCharacters={handleInsertCharacters}
    onGenerate={handleAiGenerate}
    onSave={handleSetCoreSave}
    onCollapse={() => toggleEditor('set_core')}
  />
)}
```

---

## B) 复现路径检查（按代码事实）

### B.1 `expandedEditors.set_core` 默认值

- 结论：**满足**
- 现状：默认是 `false`
- 推断：页面刷新后如果不点击 `set_core` 行【编辑】，编辑器不会出现

### B.2 “编辑”按钮是否调用 `toggleEditor('set_core')`

- 结论：**满足**
- 在 `item.key === 'set_core'` 分支中明确调用了 `toggleEditor('set_core')`

### B.3 条件渲染 key 是否一致

- 结论：**满足**
- 一致使用 `set_core`（`modules` key、`toggleEditor('set_core')`、`expandedEditors.set_core` 条件）

### B.4 `SetCoreEditor` 渲染位置是否在 map 内

- 结论：**满足**
- `SetCoreEditor` 位于 `modules.map` 的每个条目内部，且仅在 `set_core` 条目下渲染
- 未发现被删除或移动到 map 外

### B.5 是否存在样式裁剪导致不可见

- 结论：**基本满足（未发现直接裁剪为 0 的证据）**
- Step3 外层容器使用 `overflow: hidden`，但 `SetCoreEditor` 在同一容器内部正常流式布局
- 未见 `height: 0` / `display: none` / 绝对定位覆盖等明显隐藏样式

---

## C) 根因结论（1-3 条）

1. 当前实现是“**默认折叠**”策略：`expandedEditors.set_core` 初始值为 `false`，因此初次进入 Step3 只会看到模块行，不会看到 `SetCoreEditor`。
2. `SetCoreEditor` 有双条件门禁：`item.key === 'set_core' && expandedEditors.set_core`，任何一个条件不成立都不会渲染；最常见是第二个条件为 false。
3. 从代码看不存在 key 写错、组件缺失、或明显样式裁剪为 0 的问题；“看不到编辑器”更符合“未触发展开条件”的表现。

---

## D) 最小修复方案（可执行建议）

> 当前阶段不改代码，只给最小可执行方案。

### 方案 1（保持交互：默认不展开）

目标：初始仍收起，但点击 `set_core` 行【编辑】必定展开；再次点击收起。

- 改动文件：
  - `apps/web/src/components/PipelinePanel.tsx`
- 最小建议：
  - 保持现有 `expandedEditors` 默认 `false`
  - 将 `set_core`【编辑】点击逻辑改为“显式 set”，避免 toggle 在复杂交互中被反向覆盖：
    - 若当前关闭 -> 设为 `true`
    - 若当前打开 -> 设为 `false`
  - 对 `SetCoreEditor` 的 `onCollapse` 保持收起逻辑
- 适用场景：
  - 维持“进入 Step3 不自动展开”的体验

### 方案 2（目标态默认展开）

目标：进入 Step3 就默认看到 `set_core` 编辑器。

- 改动文件：
  - `apps/web/src/components/PipelinePanel.tsx`
- 最小建议（二选一）：
  1. 初始化直接设为：
     - `set_core: true`
  2. 或在 `useEffect([novelId])` 中自动展开：
     - `setExpandedEditors(prev => ({ ...prev, set_core: true }))`
- 适用场景：
  - 产品希望“Step3 首屏默认展示核心设定输入区”

---

## E) 构建验证建议（不执行）

建议命令：

```bash
pnpm --dir apps/web build
```

手动验证建议：

1. 打开 `/projects` -> 选择项目 -> 进入 `Pipeline` -> 展开 Step3
2. 观察 `set_core` 行【编辑】点击前后，是否出现/收起 `SetCoreEditor`
3. 若启用方案2，验证进入 Step3 时是否默认可见

---

## 结论摘要

- 当前代码链路完整，`SetCoreEditor` 不是“丢失/挂错位置”，而是默认折叠导致初始不可见。
- 最小修复优先建议：按产品预期在“方案1（交互展开）”和“方案2（默认展开）”二选一落地。
