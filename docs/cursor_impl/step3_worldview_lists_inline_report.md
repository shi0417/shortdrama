# Step3 worldview 列表行内重排报告

## 1) 修改文件清单

- `apps/web/src/components/PipelinePanel.tsx`

本次仅改前端 `apps/web`，未改 `apps/api`、未改数据库、未新增 migration、未改 API 结构。

## 2) 关键映射关系（moduleKey -> worldview）

在 `PipelinePanel` 新增 `getModuleRows(moduleKey)`：

- `set_core` -> `worldview.core`
- `set_payoff` -> `worldview.payoffArch`
- `set_opponent` -> `worldview.opponents`
- `set_power_ladder` -> `worldview.powerLadder`
- `set_traitor` -> `worldview.traitors`
- `set_story_phases` -> `worldview.storyPhases`
- default -> `[]`

并在 `modules.map((item) => ...)` 内每个模块卡片后渲染：

- `renderSimpleTable(getModuleRows(item.key))`

## 3) 已删除底部统一列表说明

已删除 Step3 区块中 `modules.map` 后方原有的 6 组统一列表（核心设定/爽点架构/对手矩阵/权力阶梯/内鬼系统/故事阶段），避免与行内列表重复。

## 4) set_core 模块顺序确认

`set_core` 的最终顺序符合要求：

1. 模块行
2. `SetCoreEditor`（条件：`expandedEditors.set_core === true`）
3. `worldview.core` 数据列表（行内）

其它 5 个模块为：

- 模块行 -> 对应数据列表（行内）

## 5) 样式说明

每个模块行下方数据区采用：

- `marginTop: 8px`
- `paddingLeft: 12px`
- `borderLeft: '2px solid #f0f0f0'`

以保持现有 inline style 风格，并形成“该模块内容区”的视觉层级。

## 6) build 结果

执行命令：

```bash
pnpm --dir apps/web build
```

结果：通过（exit code 0）。

## 7) 手动验证步骤

1. 打开 `/projects`
2. 进入 `Pipeline`
3. 展开 Step3
4. 检查 6 个模块下方分别展示对应 `worldview` 列表
5. 确认页面底部不再有统一重复列表
6. 在 `set_core` 行点击【编辑】验证 `SetCoreEditor` 仍可展开/收起
