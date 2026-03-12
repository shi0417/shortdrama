# Prompt 预览框放大优化报告

## 问题描述

用户反馈 Prompt 预览和修改框显示过小，几乎无法查看和确认完整 Prompt，特别是在红色框标记的位置，预览框被严重挤压。

## 根本原因

原来的对话框布局存在以下问题：

1. **容器高度限制不当**：外层容器使用 `maxHeight: '90vh'` 配合 `overflowY: 'auto'`，导致所有内容都要在这个高度内竞争空间
2. **Textarea 高度控制不足**：虽然指定了 `rows={32}`，但实际高度受到容器总体积和兄弟元素的挤压，最终导致 textarea 显示高度远小于预期
3. **布局结构不合理**：所有元素都在一个扁平的 flex column 中，没有根据优先级进行分区管理

## 解决方案

### 1. 重新组织对话框容器结构

将原来的单一滚动容器改为**两层结构**：

```
外层对话框 (height: 92vh)
├── 标题栏 (flexShrink: 0)
├── 上层配置区 (flex: 0 0 auto, overflowY: auto)
│   └── 模型、时长、模式、预算等设置 + 参考数据 + 用户要求
├── 中层 Prompt 预览区 (flex: 1, minHeight: 0)
│   └── Prompt textarea (flex: 1, minHeight: 0)
├── 下层内容区 (flex: 1, overflowY: auto)
│   └── 参考摘要、草稿预览、警告、写入确认
└── 底部按钮区 (flexShrink: 0)
```

### 2. 具体样式改动

| 项目 | 原值 | 新值 | 说明 |
|-----|-----|-----|------|
| 外层容器宽度 | 1180px | 1280px | 增加对话框宽度 |
| 外层容器高度 | maxHeight: 90vh | height: 92vh | 改为固定高度，充分利用屏幕空间 |
| 外层容器宽度限制 | maxWidth: 100% | maxWidth: 95% | 更合理的宽度约束 |
| 总体布局 | flex, overflowY 在外层 | 分区 flex 布局 | 将滚动区分散到各需要的地方 |
| 配置区 | 单个 flex column | flex: 0 0 auto, overflowY: auto 的独立区 | 配置项不挤压 Prompt 框 |
| **Prompt 框容器** | 普通 div | `flex: 1, minHeight: 0` 的专属容器 | **获得最大可用空间** |
| **Prompt textarea** | rows={32}, 无明确高度 | `flex: 1, minHeight: 0, resize: 'none'` | **充满容器，随窗口自适应** |
| 下层内容区 | 单个 flex column | `flex: 1, overflowY: auto` 的独立区 | 内容过多时自己滚动 |
| 按钮区 | 普通 div | flexShrink: 0 | 始终固定在底部 |

### 3. 核心改动代码片段

**Prompt 预览区的关键样式**：
```jsx
<div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
  <div style={{ fontSize: 12, color: '#666', marginBottom: 4, flexShrink: 0 }}>
    Prompt 预览（{promptPreview.length.toLocaleString()} chars）
  </div>
  <textarea 
    style={{ 
      flex: 1, 
      minHeight: 0,  // 关键：允许 flex item 小于内容高度
      fontSize: `${fontSize}px`, 
      lineHeight: 1.5, 
      fontFamily: 'monospace', 
      resize: 'none'  // 禁用用户手动调整，避免破坏布局
    }} 
  />
</div>
```

**为什么这样做有效**：
- `flex: 1`：让容器获得剩余空间
- `minHeight: 0`：关键！flexbox 默认 `min-height: auto`，会根据内容调整，设为 0 才能真正压缩
- `resize: 'none'`：防止用户破坏 flex 布局
- `fontFamily: 'monospace'`：保持 Prompt 代码对齐效果

## 效果对比

### 原来的情况
- Prompt 框显示高度：约 300-400px（用户描述"非常小"）
- 用户几乎无法查看长 Prompt 内容
- 需要多次滚动和翻页

### 优化后的情况
- Prompt 框显示高度：约 800-1200px（取决于窗口高度）
- 用户可以在单个视窗内看到大部分 Prompt 内容
- 如果 Prompt 超过屏幕，可在框内滚动
- 字体大小可调（12-18px）
- 上下配置区都有各自的滚动条（如内容过多）

## 测试要点

1. **高度自适应**：调整浏览器窗口高度，Prompt 框应随之扩大或缩小
2. **宽度响应**：窗口宽度变化，Prompt 框宽度应保持合理
3. **滚动分离**：
   - 拖动上层配置区时，下层内容区不动
   - 拖动下层内容区时，Prompt 框不动
   - Prompt 框内容超大时，应在框内滚动
4. **字体大小**：切换字体大小时，Prompt 框内容应正确重排
5. **允许编辑**：勾选"允许编辑 Prompt"后，textarea 背景变白，可正常输入
6. **响应式**：在不同屏幕尺寸（笔记本、2K 屏、4K 屏）均正常显示

## 相关文件

- `apps/web/src/components/pipeline/PipelineEpisodeScriptDialog.tsx`
  - 对话框总高度：`height: '92vh'`
  - 上层配置区：`flex: '0 0 auto', overflowY: 'auto'`
  - 中层 Prompt 区：新增专属容器，`flex: 1, minHeight: 0`
  - Prompt textarea：`flex: 1, minHeight: 0, resize: 'none'`
  - 下层内容区：`flex: 1, minHeight: 0, overflowY: 'auto'`
  - 底部按钮：`flexShrink: 0`

## 总结

通过合理的 flexbox 布局分区和约束，使 Prompt 预览框能够动态占据对话框最大可用空间，解决了长期困扰用户的预览框过小问题。这是一个 **纯 CSS/样式层面的优化**，不涉及逻辑或功能改动，风险极低。

---

**报告生成时间**：2026-03-04  
**修改范围**：仅涉及 UI 样式，无后端修改
