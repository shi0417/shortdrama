# Pipeline Step3 前置操作区审计报告

## 审计范围
- 前端
  - `apps/web/src/app/projects/page.tsx`
  - `apps/web/src/components/ProjectDetail.tsx`
  - `apps/web/src/components/PipelinePanel.tsx`
  - `apps/web/src/components/pipeline/AdaptationStrategyToolbar.tsx`
- 后端
  - `apps/api/src/pipeline/pipeline.controller.ts`
  - `apps/api/src/pipeline/pipeline.service.ts`
  - `apps/api/src/source-texts/source-texts.controller.ts`
  - `apps/api/src/source-texts/source-texts.service.ts`
  - `apps/api/src/skeleton-topics/skeleton-topics.controller.ts`
  - `apps/api/src/skeleton-topics/skeleton-topics.service.ts`

## Step 0：基础信息
- 当前工作目录：`D:/project/duanju/shortdrama`
- `node -v`：`v22.17.0`
- `pnpm -v`：`10.28.2`
- `git status --short`：无输出，当前工作区为干净状态
- `git diff --stat`：无输出，当前无未提交 diff

---

## 文件链路
`/projects -> Pipeline` 的渲染链路如下：

1. `apps/web/src/app/projects/page.tsx`
   - 页面根组件 `ProjectsPage`
   - 右侧详情区渲染 `ProjectDetail`
2. `apps/web/src/components/ProjectDetail.tsx`
   - 通过 `activeTab` 控制 Tab
   - `activeTab === 'pipeline'` 时渲染：
   - `<PipelinePanel novelId={novel.id} novelName={novel.novelsName} />`
3. `apps/web/src/components/PipelinePanel.tsx`
   - 实际负责 `Pipeline` 页面主体
4. `apps/web/src/components/pipeline/AdaptationStrategyToolbar.tsx`
   - 当前 Step 3 标题栏内容已抽到该子组件

---

## Step 1：前端页面链路定位

### 1. `/projects -> Pipeline` 最终由哪个组件负责渲染
最终主组件是：
- `apps/web/src/components/PipelinePanel.tsx`

`ProjectDetail` 中对应代码：

```tsx
{activeTab === 'basic' ? (
  ...
) : activeTab === 'source' ? (
  <SourceTextManager novelId={novel.id} />
) : (
  <PipelinePanel novelId={novel.id} novelName={novel.novelsName} />
)}
```

### 2. Step 3 的标题栏 JSX 精确在哪个文件、哪一段
Step 3 标题栏现在分成两层：

- 外层 header 容器：`apps/web/src/components/PipelinePanel.tsx`
- 标题文字和右侧按钮组：`apps/web/src/components/pipeline/AdaptationStrategyToolbar.tsx`

`AdaptationStrategyToolbar` 中的标题栏核心 JSX：

```tsx
<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
  <div style={{ fontWeight: 600 }}>Step 3 - 生成世界观架构 / 重构爽文模型</div>
  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
    <button ...>新增重构模型</button>
    <button ...>{step3Expanded ? 'Collapse' : 'Expand'}</button>
  </div>
</div>
```

### 3. 截图红框位置（Step 3 上方空白区）在代码结构上属于哪个容器
严格从代码结构看，Step 3 上方目前**没有单独容器**。

它属于 `PipelinePanel` 顶层主容器中的两个 sibling 卡片之间的间隔：

```tsx
return (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
    ...
    <div>Step 2 卡片</div>
    <div>Step 3 卡片</div>
    ...
  </div>
)
```

也就是说，视觉上的“Step 3 上方空白区”本质上是：
- 顶层纵向布局容器的 `gap`
- 而不是现成的独立 `div`

### 4. 在 Step 3 之前，当前页面已经渲染了哪些区块
在 Step 3 之前，`PipelinePanel` 当前已经渲染：
- 页面标题 `Pipeline - {novelName} (ID: {novelId})`
- `loading / error` 提示
- Step 1 卡片：抽取历史骨架
- Step 2 卡片：识别爆点

### 5. 这个位置适不适合插入一个新的独立操作区域 `<div>`
适合，而且非常适合。

原因：
- Step 2 与 Step 3 当前就是两个并列 sibling 卡片
- 插入一个新区域最自然的方式，是在两者之间增加一个新的 sibling `<div>`
- 不会破坏 Step 3 标题栏内部布局
- 语义上也更符合“这是 Step 3 前置操作区，而不是 Step 3 标题栏的一部分”

---

## Step 2：精确定位“最小改动插入点”

### 1. Step 2 末尾 JSX

`PipelinePanel.tsx` 中 Step 2 末尾核心结构如下：

