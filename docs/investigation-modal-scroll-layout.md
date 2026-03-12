# 生成每集纲要和每集剧本弹窗：滚动与布局现状调查报告

## 1. 调查范围

- 前端页面入口与触发链路：`apps/web/src/app/projects/page.tsx`、`apps/web/src/components/ProjectDetail.tsx`、`apps/web/src/components/PipelinePanel.tsx`
- 弹窗主体：`apps/web/src/components/pipeline/PipelineEpisodeScriptDialog.tsx`
- 与该弹窗直接关联的类型/API/后端 DTO：
  - `apps/web/src/types/pipeline.ts`
  - `apps/web/src/lib/pipeline-episode-script-api.ts`
  - `apps/api/src/pipeline/dto/pipeline-episode-script.dto.ts`
  - `apps/api/src/pipeline/pipeline.controller.ts`
- 对照性检查（同项目其它弹窗形态，确认是否有统一 Dialog 组件）：`apps/web/src/components/pipeline/*.tsx`

## 2. 相关文件与职责

- `apps/web/src/app/projects/page.tsx`
  - 项目页容器，右侧详情区有 `overflowY: 'auto'`。
  - 通过 `ProjectDetail` 进入 Pipeline 面板。
- `apps/web/src/components/ProjectDetail.tsx`
  - 在 `activeTab === 'pipeline'` 时渲染 `PipelinePanel`。
  - 传入 `novelId`、`novelName`、`totalChapters`。
- `apps/web/src/components/PipelinePanel.tsx`
  - “生成每集纲要和每集剧本”按钮位于“预处理操作”按钮组。
  - 点击触发 `handleOpenEpisodeScriptDialog()`，并在末尾渲染 `PipelineEpisodeScriptDialog`。
  - 持有该弹窗所有状态：模型、模式、Prompt、草稿、警告、写入动作等。
- `apps/web/src/components/pipeline/PipelineEpisodeScriptDialog.tsx`
  - 弹窗全部 DOM 与样式在此内联定义，无外部样式类。
  - 渲染结构包含：标题栏、参数区、Prompt 区、参考摘要/草稿/警告区、底部按钮区。
- `apps/web/src/types/pipeline.ts`
  - 该弹窗前端请求与响应类型定义（request/preview/generate/persist）。
- `apps/web/src/lib/pipeline-episode-script-api.ts`
  - 调用后端三接口：preview / generate / persist。
- `apps/api/src/pipeline/dto/pipeline-episode-script.dto.ts`
  - 后端 DTO 和参数约束（不涉布局，但是功能上下文）。
- `apps/api/src/pipeline/pipeline.controller.ts`
  - 路由挂载位置（不涉布局）。

## 3. 当前组件/DOM 结构

基于 `PipelineEpisodeScriptDialog` 的真实结构，简化层级如下：

- Modal Overlay（自研，`div`，`position: fixed; inset: 0`）
  - Dialog Panel（自研，`div`，`display: flex; flex-direction: column; height: 92vh`）
    - 顶部标题行（含“关闭”按钮，`flexShrink: 0`）
    - 参数区容器（`overflowY: auto; flex: 0 0 auto`）
      - 模型/时长/模式/预算（grid）
      - 参考数据多选（grid）
      - 用户附加要求（textarea）
      - Prompt 控制行（允许编辑、字号、刷新按钮）
    - Prompt 预览区（`display: flex; flex: 1; minHeight: 0`）
      - Prompt 标题
      - Prompt textarea（`flex: 1; minHeight: 0; resize: none`）
    - 下方信息区（`overflowY: auto; flex: 1; minHeight: 0`）
      - 参考摘要
      - 草稿预览
      - warning 列表
      - 写入前确认区
    - Footer 按钮区（取消 / 生成草稿 / 确认写入，`flexShrink: 0`）

结论：
- 当前**不是**“header/body/footer 三段式 + 单 body 滚动”；
- 而是“参数区 + Prompt 区 + 下方信息区”三段并列，每段分别分配空间/滚动。

## 4. 当前滚动行为分析

当前滚动链路存在多重滚动源：

