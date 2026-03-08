# Pipeline Step3 前置操作区实现报告

## 修改文件清单
- `apps/web/src/components/PipelinePanel.tsx`

## 实现内容
本次仅完成前端占位版实现，未接后端接口，未改 `apps/api`，未改数据库结构。

在 `/projects -> Pipeline` 页面中，已新增一个独立操作区：
- 位置：`Step 2` 卡片之后、`Step 3` 卡片之前
- 结构：独立 sibling block
- 内容：
  - 标题：`预处理操作`
  - 说明：`在生成世界观前，先执行历史骨架抽取与爆点生成。`
  - 主按钮：`抽取历史骨架和生成爆点`

## 新操作区插入位置说明
本次改动严格放在 `PipelinePanel.tsx` 中：
- `Step 2` 卡片闭合 `</div>` 之后
- `Step 3` 卡片开始 `<div ...>` 之前

因此它不是：
- Step 3 标题栏的一部分
- AdaptationStrategyToolbar 内部按钮

而是：
- Step 2 和 Step 3 中间的独立操作区

## 按钮点击占位行为说明
当前按钮点击后会执行：

1. 控制台打印：
```ts
{
  action: 'extract_history_skeleton_and_generate_explosions',
  novelId,
  novelName
}
```

2. 弹出提示：
```text
抽取历史骨架和生成爆点：后端接口尚未接入
```

当前未接任何真实后端接口。

## 样式说明
操作区延续了 `PipelinePanel.tsx` 现有 inline style 风格：
- `border: 1px solid #e8e8e8`
- `borderRadius: 8px`
- `padding: 12px 16px`
- `background: #fff`

按钮样式复用了当前页面主按钮风格：
- 蓝底白字
- 4px 圆角
- 13px 字体

## Build 结果
已执行：

```bash
pnpm --dir apps/web build
```

结果：通过。

## 手动验证步骤
1. 打开 `/projects`
2. 选择任一 project
3. 切到 `Pipeline`
4. 确认 `Step 2` 和 `Step 3` 之间出现新的独立操作区
5. 确认按钮文案为：`抽取历史骨架和生成爆点`
6. 点击按钮，确认页面弹出提示：
   - `抽取历史骨架和生成爆点：后端接口尚未接入`
7. 打开浏览器控制台，确认打印：
   - `action`
   - `novelId`
   - `novelName`
8. 确认 `Step 3` 标题栏未被挤坏，现有功能未受影响

## 结论
- 新操作区已成功放在 `Step 2` 和 `Step 3` 之间
- 当前仅为前端占位按钮
- 当前未接后端
