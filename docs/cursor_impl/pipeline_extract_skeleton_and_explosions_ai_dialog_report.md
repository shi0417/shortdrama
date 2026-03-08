# Pipeline 抽取历史骨架和生成爆点 AI 弹窗实现报告

## 1. 修改/新增文件清单

### 后端
- `apps/api/src/pipeline/pipeline.controller.ts`
- `apps/api/src/pipeline/pipeline.module.ts`
- `apps/api/src/pipeline/dto/pipeline-extract.dto.ts`
- `apps/api/src/pipeline/pipeline-extract.service.ts`

### 前端
- `apps/web/src/components/PipelinePanel.tsx`
- `apps/web/src/components/pipeline/PipelineExtractDialog.tsx`
- `apps/web/src/components/pipeline/SkeletonTopicsPanel.tsx`
- `apps/web/src/lib/pipeline-ai-api.ts`
- `apps/web/src/types/pipeline.ts`

## 2. 新增接口清单

### `POST /pipeline/:novelId/extract-preview-prompt`
- 认证：`JwtAuthGuard`
- 作用：
  - 读取选中的参考表
  - 额外读取启用中的 `novel_skeleton_topics`
  - 构造 prompt
  - 返回 `promptPreview / usedModelKey / referenceTables`

### `POST /pipeline/:novelId/extract-and-generate`
- 认证：`JwtAuthGuard`
- 作用：
  - 调外部 AI
  - 解析统一 JSON schema
  - 做基础校验与清洗
  - 单事务覆盖写入 5 张目标表
  - 返回写入 summary 与 warnings

## 3. AI 返回 Schema

本次后端按固定 schema 实现，未擅自扩展：

```json
{
  "timelines": [
    {
      "timeNode": "字符串",
      "event": "字符串"
    }
  ],
  "characters": [
    {
      "name": "字符串",
      "faction": "字符串",
      "description": "字符串",
      "personality": "字符串",
      "settingWords": "字符串"
    }
  ],
  "keyNodes": [
    {
      "category": "字符串",
      "title": "字符串",
      "description": "字符串",
      "timelineRef": "字符串，可选"
    }
  ],
  "skeletonTopicItems": [
    {
      "topicKey": "必须对应已存在的 novel_skeleton_topics.topic_key",
      "items": [
        {
          "itemTitle": "字符串，可为空",
          "content": "字符串，可为空",
          "contentJson": null,
          "sourceRef": "字符串，可为空"
        }
      ]
    }
  ],
  "explosions": [
    {
      "explosionType": "字符串",
      "title": "字符串",
      "subtitle": "字符串",
      "sceneRestoration": "字符串",
      "dramaticQuality": "字符串",
      "adaptability": "字符串",
      "timelineRef": "字符串，可选"
    }
  ]
}
```

关键约束：
- 不写 `novel_skeleton_topics`
- 只读取 `novel_skeleton_topics`
- `skeletonTopicItems[].topicKey` 必须映射到现有 topic
- 不允许 AI 返回数据库 id

## 4. Prompt 设计摘要

本次 prompt 分 4 大块：

### 参考表输入
- `drama_novels`
- `drama_source_text`
- `novel_adaptation_strategy`
- `adaptation_modes`
- `set_core`

### 系统强制输入
- 自动额外读取启用中的 `novel_skeleton_topics`
- 不出现在前端多选里
- 作为“只能围绕这些 topicKey 产出 items”的系统约束

### 任务要求
- 时间线按历史顺序组织
- 人物覆盖关键阵营与关键角色
- 关键节点尽量覆盖战前/战中/战后
- 爆点偏短剧戏剧性和可改编性
- 骨架主题内容必须围绕每个 topic 定义

### 输出要求
- 只能输出严格 JSON
- 不要 markdown
- 不要解释
- 所有顶层字段都必须是数组

## 5. 多表事务写入顺序

### 删除顺序
按 `novel_id` 覆盖删除：
1. `novel_key_nodes`
2. `novel_explosions`
3. `novel_skeleton_topic_items`
4. `novel_characters`
5. `novel_timelines`