1. 参数区滚动：`overflowY: auto`（参数多时可滚）
2. Prompt 文本区滚动：textarea 原生滚动（内容超出时滚）
3. 下方信息区滚动：`overflowY: auto`（摘要/草稿/警告多时滚）
4. 页面级滚动（背景）：`projects/page.tsx` 右栏本身也有 `overflowY: auto`

这意味着用户在弹窗内会遇到“不同区域各自滚动”的体验，而不是统一右侧主滚动条。

对你的目标（footer 固定 + footer 上方统一滚动容器）来说，当前结构与目标存在直接偏差：

- footer 固定：**当前可认为已基本固定**（`flexShrink: 0`）
- footer 上方统一滚动：**当前不满足**（存在多层可滚区域）

## 5. 当前高度与布局约束分析

关键高度/布局约束来自 `PipelineEpisodeScriptDialog.tsx` 内联样式：

- Overlay：`position: fixed; inset: 0; padding: 16`
- Dialog Panel：
  - `width: 1280`
  - `maxWidth: '95%'`
  - `height: '92vh'`（固定视口比例高度）
  - `display: 'flex'; flexDirection: 'column'; gap: 12`
- 顶部和 footer：`flexShrink: 0`
- 参数区：`overflowY: 'auto'; flex: '0 0 auto'`
- Prompt 区：`flex: 1; minHeight: 0`
- Prompt textarea：`flex: 1; minHeight: 0; resize: 'none'`
- 下方信息区：`overflowY: 'auto'; flex: 1; minHeight: 0`

附加说明：
- 样式来源是**纯 React 内联 style**，无 Tailwind class、无 CSS/SCSS、无 styled-components。
- Modal 也是**自研 div 结构**，未使用 Radix/shadcn/MUI/Antd 的 Dialog/Modal 组件。

## 6. 问题根因定位

### 6.1 “显示区域太小”根因

- 根因 A：`height: 92vh` 之内，内容被拆成多个并列区块竞争空间。
- 根因 B：Prompt 区与下方信息区都设置 `flex: 1`，在可用空间里大致平分高度；当上方参数区内容较多时，Prompt 实际可视高度会进一步被压缩。
- 根因 C：参数区不是统一内容流的一部分，而是独立区块，增加了总体纵向占用。

### 6.2 “多重滚动”根因

- 根因 D：参数区节点设置 `overflowY: auto`。
- 根因 E：下方信息区节点设置 `overflowY: auto`。
- 根因 F：Prompt 使用 textarea（天然滚动容器），其滚动与外层滚动并存。
- 根因 G：页面右侧本身有外层滚动，可能出现背景滚动与弹窗滚动共存（需实际交互确认是否锁背景滚动）。

### 6.3 与目标模型冲突点

- 目标要求“footer 上面全部内容放进一个统一纵向滚动容器”，而当前是三块分段（参数区 / Prompt / 信息区）并行，无法形成“单一主滚动条”。

## 7. 可改造性评估

总体评估：**可在不改接口、不改业务逻辑的前提下完成**，主要是布局重组，风险中低。

- 可行性
  - 该弹窗业务逻辑与布局耦合较弱（状态多、样式内联），可仅改 DOM 层级和 style。
  - API、DTO、按钮行为可保持不变。
- 是否可拆成“可滚动内容区 + 固定 footer”
  - 可以，且当前 footer 已是独立节点，改造门槛低。
- Prompt/参考摘要是否可取消内部主要竖向滚动
  - 参考摘要可完全依赖外层统一滚动。
  - Prompt 若保持 textarea，原生滚动仍会存在；但可通过高度策略减少其“主滚动”角色。
- 参数区后续可折叠性
  - 结构上适合增加“参数折叠/展开”wrapper，风险低（本次仅评估，不实现）。

潜在风险：

- 小屏适配：92vh 下内容密集，单列滚动要防止按钮被遮挡。
- 长文本性能：一个统一滚动容器内节点过多时重排压力上升（一般可接受）。
- 父级 overflow 与 sticky 兼容：若后续改 `position: sticky` 固定 footer，需确保父容器滚动语义正确。
- 按钮遮挡内容：若 footer 覆盖式固定，需要给内容区底部留 padding。
- textarea 特性：textarea 即使外层统一滚动，也可能在聚焦输入时产生局部滚动感。
- 横向滚动：长行文本可能触发横向滚动/软换行体验变化，需设计明确策略。

