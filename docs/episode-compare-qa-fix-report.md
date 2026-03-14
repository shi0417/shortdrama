# Episode Compare QA / Fix Report

## 1. QA 结论总览

| 高风险项 | 结论 |
|----------|------|
| A. `novel_hook_rhythm` migration 与代码字段一致性 | **已正确** |
| B. `structure-templates` 的 `novels_id` 全链路兼容 | **已正确** |
| C. Compare 空块新建时 novelId + episodeKey 预填 | **已修复**（补全 structure-templates 必填默认值 + 统一空块 CTA 文案） |
| D. 编辑/删除/新建后当前行立即刷新 | **已正确** |
| E. Compare 与普通 pipeline 的 localStorage key 隔离 | **已正确** |
| F. 缺失块/单块/删除后空态渲染稳健性 | **已修复**（有数据但未选列时显示 "No columns selected"） |
| G. 资源命名统一性（无旧命名残留） | **已正确** |

---

## 2. Migration & Schema Consistency Check

### 2.1 SQL migration

- **文件**: `apps/api/sql/20260313_create_novel_hook_rhythm.sql`
- **表名**: `novel_hook_rhythm` ✓
- **外键**: `novel_id` → `drama_novels(id)` ✓
- **字段**: `id`, `novel_id`, `episode_number`, `emotion_level`, `hook_type`, `description`, `cliffhanger`, `created_at` ✓

### 2.2 后端资源配置

- **文件**: `apps/api/src/pipeline/pipeline-resource.service.ts` — `RESOURCE_CONFIG['hook-rhythms']`
- `tableName`: `novel_hook_rhythm` ✓
- `selectableFields` / `editableFields` / `numericFields` / `orderBy` 与上表一致 ✓

### 2.3 Compare 聚合接口

- **文件**: `apps/api/src/pipeline/episode-compare.service.ts`
- `queryHookRhythmIfExists` 查询字段与表结构一致 ✓
- 表不存在时 fallback 为 `[]`，安全 ✓

### 2.4 前端字段配置

- **文件**: `apps/web/src/types/pipeline-resource.ts` — `hook-rhythms` 的 `fields`
- 未引用不存在的数据库字段 ✓

**结论**: 无需修改。

---

## 3. `novels_id` Compatibility Check

### 3.1 后端 listByNovel

- `PipelineResourceService.listByNovel()` 使用 `getNovelIdColumn(config)` 作为过滤列。
- `structure-templates` 的 `novelIdColumn: 'novels_id'`，过滤条件为 `novels_id = ?` ✓

### 3.2 后端 create

- `create()` 中 `columns = [novelIdColumn, ...Object.keys(normalized)]`，`values = [novelId, ...]`。
- 对 `structure-templates` 写入列为 `novels_id`，值来自参数 `novelId` ✓

### 3.3 后端 update / ownership

- `update()` 通过 `getRowById` 取现有行，再用 `existing[novelIdColumn]` 取归属 ID，`structure-templates` 正确使用 `novels_id` ✓

### 3.4 Compare 弹窗新建/编辑

- `EpisodeCompareDetailDialog.buildCreateSeed('structure-templates')` 使用 `novels_id: novelId`、`chapter_id: episodeKey` ✓
- 编辑后通过 `onChanged` 触发 `loadData`，重新拉取 compare 数据 ✓

**结论**: 全链路已兼容 `novels_id`，无需修改。

---

## 4. Compare Create Prefill Check

### 4.1 三类资源预填

| 资源 | 预填字段 | 状态 |
|------|----------|------|
| episodes | `novel_id`, `episode_number`, `sort_order` | 已正确 |
| structure-templates | `novels_id`, `chapter_id`, `power_level`, `is_power_up_chapter`, `hot_level` | 已正确；本轮补充 `theme_type`, `structure_name` 默认空串，避免必填字段缺失 |
| hook-rhythms | `novel_id`, `episode_number`, `emotion_level` | 已正确 |

### 4.2 本轮修补

- 在 `buildCreateSeed('structure-templates')` 中增加 `theme_type: ''`、`structure_name: ''`，保证创建时 DB/表单不因必填缺省报错。
- 空块 CTA 文案统一为：
  - `Create episode record`
  - `Create structure template`
  - `Create hook rhythm`

**结论**: 预填与提交 payload 正确；新建成功后由 `onChanged` → `loadData` 刷新当前行，无需整页刷新。

---

## 5. Compare Refresh Behavior Check

### 5.1 机制

- `EpisodeCompareDetailDialog` 在 `onSubmit`（新建/编辑）和 `onDelete` 成功后均调用 `onChanged()`。
- Workbench 将 `onChanged={loadData}` 传入 DetailDialog，`loadData` 重新请求 `episodeCompareApi.getByNovel(novelId)` 并 `setRows(...)`。

### 5.2 行为确认

- 编辑已有块 → 关闭弹窗后主列表自动刷新 ✓
- 删除已有块 → 该块即时变为空态（No data）✓
- 从空块新建 → 该块即时出现新记录 ✓
- 刷新后仍停留在当前 novelId 与 compare 上下文 ✓