### 插入顺序
1. `novel_timelines`
2. `novel_characters`
3. `novel_key_nodes`
4. `novel_skeleton_topic_items`
5. `novel_explosions`

### 应用层补充字段
- `novel_id`
- `sort_order`
- `topic_id`
- `timeline_id`

其中：
- `timeline_id` 通过 `timelineRef` 做弱匹配
- `topic_id` 通过 `topicKey -> topic_id` map 映射

## 6. 基础校验规则

### 顶层结构
必须存在并且都为数组：
- `timelines`
- `characters`
- `keyNodes`
- `skeletonTopicItems`
- `explosions`

### 单项必填
- `timelines[].timeNode` 非空
- `timelines[].event` 非空
- `characters[].name` 非空
- `keyNodes[].title` 非空
- `explosions[].explosionType` 非空
- `explosions[].title` 非空
- `skeletonTopicItems[].topicKey` 必须存在于当前小说已启用 topic 中

### 清洗与兜底
- 所有字符串统一 `trim`
- `category` 为空时回填为 `未分类`
- 明显空对象丢弃
- 重复时间线 / 重复人物 / 重复关键节点 / 重复爆点做基础去重
- 非法 `topicKey` 丢弃并记 `warnings`
- `contentJson` MVP 允许为 `null`

### JSON 解析容错
为适配模型输出，本次新增了轻量容错：
- 去 markdown code fence
- 兼容部分“近似 JSON”格式
- 但仍以严格 JSON 为目标

## 7. 前端实现摘要

### 新增弹窗
新增：
- `apps/web/src/components/pipeline/PipelineExtractDialog.tsx`

能力包括：
- AI 模型下拉
- 参考表多选
- Prompt 预览
- 允许手工编辑 prompt
- 用户附加要求输入框
- 字体大小切换
- `取消 / 刷新 Prompt 预览 / 生成并写入`

### 接线位置
在 `PipelinePanel.tsx` 中：
- 将 Step2 与 Step3 之间的占位按钮
- 从 `alert/console.log`
- 改为打开 `PipelineExtractDialog`

### 成功后刷新链路
生成成功后：
1. 关闭弹窗
2. `await loadOverview()`
3. 增加 `extractRefreshKey`
4. 驱动 `SkeletonTopicsPanel` 重新加载已展开 topic 的 items

## 8. Build 结果

### 后端
```bash
pnpm --dir apps/api build
```
通过。

### 前端
```bash
pnpm --dir apps/web build
```
通过。

## 9. 联调结果

### 已验证
1. `GET /ai-model-catalog/options`
   - 成功
2. `POST /pipeline/1/extract-preview-prompt`
   - 成功
   - 返回 `promptPreview / usedModelKey / referenceTables`
3. `POST /pipeline/1/extract-and-generate`
   - 成功
   - 返回：

```json
{
  "ok": true,
  "summary": {
    "timelines": 5,
    "characters": 6,
    "keyNodes": 4,
    "skeletonTopicItems": 8,
    "explosions": 2
  }
}
```

### 数据库写入核对
当前 `novel_id = 1`：

```text
novel_timelines            5
novel_characters           6
novel_key_nodes            4
novel_skeleton_topic_items 8
novel_explosions           2
```

### Overview 回显核对
`GET /pipeline/1/overview` 已反映新数据：
- `timelines = 5`
- `characters = 6`
- `keyNodes = 4`
- `explosions = 2`
- `skeletonTopics`
  - `topic` 下 `items = 5`
  - `topic_2` 下 `items = 3`

## 10. 已知限制

1. 本批未实现二次 AI 自检/纠偏，仅做一次生成 + 基础校验。
2. `timelineRef` 目前是弱匹配，不保证复杂场景下 100% 精准映射。
3. `SkeletonTopicsPanel` 的自动刷新只覆盖“已展开 topic 的 items”；未展开项仍按懒加载模式展示。
4. JSON 容错解析只是 MVP 级增强，若上游模型长期输出非 JSON 风格内容，仍建议进一步收紧 prompt 或加入二次规范化步骤。
5. 当前联调使用了本地临时 4001 进程做验证，避免干扰已有 4000 开发实例。
