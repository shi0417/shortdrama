# Step3 底部列表位置只读审计报告

## 审计范围

- 仅只读检查前端代码
- 核心文件：`apps/web/src/components/PipelinePanel.tsx`、`apps/web/src/lib/api.ts`
- 未修改业务代码、未写库、未改 DB、未提交

---

## A) Step3 三块渲染结构定位

### A1. `modules.map(...)` 的 6 个模块行渲染块（关键 JSX 摘录）

```tsx
{step3Expanded && (
  <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
    {modules.map((item) => (
      <div key={item.key}>
        <div
          style={{
            border: '1px solid #f0f0f0',
            borderRadius: '6px',
            padding: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          <div>
            <div style={{ fontWeight: 600 }}>{item.title}</div>
            <div style={{ fontSize: '12px', color: '#666' }}>{item.mapping}</div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => handleModuleAction(item.key, 'generate')}>生成(或刷新)</button>
            <button onClick={() => { /* edit */ }}>编辑</button>
            <button onClick={() => { /* save */ }}>保存</button>
          </div>
        </div>
        {/* set_core 行内条件渲染在这里 */}
      </div>
    ))}
    {/* 底部列表块在这里（map 之后） */}
  </div>
)}
```

### A2. `set_core` 行内编辑器（`SetCoreEditor`）条件渲染块

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

### A3. 页面“底部那坨”六组列表渲染块（关键 JSX 摘录）

```tsx
<div style={{ marginTop: '6px' }}>
  <div style={{ fontWeight: 600, marginBottom: '6px' }}>核心设定</div>
  {renderSimpleTable(worldview.core)}
</div>
<div style={{ marginTop: '6px' }}>
  <div style={{ fontWeight: 600, marginBottom: '6px' }}>爽点架构</div>
  {renderSimpleTable(worldview.payoffArch)}
</div>
<div style={{ marginTop: '6px' }}>
  <div style={{ fontWeight: 600, marginBottom: '6px' }}>对手矩阵</div>
  {renderSimpleTable(worldview.opponents)}
</div>
<div style={{ marginTop: '6px' }}>
  <div style={{ fontWeight: 600, marginBottom: '6px' }}>权力阶梯</div>
  {renderSimpleTable(worldview.powerLadder)}
</div>
<div style={{ marginTop: '6px' }}>
  <div style={{ fontWeight: 600, marginBottom: '6px' }}>内鬼系统</div>
  {renderSimpleTable(worldview.traitors)}
</div>
<div style={{ marginTop: '6px' }}>
  <div style={{ fontWeight: 600, marginBottom: '6px' }}>故事阶段</div>
  {renderSimpleTable(worldview.storyPhases)}
</div>
```

层级结论：

- 该“底部列表块”在 **Step3 容器内**（受 `step3Expanded` 控制）
- 但在 **`modules.map` 外部**（即 map 全部模块行渲染完成后统一渲染）
- 所以它会表现为“集中在 Step3 区块底部”，而不是贴着对应模块行出现

---

## B) 底部列表数据来源与映射

### B1. 变量映射（按实际代码）

- 核心设定 -> `worldview.core`
- 爽点架构 -> `worldview.payoffArch`
- 对手矩阵 -> `worldview.opponents`
- 权力阶梯 -> `worldview.powerLadder`
- 内鬼系统 -> `worldview.traitors`
- 故事阶段 -> `worldview.storyPhases`

### B2. 变量来源

`PipelinePanel` 初始化：

```tsx
const [worldview, setWorldview] = useState<PipelineOverviewDto['worldview']>({
  core: [],
  payoffArch: [],
  opponents: [],
  powerLadder: [],
  traitors: [],
  storyPhases: [],
})
```

`useEffect` 中请求并回填：

```tsx
const data = await api.getPipelineOverview(novelId)
setWorldview(
  data.worldview || {
    core: [],
    payoffArch: [],
    opponents: [],
    powerLadder: [],
    traitors: [],
    storyPhases: [],
  }
)
```

请求定义：

```tsx
getPipelineOverview: (novelId: number) =>
  apiClient(`/pipeline/${novelId}/overview`) as Promise<PipelineOverviewDto>
```

### B3. 渲染函数

- 六个底部列表都使用统一函数：`renderSimpleTable(...)`

---

## C) 是否已有“模块行下方渲染数据列表”雏形

结论：**没有完整雏形（只有 set_core 编辑器雏形）**

- 目前 `modules.map` 内仅有 `set_core` 的 `SetCoreEditor` 条件渲染
- 没有任何 `item.key` 对应的 `worldview.*` 列表条件渲染逻辑
- 因此六个数据列表只能集中写在 map 之后的统一区域（即当前底部）

为什么集中在底部：

- 不是数据问题，也不是样式问题
- 是 JSX 结构导致：六个列表块写在 map 外，天然集中在最后

---

## D) 最小可行重排建议（仅建议，不改代码）

### D1. 建议移动的 JSX 块

把当前 map 外的六个列表块迁入 `modules.map((item) => ...)` 内，根据 `item.key` 分发渲染：

- `set_core` -> `renderSimpleTable(worldview.core)`
- `set_payoff` -> `renderSimpleTable(worldview.payoffArch)`
- `set_opponent` -> `renderSimpleTable(worldview.opponents)`
- `set_power_ladder` -> `renderSimpleTable(worldview.powerLadder)`
- `set_traitor` -> `renderSimpleTable(worldview.traitors)`
- `set_story_phases` -> `renderSimpleTable(worldview.storyPhases)`

### D2. 建议新增状态

新增模块级列表开关（可选但推荐）：

- `expandedPanels: Record<string, boolean>`

用途：

- 控制每个模块“数据展示区”展开/收起
- 不影响 `expandedEditors`（set_core 编辑器）

### D3. 与现有结构兼容注意点

- 保持 `AdaptationStrategyToolbar`（Step3 header）不变
- 保持 `SetCoreEditor` 行内结构不变
- 只重排底部六块列表的位置，不改 `worldview` 数据流

---

## E) 若继续实施，建议补充的信息/截图（最多 3 条）

1. 期望每个模块默认“展开列表”还是“折叠列表”？
2. `set_core` 行是否要同时展示“编辑器 + 列表”，还是二选一切换？
3. 模块行下列表是否需要分页/限高滚动（避免单模块过高）？

> 即使以上未补充，仍可按“默认展开且保留现有样式”先做最小重排。

---

## 审计结论

“底部列表出现在页面底部”是**代码结构性结果**：六个 `worldview.*` 列表 JSX 被放在 `modules.map` 之后、但仍在 Step3 容器内，因此统一堆在 Step3 的末尾，而不是贴在对应模块行下方。