## 8. 推荐改造方案对比

### 方案 A（最小改动，推荐优先）

- 目标：保持现有组件与业务逻辑，仅重构容器层级为“单内容滚动 + 固定 footer”。
- 涉及文件：
  - `apps/web/src/components/pipeline/PipelineEpisodeScriptDialog.tsx`
- 改造思路：
  - 新增一个统一 `contentScroll` wrapper（放置标题、参数、Prompt、参考摘要、草稿、warning、写入前确认）。
  - footer 保持独立 sibling，`flexShrink: 0`。
  - 去掉参数区与下方信息区的 `overflowY: auto`。
  - Prompt textarea 不再承担大块高度分配（取消 `flex: 1` 语义），改为更可控的 `minHeight`/`rows`，让外层滚动为主。
- 风险：
  - 输入长 Prompt 时 textarea 仍有内滚，但显著减弱多重滚动冲突。

### 方案 B（结构更清晰）

- 目标：显式三段式布局 `Header(非固定) + ScrollBody + Footer(固定)`。
- 涉及文件：
  - `apps/web/src/components/pipeline/PipelineEpisodeScriptDialog.tsx`
- 改造思路：
  - 将标题并入 `ScrollBody` 顶部（符合“header 不固定”的需求）。
  - `ScrollBody` 作为唯一纵向滚动容器。
  - footer 单独保留在最底。
- 风险：
  - 需要较多调整现有节点顺序，回归成本略高于方案 A。

### 方案 C（可维护性最好，但改动稍大）

- 目标：抽象公共弹窗骨架，统一全项目 Pipeline 弹窗滚动策略。
- 涉及文件：
  - 新增公共容器（例如 `apps/web/src/components/pipeline/PipelineModalScaffold.tsx`）
  - 改造 `PipelineEpisodeScriptDialog.tsx`（以及可能的 `PipelineWorldviewDialog.tsx` 等）
- 改造思路：
  - 建立统一 modal shell（overlay/panel/content/footer 规范化）。
  - 业务区域通过 slots 渲染。
- 风险：
  - 触及范围扩大，不符合“低风险快速收口”的当前诉求。

## 9. 最推荐的实施路径

推荐：**方案 A（最小改动）**。

原因：

- 只动一个文件，风险最低；
- 不触碰请求参数/接口/业务逻辑/按钮行为；
- 能直接满足“footer 固定 + footer 上方统一纵向滚动容器”目标；
- 回归验证成本可控，适合先快速达成可用性目标。

建议的最小改造动作（后续实现时）：

1. 保留外层 panel `height: 92vh` + `flex-column`。
2. 将标题、参数、Prompt、摘要、草稿、warning、确认区全部放入一个 `overflowY: auto` 内容容器。
3. footer 保持独立底部节点，不参与滚动。
4. 删除参数区和下方信息区的独立 `overflowY`，避免多重滚动。
5. Prompt 区改为固定较大最小高度（而非 `flex:1` 与其它区平分），降低“显示太小”概率。

## 10. 实施前注意事项

- 待确认项 1：是否需要在弹窗打开时锁定背景页面滚动（当前代码未显式锁定）。
- 待确认项 2：Prompt 编辑场景下，是否接受 textarea 局部滚动保留（通常不可完全避免）。
- 待确认项 3：超小屏（如 768px 高度以下）下 footer 与内容区最小可见策略（是否要进一步降密度/折叠参数区）。
- 待确认项 4：是否要同步统一其它 Pipeline 弹窗滚动策略（当前多个弹窗实现风格相近，但本次可先只改该弹窗）。
- 验证重点（实施时）：
  - 只出现一根主纵向滚动条（footer 上方内容区）；
  - footer 始终可见；
  - Prompt 与参考摘要可视高度明显提升；
  - 不影响“刷新 Prompt / 生成草稿 / 确认写入”行为。

