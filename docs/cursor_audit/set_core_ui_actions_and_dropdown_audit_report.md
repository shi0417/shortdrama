# set_core UI 动作与下拉审计报告（只读）

## 审计范围与约束

- 审计时间：当前工作区只读检查
- 本次操作：仅阅读代码并产出报告
- 未执行：业务代码修改、数据库写入、migration、commit

读取文件：
- `apps/web/src/components/PipelinePanel.tsx`
- `apps/web/src/components/pipeline/SetCoreEditor.tsx`
- `apps/web/src/lib/set-core-api.ts`
- `apps/web/src/types/pipeline.ts`
- `apps/api/src/set-core/set-core.controller.ts`
- `apps/api/src/set-core/set-core.service.ts`

---

## A) set_core 区块相关前端代码定位与摘录

### A1. set_core 数据列表渲染位置（当前 #1/#2/#3/#4 表格来源）

在 `PipelinePanel.tsx` 的 `modules.map((item) => ...)` 内，所有模块都复用同一段列表渲染；`set_core` 通过 `getModuleRows('set_core') -> worldview.core` 进入该表格：

```tsx
{modules.map((item) => (
  <div key={item.key}>
    {/* ...模块行... */}
    {item.key === 'set_core' && expandedEditors.set_core && (
      <SetCoreEditor
        coreSettingText={coreSettingText}
        setCoreSettingText={setCoreSettingText}
        coreFields={coreFields}
        setCoreFields={setCoreFields}
        versions={setCoreVersions}
        activeVersionId={activeSetCoreVersionId}
        onChangeVersion={handleChangeSetCoreVersion}
        onInsertCharacters={handleInsertCharacters}
        onGenerate={handleAiGenerate}
        onSave={handleSetCoreSave}
        onCollapse={() => void toggleEditor('set_core')}
        saveMode={setCoreSaveMode}
        setSaveMode={setSetCoreSaveMode}
      />
    )}
    <div
      style={{
        marginTop: '8px',
        paddingLeft: '12px',
        borderLeft: '2px solid #f0f0f0',
      }}
    >
      {renderSimpleTable(getModuleRows(item.key))}
    </div>
  </div>
))}
```

### A2. `renderSimpleTable` 表格渲染函数

位于 `PipelinePanel.tsx`，是全模块复用函数（Step1/Step2/Step3 均可能调用）：

```tsx
const renderSimpleTable = (rows: Record<string, any>[], emptyText = '暂无数据') => {
  if (!rows.length) {
    return <div style={{ color: '#999', fontSize: '13px' }}>{emptyText}</div>
  }

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
      <thead>
        <tr>
          <th style={{ textAlign: 'left', borderBottom: '1px solid #f0f0f0', padding: '8px' }}>title</th>
          <th style={{ textAlign: 'left', borderBottom: '1px solid #f0f0f0', padding: '8px' }}>description</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => (
          <tr key={`${row.id ?? 'r'}-${idx}`}>
            <td style={{ borderBottom: '1px solid #f7f7f7', padding: '8px', verticalAlign: 'top' }}>{extractTitle(row)}</td>
            <td style={{ borderBottom: '1px solid #f7f7f7', padding: '8px', color: '#555' }}>
              {extractDescription(row) || '-'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
```

### A3. SetCoreEditor 中“保存模式”下拉 JSX

来自 `SetCoreEditor.tsx`：

```tsx
<div style={{ marginTop: '4px', fontSize: '12px', color: '#666' }}>保存模式</div>
<select
  value={saveMode}
  onChange={(e) => setSaveMode(e.target.value as 'update_active' | 'new_version')}
  style={{ padding: '8px 10px', border: '1px solid #d9d9d9', borderRadius: '4px' }}
>
  <option value="update_active">更新当前版本（update_active）</option>
  <option value="new_version">新建版本（new_version）</option>
</select>
```

### A4. SetCoreEditor 中“历史版本”下拉 JSX

来自 `SetCoreEditor.tsx`：