**结论**: 无需修改。

---

## 6. localStorage Key Isolation Check

### 6.1 Compare 使用

- **文件**: `apps/web/src/components/episode-compare/episode-compare-storage.ts`
- Key 格式: `episode-compare-columns:${scope}:${resource}:novel:${novelId}`
- `scope` 为 `panel` 或 `page`，由 `useEpisodeCompareColumns(novelId, scope)` 传入。

### 6.2 普通 pipeline 使用

- **文件**: `apps/web/src/types/pipeline-resource.ts` — `getPipelineColumnStorageKey(resource, novelId, scope)`
- Key 格式: `pipeline-columns:${scope}:${resource}:novel:${novelId}`
- `scope` 为 `section` 或 `page`。

### 6.3 结论

- Compare 仅使用 `episode-compare-columns:*`，普通资源页仅使用 `pipeline-columns:*`，二者隔离 ✓
- Compare 的 panel 与 page 通过 `scope` 区分，互不污染 ✓

**结论**: 无需修改。

---

## 7. Missing Block / Empty State Robustness Check

### 7.1 场景覆盖

- 仅 episode 有数据、另两块 null：行正常，两卡为 "No data" ✓
- 仅 structureTemplate / 仅 hookRhythm 有数据：同上 ✓
- 三块都有数据：正常展示 ✓
- 删除一块后：该卡变为 "No data"，可点击进入新建 ✓

### 7.2 本轮修补

- **EpisodeCompareColumnCard**: 当 `hasData === true` 且 `visibleKeys` 为空（即未选列）时，显示 "No columns selected"，避免有数据却无任何展示的空白态。
- 对 `row` 为 `null` / 缺失的防护已存在（`!hasData` 显示 "No data"；`row?.[field.key]` 安全访问）。

**结论**: 空态与单块/缺失块渲染稳健，已做上述小增强。

---

## 8. Resource Naming Consistency Check

### 8.1 约定

- 前端资源 key / routeSegment / compare 标识 / localStorage / toolbar 统一使用：
  - `episodes`
  - `structure-templates`
  - `hook-rhythms`
- 数据库表名（`novel_episodes`, `drama_structure_template`, `novel_hook_rhythm`）仅出现在后端配置与 SQL 中。

### 8.2 核查结果

- 前端路由、类型、compare 组件、storage key 均使用上述三个 resource 名 ✓
- `EpisodeCompareDetailDialog` 中的 `section.label` 使用表名仅作展示（novel_episodes / drama_structure_template / novel_hook_rhythm），不参与 key 或路由 ✓

**结论**: 无旧命名残留，无需修改。

---

## 9. 修改文件清单

| 文件 | 修改内容 |
|------|----------|
| `apps/web/src/components/episode-compare/EpisodeCompareDetailDialog.tsx` | ① structure-templates 的 `buildCreateSeed` 增加 `theme_type`、`structure_name` 默认值；② 空块按钮文案统一为 Create episode record / Create structure template / Create hook rhythm；③ 删除确认文案增加资源名与集号（Episode X）；④ 弹窗标题增加「正在操作: ${editing.resource}」 |
| `apps/web/src/components/episode-compare/EpisodeCompareColumnCard.tsx` | 有数据但未选列时显示 "No columns selected" |

---

## 10. 手工验证清单

1. **Compare 入口**
   - 从 ProjectDetail Tab「Episode Compare」打开 panel，再点「Open Full Compare Page」进入独立页；两处列显示配置应独立（修改 panel 列不影响 page，反之亦然）。

2. **空块新建预填**
   - 选一行，点详情；对无数据的块分别点「Create episode record」「Create structure template」「Create hook rhythm」，确认表单中 novel/集号（或 chapter_id）已预填且提交后归属正确；structure-templates 新建不因 theme_type/structure_name 缺省报错。

3. **刷新**
   - 在同一行：新建一条 → 关闭弹窗后该块立刻出现新记录；编辑一条 → 关闭后列表更新；删除一条 → 该块立刻变为 "No data"。无需整页刷新。

4. **空态与列显示**
   - 某行仅一块有数据、另两块空：两空块显示 "No data"，可点击新建。
   - 工具栏将某资源的列清空：对应卡片显示 "No columns selected"（有数据时）。

5. **删除确认**
   - 在详情弹窗中删除一条记录，确认提示中出现资源名与集号（Episode X）。

6. **普通 pipeline 页**
   - 打开任意 pipeline 资源 section/page，调整列显示；再打开 Compare（panel 或 page），确认 Compare 的列配置与普通页互不影响（localStorage 隔离）。

---

## 11. Remaining Known Limits

- 表名在 Compare 详情弹窗中仍以 `section.label`（novel_episodes / drama_structure_template / novel_hook_rhythm）展示，仅用于说明，不影响资源 key 与接口。
- `hook-rhythms` 依赖表 `novel_hook_rhythm` 存在；若未执行 migration，compare 聚合接口会安全地返回该块为 null，前端已能处理。
- 本期未改动 Compare 架构或通用 pipeline 列表/编辑逻辑，仅做 QA 与定点修补及上述小增强。
