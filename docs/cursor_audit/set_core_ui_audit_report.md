# set_core UI 只读审计报告（Step3 核心设定编辑器）

## Step 0：基线（审计前）

- `git status --short`
  - 输出为空（工作区干净）
- `git diff --stat`
  - 输出为空（无已跟踪文件差异）

补充核对：

- `git status` 显示：`nothing to commit, working tree clean`

---

## Step 1：全仓库定位 set_core 前端实现

### 1.1 关键词命中（核心结论）

- `set_core`
  - 前端命中：`apps/web/src/components/PipelinePanel.tsx`（Step3 modules 中 `key: 'set_core'`）
  - 后端命中：`apps/api/src/pipeline/pipeline.service.ts`（overview 读取 `set_core`）
  - SQL 命中：`apps/api/sql/20260303_create_set_core_and_payoff_tables.sql`
- `核心设定`
  - 主要命中：`apps/web/src/components/PipelinePanel.tsx` 两处：
    - Step3 数据展示区表格标题（`worldview.core`）
    - 页面底部大块编辑器标题（红框区域）
- `insert_novel_characters`
  - 仅命中：`apps/web/src/components/PipelinePanel.tsx`（`handleInsertCharacters` 内 `console.log`）
- `power_up_interval`
  - 未发现与 `PipelinePanel`/set_core 编辑器联动代码
  - 命中 `drama_novel.entity.ts` 字段定义（小说实体字段）

### 1.2 定位结果（关键文件）

- `apps/web/src/components/PipelinePanel.tsx`
  - Step3 modules 数组：定义 `set_core / set_payoff / ...`
  - `handleModuleAction`：仅 `console.log({ module, action, novelId, novelName })`
  - 红框 set_core 编辑器：**内联 JSX**，不是独立组件
- 未检索到独立组件名（如 `CoreSettingPanel` / `SetCoreEditor`）

结论：当前 set_core 编辑器为 `PipelinePanel.tsx` 内嵌静态块，未组件化。

---

## Step 2：UI 渲染结构与状态梳理

### 2.1 红框编辑器为何在页面底部

`PipelinePanel` 渲染结构是：

1. Step1 容器
2. Step2 容器
3. Step3 容器（header + `step3Expanded && modules.map + worldview tables`）
4. **独立的“核心设定编辑器”容器（红框）**
5. 底部确认开关容器

也就是说红框编辑器并不在 Step3 容器内部，而是在 Step3 容器之后固定渲染，所以视觉上出现在页面更靠下位置。

### 2.2 与 modules 列表的层级关系

- 红框编辑器与 Step3 容器是**同级节点**
- 它不是 `modules.map` 的子节点，也不是 map 循环后紧贴某一行的展开区
- 因此不会“跟随 set_core 行展开/折叠”

### 2.3 状态机制是否支持“按模块展开”

当前不存在以下状态：

- `activeModuleKey`
- `selectedModuleKey`
- `expandedEditors`
- `editingModuleKey`

现有状态只有：

- `step3Expanded`（控制整个 Step3 区块展开）
- `coreSettingText` / `coreFields`（红框编辑器本地输入状态）

所以红框编辑器显示逻辑与模块行完全解耦：它总是渲染（不受 `step3Expanded` 控制）。

### 2.4 模块按钮与红框编辑器是否联动

- Step3 行内按钮（生成/编辑/保存）调用 `handleModuleAction`，仅 `console.log`
- 不读写 `coreSettingText/coreFields`
- 不切换任何“当前模块”状态

结论：模块按钮和红框编辑器**完全无关**。

---

## Step 3：前端 API / 数据流审计

### 3.1 set_core 专用接口是否存在

- `apps/web/src/lib/api.ts` 中无 `set_core` 专用 GET/POST/PATCH/DELETE
- Step3 的核心设定数据来源是 `api.getPipelineOverview(novelId)` 返回的 `worldview.core`（只读展示）
- 红框编辑器的数据来源是本地 state（`coreSettingText` + `coreFields`），不是后端回填

### 3.2 相关 endpoint 清单（前端调用）

与 Step3 相关：

- `GET /pipeline/:novelId/overview`
  - 调用点：`apps/web/src/components/PipelinePanel.tsx` -> `useEffect(loadOverview)`
  - 用途：渲染 `worldview.core/payoffArch/opponents/powerLadder/traitors/storyPhases` 表格

与策略工具栏相关：