```tsx
<div style={{ border: '1px solid #e8e8e8', borderRadius: '8px', overflow: 'hidden' }}>
  <div ...>
    <div style={{ fontWeight: 600 }}>Step 2 - 识别爆点</div>
    <button ...>{step2Expanded ? 'Collapse' : 'Expand'}</button>
  </div>
  {step2Expanded && (
    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <label>
        <input ... /> 识别爆点 - 保存到 `novel_explosions`
      </label>
      <div>
        <div style={{ fontWeight: 600, marginBottom: '6px' }}>爆点列表</div>
        {renderSimpleTable(explosions)}
      </div>
    </div>
  )}
</div>
```

### 2. Step 3 header 外层 JSX

`PipelinePanel.tsx` 中 Step 3 外层卡片和 header 容器如下：

```tsx
<div style={{ border: '1px solid #e8e8e8', borderRadius: '8px', overflow: 'hidden' }}>
  <div
    style={{
      background: '#fafafa',
      padding: '12px 16px',
      borderBottom: '1px solid #e8e8e8',
    }}
  >
    <AdaptationStrategyToolbar
      novelId={novelId}
      step3Expanded={step3Expanded}
      onToggle={() => setStep3Expanded((prev) => !prev)}
    />
  </div>
  {step3Expanded && (
    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      ...
    </div>
  )}
</div>
```

### 3. Step 3 标题栏 JSX

真正标题栏内容在 `AdaptationStrategyToolbar.tsx`：

```tsx
<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
  <div style={{ fontWeight: 600 }}>Step 3 - 生成世界观架构 / 重构爽文模型</div>
  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
    <button ...>新增重构模型</button>
    <button ...>{step3Expanded ? 'Collapse' : 'Expand'}</button>
  </div>
</div>
```

### 插入点结论
如果要新增一个独立操作区，**最小插入点**应放在：
- `PipelinePanel.tsx` 中
- Step 2 卡片闭合 `</div>` 之后
- Step 3 卡片 `<div ...>` 之前

也就是逻辑上：
- **放在 Step 2 之后、Step 3 之前**
- 而不是放进 Step 3 标题栏内部

### 为什么不是塞进 Step 3 标题栏
因为你的目标语义是：
- Step 3 上方新增一个独立操作区域
- 这个区域位于“已有内容之后、Step 3 标题栏之前”

所以最符合语义的做法不是改 `AdaptationStrategyToolbar`，而是：
- 在 `PipelinePanel` 顶层 sibling 级别插入一个新的独立卡片/操作条

---

## Step 3：现有按钮/操作区模式审计

### 1. 当前页面常用按钮样式怎么写
当前页面按钮几乎都是：
- 纯 inline style
- 无统一 Button 组件
- 按“主按钮 / 次按钮 / 链接按钮”风格手写

常见模式有三类：

#### 主按钮
例如 Step 3 标题栏里的“新增重构模型”

```tsx
style={{
  padding: '6px 12px',
  border: 'none',
  borderRadius: '4px',
  background: '#1890ff',
  color: '#fff',
  cursor: 'pointer',
  fontSize: '13px',
}}
```

#### 次按钮
例如模块行里的“编辑”“列表展开”

```tsx
style={{
  padding: '6px 12px',
  border: '1px solid #d9d9d9',
  background: 'white',
  borderRadius: '4px',
  cursor: 'pointer',
}}
```

#### 链接按钮
例如 Collapse/Expand

```tsx
style={{
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  color: '#1890ff'
}}
```

### 2. 新按钮最适合复用哪里的风格
最适合复用：
- `AdaptationStrategyToolbar.tsx` 中“新增重构模型”的主按钮风格

原因：
- 你的新按钮是一个独立操作入口
- 语义上更像“主操作”
- 比模块行里的小按钮更合适

### 3. 是否已有类似“独立操作区”可参考
严格说，**没有完全同类**。

最接近的两种参考：

#### 参考 1：Step 3 标题栏工具区
- 适合参考按钮风格
- 但不适合直接塞新区域

#### 参考 2：PipelinePanel 底部独立设置块

```tsx
<div style={{ border: '1px solid #e8e8e8', borderRadius: '8px', padding: '12px 16px' }}>
  ...
</div>
```

它说明当前页面允许存在：
- 非 Step 卡片
- 非模块行
- 独立的全宽功能块

所以如果新增一个“操作区域”，最像的落法是：
- 一个单独的全宽 bordered block
- 放在 Step 2 和 Step 3 之间

---

## Step 4：后端/接口现状

### 1. 目前后端是否已经有“抽取历史骨架”的接口
**没有现成的抽取/生成接口。**

当前与 skeleton 相关的只有：
- `GET /novels/:novelId/skeleton-topics`
- `POST /novels/:novelId/skeleton-topics`
- `PATCH /skeleton-topics/:id`
- `DELETE /skeleton-topics/:id`
- `GET /skeleton-topics/:id/items`

