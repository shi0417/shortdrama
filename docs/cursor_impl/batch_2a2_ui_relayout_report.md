# Batch 2A-2 UI Relayout 报告

## 1) 修改文件

- `apps/web/src/components/PipelinePanel.tsx`

> 本次仅做 UI 位置调整，未改接口、未改组件逻辑、未改样式体系。

---

## 2) 移动前后位置说明

### 移动前

- `SkeletonTopicsPanel` 位于 Step1 下半区“骨架分析主题管理”块（靠近时间线/人物/关键节点列表之后）。
- 红框入口区仍是静态 checkbox 风格入口，主题管理与入口分离。

### 移动后

- 在 Step1 入口区（checkbox 组）中，“关键历史节点”下方新增：
  - 标题：`骨架分析主题（可配置）`
  - 渲染：`<SkeletonTopicsPanel novelId={novelId} />`
  - 通过 `marginLeft/padding` 保持与入口区同组视觉。
- 原下方位置不再重复渲染 `SkeletonTopicsPanel`，改为提示文案：
  - 标题：`骨架主题抽取结果（Topic Items）`
  - 提示：请在上方管理区使用 Expand Items 查看。

---

## 3) 验证步骤

1. 打开 `/projects`
2. 选择任一项目，切换到 `Pipeline -> Step1`
3. 确认：
   - 骨架分析主题管理区出现在 Step1 入口区（关键历史节点下方）
   - 原下方位置不再重复出现管理区
4. 在上方管理区继续验证功能可用：
   - 新增主题
   - 编辑主题
   - 删除主题
   - Expand Items
5. 构建验证：

```bash
pnpm --dir apps/web build
```

结果：通过。

---

本次仅进行了前端 UI 位置迁移，不涉及后端、数据库、migration、接口协议变更。