- `GET /adaptation-modes`
- `GET /novels/:novelId/adaptation-strategies`
- `POST /novels/:novelId/adaptation-strategies`
- `PATCH /adaptation-strategies/:id`
- `DELETE /adaptation-strategies/:id`
  - 调用点：`apps/web/src/components/pipeline/AdaptationStrategyToolbar.tsx`

结论：红框 set_core 编辑器目前无持久化 API，仅本地输入与 `console.log`。

---

## Step 4：后端现状审计（只读）

### 4.1 set_core 是否已有 controller/service/写接口

- 在 `apps/api/src` 中：
  - 未发现独立 `set_core` controller/service 模块
  - 未发现 set_core 专用写接口（POST/PATCH/DELETE）

### 4.2 是否由 pipeline overview 返回

- `apps/api/src/pipeline/pipeline.service.ts`
  - `getOverview()` 通过 `selectByNovel('set_core', 'sc', novelId)` 读取
  - 填充到 `worldview.core`
- `GET /pipeline/:novelId/overview` 由 `pipeline.controller.ts` 暴露

### 4.3 adaptation 与 set_core 的关系

- 当前 `adaptation` 模块提供策略 CRUD 与 mode 字典
- 未见 set_core 与 strategy 的直接关联读写逻辑（后端无 `strategy_id` 绑定写入 set_core 的接口）

---

## Step 5：数据库只读核对（set_core）

执行 SQL：

- `SHOW CREATE TABLE set_core;`
- `SHOW INDEX FROM set_core;`
- `SELECT COUNT(*) FROM set_core;`
- `information_schema.COLUMNS` / `TABLES` 查询

结果摘要：

- 表存在：`set_core`
- 行数：`0`
- 主键：`id`
- 关键字段：
  - `novel_id`（FK -> `drama_novels.id`）
  - `title`
  - `core_text`
  - `protagonist_name`
  - `protagonist_identity`
  - `target_story`
  - `rewrite_goal`
  - `constraint_text`
  - `version`
  - `is_active`
  - `created_at`
  - `updated_at`
- 索引：
  - `idx_set_core_novel (novel_id)`
  - `idx_set_core_active (novel_id, is_active)`
- 外键：
  - `fk_set_core_novel` -> `drama_novels(id)`（CASCADE/CASCADE）

补充判断：

- 表中无 `strategy_id` 字段
- 虽有 `version` 字段，但当前前后端未建立“当前策略版本 -> set_core 写入版本”的联动逻辑

---

## Step 6：结论与“挪到绿色框”最小改动建议（仅建议）

### 6.1 根因（为什么红框在底部）

根因是**代码结构**：

- 红框编辑器是 `PipelinePanel.tsx` 中 Step3 容器后的独立同级块
- 没有模块级选中/展开状态
- 所以它既不会嵌入 `set_core` 行，也不会跟随 Step3 的模块按钮行为

### 6.2 最小切入点（文件/JSX）

- 文件：`apps/web/src/components/PipelinePanel.tsx`
- 切入点：
  1. Step3 `modules.map` 渲染块（每个 module card）
  2. 当前底部红框编辑器块（应抽离并迁移）

### 6.3 建议新增状态

- `activeModuleKey: string | null`（例如点击某行“编辑”时设为 `set_core`）
- 或 `expandedEditors: Record<string, boolean>`（按模块行展开）

最小版本建议：

- 仅给 `set_core` 增加 `isSetCoreEditorOpen`（布尔）也可达成目标
- 但若未来六模块都要内嵌编辑器，建议直接使用 `expandedEditors`

### 6.4 建议复用/抽离组件

- 把当前红框编辑器内联 JSX 抽成：
  - `<SetCoreEditor />`
- 先保持 props 最小化：
  - `value` / `fields` / `onChange` / `onInsertCharacters` / `onGenerate`
- 在 `modules.map` 中当 `item.key === 'set_core' && expanded` 时渲染该组件作为“模块行下方展开区”

### 6.5 风险点

- 布局与滚动：编辑器体积大，插入行内后会拉长 Step3 区域，需要注意滚动体验
- 重复渲染：若保留底部旧块且新增行内块，会出现两个编辑器（需避免）
- 状态冲突：`step3Expanded`（全局）与模块级展开状态需明确优先级
- 后续联动：当前编辑器仍是本地状态，迁移位置不等于完成持久化

---

## Step 7：基线（审计后）

- `git status --short`
  - `?? docs/cursor_audit/set_core_ui_audit_report.md`
- `git diff --stat`
  - 输出为空（该命令默认不统计未跟踪文件）

说明：

- 本次为只读审计，**未修改任何业务代码、未写库、未做 migration/ALTER、未提交 commit**。