这些是：
- 主题配置 CRUD
- topic items 列表读取

不是：
- 从 source text 自动抽取历史骨架

### 2. 目前后端是否已经有“生成爆点”的接口
**没有现成接口。**

当前 `pipeline` 模块只提供：
- `GET /pipeline/:novelId/overview`

其中只是读取：
- `novel_explosions`
- `novel_timelines`
- `novel_characters`
- `novel_key_nodes`
- `novel_skeleton_topics`
- `novel_skeleton_topic_items`

没有任何“生成爆点”的 POST/patch 流程。

### 3. 是否已有能直接复用的只读/写入 service 逻辑
有一部分“读 / CRUD”逻辑可复用，但没有“抽取 / 生成”逻辑。

可复用的主要是：
- `PipelineService.getOverview()`：读取聚合结果
- `SkeletonTopicsService`：管理骨架主题配置
- `SourceTextsService`：读原始资料文本

当前缺的是：
- 从原始资料执行“抽取历史骨架”的编排逻辑
- 从资料 / 骨架结果执行“生成爆点”的编排逻辑

### 4. 如果以后要接这个按钮，最可能新增到哪个模块
最可能新增到：
- **`pipeline` 模块**

原因：
- 这个按钮同时覆盖 Step 1 与 Step 2
- 涉及多个表的组合流程
- 更像 Pipeline 层的“编排入口”

不太适合放到：
- `set-core`
  - 因为它是 Step 3 专属
- `source-texts`
  - 因为它只管原始资料 CRUD

如果未来流程继续变重，也可能拆成：
- 新的 orchestration 模块

但从当前工程结构看，**第一落点最像 `pipeline`**。

---

## Step 5：相关表结论

### 1. “抽取历史骨架”预计对应哪些表
从当前 Step 1 文案和 `PipelineService` 读取结构看，未来大概率会影响：
- `novel_timelines`
- `novel_characters`
- `novel_key_nodes`
- `novel_skeleton_topics`
- `novel_skeleton_topic_items`

其中：
- 时间线 / 人物 / 关键节点对应 Step 1 已有勾选项
- skeleton topics / items 对应骨架主题配置与抽取结果

### 2. “生成爆点”预计对应哪个表
大概率对应：
- `novel_explosions`

### 3. 这个新按钮从产品语义上更像什么
更像：
- **一个总入口按钮**

而不是：
- 单独属于 Step 1
- 或单独属于 Step 2

原因：
- 按钮文案就是“抽取历史骨架和生成爆点”
- 它天然是 Step 1 + Step 2 的组合执行
- 放在 Step 3 上方，也更像“进入世界观生成前的前置预处理入口”

---

## Step 6：最小改动建议

### 1. 最小改动文件清单
如果下一步只做“纯前端占位按钮”，最小只需要改：
- `apps/web/src/components/PipelinePanel.tsx`

如果还要把标题栏内风格做一致化，可能会顺手参考但不一定要改：
- `apps/web/src/components/pipeline/AdaptationStrategyToolbar.tsx`

如果未来真接后端：
- `apps/api/src/pipeline/pipeline.controller.ts`
- `apps/api/src/pipeline/pipeline.service.ts`

### 2. 最小插入位置结论
**最小插入位置就是 `PipelinePanel.tsx` 中 Step 2 卡片之后、Step 3 卡片之前，新增一个独立 sibling 操作区。**

### 3. 是否建议做成单独操作区，还是塞进 Step 3 标题栏
建议做成：
- **单独操作区**

不建议直接塞进 Step 3 标题栏。

原因：
- 用户要求的位置就是“Step 3 上方”
- 这个按钮语义是 Step 1 / Step 2 的组合执行入口
- 塞进 Step 3 标题栏会让它误看成 Step 3 内部操作

### 4. 下一步真正实现时，建议先做纯前端占位按钮还是前后端一起接通
建议先做：
- **纯前端占位按钮**

原因：
- 插入位置已经很明确
- 可以先把视觉布局和交互语义定住
- 再决定后端用 `pipeline` 模块接一个组合执行入口，避免 UI 与接口一起改时耦合过大

---

## 最终结论
- `Pipeline` 实际主组件：`apps/web/src/components/PipelinePanel.tsx`
- Step 3 标题栏内容实际在 `apps/web/src/components/pipeline/AdaptationStrategyToolbar.tsx`
- Step 3 上方当前没有专门容器，只有 Step 2 与 Step 3 两个 sibling 卡片间的布局间隔
- **最佳最小改动点**：在 `PipelinePanel.tsx` 中，Step 2 卡片之后、Step 3 卡片之前，新增一个独立操作区 `<div>`
- 当前后端**没有**现成“抽取历史骨架 / 生成爆点”组合接口；只有只读聚合和 skeleton topics CRUD，可作为后续实现的基础