```tsx
<div style={{ marginTop: '4px', fontSize: '12px', color: '#666' }}>历史版本</div>
<select
  value={activeVersionId ?? ''}
  onChange={(e) => {
    const versionId = Number(e.target.value)
    if (Number.isInteger(versionId) && versionId > 0) {
      onChangeVersion(versionId)
    }
  }}
  style={{ padding: '8px 10px', border: '1px solid #d9d9d9', borderRadius: '4px' }}
>
  <option value="">请选择历史版本</option>
  {versions.map((item) => (
    <option key={item.id} value={item.id}>
      {`v${item.version} - ${item.title?.trim() ? item.title : '(无标题)'}${item.isActive ? ' [active]' : ''}`}
    </option>
  ))}
</select>
```

### A5. set_core 编辑器 props 定义

来自 `SetCoreEditor.tsx`：

```ts
interface SetCoreEditorProps {
  coreSettingText: string
  setCoreSettingText: Dispatch<SetStateAction<string>>
  coreFields: CoreFields
  setCoreFields: Dispatch<SetStateAction<CoreFields>>
  saveMode: 'update_active' | 'new_version'
  setSaveMode: Dispatch<SetStateAction<'update_active' | 'new_version'>>
  versions: SetCoreVersionDto[]
  activeVersionId: number | null
  onChangeVersion: (versionId: number) => void
  onInsertCharacters: () => void
  onGenerate: () => void
  onSave: () => void
  onCollapse: () => void
}
```

### A6. set_core 列表数据来源（`worldview.core / loadOverview`）

来自 `PipelinePanel.tsx`：

```ts
const loadOverview = async () => {
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
}
```

```ts
const getModuleRows = (moduleKey: string): Record<string, any>[] => {
  switch (moduleKey) {
    case 'set_core':
      return worldview.core
    // ...
    default:
      return []
  }
}
```

---

## B) set_core 列表“每行操作（删除按钮）”现状

### B1. 当前是否有 action 列 / 行按钮插槽

结论：**没有**。当前表头仅 `title` 和 `description` 两列，`rows.map` 内也没有操作列或按钮容器。

### B2. “最小改动”应插哪一层

- 方案 1：直接改 `renderSimpleTable`（全局函数）
  - 影响面：会波及 Step1/Step2/Step3 所有调用处
  - 不适合只给 `set_core` 加删除按钮
- 方案 2（更合适）：在 `set_core` 模块使用专用渲染
  - 可新增 `renderSetCoreTable(rows)`，仅在 `item.key === 'set_core'` 分支使用
  - 其余模块继续走 `renderSimpleTable`

### B3. 若仅给 set_core 列表加删除按钮，最小隔离方案

推荐最小隔离：
1. 在 `PipelinePanel.tsx` 新增 `renderSetCoreTable`（可带 action 列）
2. 仅替换 `set_core` 分支的渲染调用
3. 其他模块保持 `renderSimpleTable(getModuleRows(item.key))` 不变

---

## C) set_core 列表“展开/收起”现状

### C1. 当前 set_core 列表是否默认一直显示

结论：**是**。在 Step3 展开后，`modules.map` 中每个模块都固定渲染列表区块；没有针对 `set_core` 列表的独立开关。

### C2. 是否已有类似 `expandedPanels / collapsedLists / moduleVisibility` 状态

结论：**没有用于数据列表的状态**。现有状态里只有：
- `step3Expanded`（整段 Step3 展开收起）
- `expandedEditors.set_core`（仅 set_core 编辑器展开收起）

### C3. 最小加法建议

可新增一种状态（任选其一）：
- `expandedDataLists: Record<string, boolean>`，或
- `collapsedLists: Record<string, boolean>`

最小落地可只先支持：
- `expandedDataLists.set_core`

### C4. 按钮最适合放置位置（绿色框对应代码）

建议放在 `modules.map` 内“模块行容器右侧按钮组”附近，即该容器：

```tsx
<div style={{ display: 'flex', gap: '8px' }}>
  {/* 生成 / 编辑 / 保存 */}
</div>
```

在此同级新增“列表展开/收起”按钮，语义最一致且不影响 Step3 header 工具条。

---

## D) 两个下拉的现状与“合并为一个”难点

### D1. 当前 state 绑定

在 `PipelinePanel.tsx`：
- 保存模式：`setCoreSaveMode`
- 历史版本当前值：`activeSetCoreVersionId`
- 历史版本数据：`setCoreVersions`

### D2. 当前 onChange 行为

- 保存模式下拉：
  - `setSaveMode(...)`，仅影响 `handleSetCoreSave` 的 `payload.mode`
- 历史版本下拉：
  - `onChangeVersion(versionId)` -> `handleChangeSetCoreVersion`
  - 触发 `activateSetCoreVersion(id)`，并回填编辑器 + 刷新版本 + `loadOverview`

### D3. 是否可直接合并成一个下拉

结论：**技术上可做，但语义会混合“保存动作”和“版本切换动作”**，误操作概率上升：
- `update_active / new_version` 是“保存时策略”
- `versionId` 是“立即切 active”

两者触发时机不同（一个“保存时生效”，一个“选择即生效”）。

### D4. 如必须合并，最小方案建议（仅建议）

可用统一 option value 前缀分流：
- `action:update_active`
- `action:new_version`
- `version:4`
- `version:3`

`onChange` 分流逻辑：
1. `value.startsWith('action:')` -> 仅更新 `setCoreSaveMode`
2. `value.startsWith('version:')` -> 解析 id 后调用 `handleChangeSetCoreVersion`

注意：为避免 UI 选中态混乱，需增加一个独立的“组合下拉显示值”状态，且保存模式仍需可见反馈（例如辅助文本）。

---

## E) 后端只读核对（删除接口现状）

当前 `set-core` controller 已有：
- `GET /novels/:novelId/set-core`
- `GET /novels/:novelId/set-core/versions`
- `POST /novels/:novelId/set-core:upsert`
- `POST /set-core/:id/activate`

结论：**没有 `DELETE /set-core/:id` 或等价删除接口**。

因此需明确：
- 当前前端不能直接“真删除 set_core 记录”
- 若要接“列表删除按钮”，后端需先补删除接口（本次不实现）

---

## F) 结论与最小安全实现顺序

### F1. 3 个需求分别改哪些文件

1. 列表删除按钮  
   - 前端：`apps/web/src/components/PipelinePanel.tsx`
   - 后端（若真删）：`apps/api/src/set-core/set-core.controller.ts`、`apps/api/src/set-core/set-core.service.ts`
2. 列表展开收起  
   - 前端：`apps/web/src/components/PipelinePanel.tsx`
3. 两个下拉合并为一个  
   - 前端：`apps/web/src/components/pipeline/SetCoreEditor.tsx`、`apps/web/src/components/PipelinePanel.tsx`

### F2. 哪些需求只改前端即可

- 列表展开收起：只改前端即可
- 下拉合并：只改前端即可

### F3. 哪些需求需要后端补接口

- 列表删除按钮（真实删除）：需要后端新增删除接口

### F4. 最小安全实现顺序（建议）

1. 先做“列表展开收起”（纯前端、低风险）
2. 再做“删除按钮 UI 占位/交互骨架”（先不落库）
3. 后端补删除接口后再接通真实删除
4. 最后评估是否真的要合并两个下拉（建议保留分离，避免动作语义混淆）

---

## 审计结论摘要

- 当前 set_core 列表由 `worldview.core` 通过通用 `renderSimpleTable` 渲染，无 action 列。
- 当前无“列表展开收起”的独立状态；仅有 Step3 整体与 set_core 编辑器两级展开。
- 当前保存模式与历史版本切换语义分离清晰；合并为一个下拉会引入行为分流与误操作风险。
- 当前后端不存在 DELETE set_core 接口。
