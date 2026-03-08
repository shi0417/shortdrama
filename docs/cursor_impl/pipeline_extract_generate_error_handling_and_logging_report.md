# Pipeline Extract Generate Error Handling And Logging Report

## 1. 修改/新增文件清单

本次实际修改文件：

- `apps/api/src/pipeline/pipeline-extract.service.ts`
- `apps/web/src/lib/api.ts`
- `apps/web/src/components/PipelinePanel.tsx`
- `apps/web/src/types/pipeline.ts`

未修改：

- 数据库表结构
- migration
- 其它业务模块

---

## 2. 后端补了哪些日志点

文件：`apps/api/src/pipeline/pipeline-extract.service.ts`

本次新增并统一到日志前缀：

- `[pipeline:extract] request start`
- `[pipeline:extract] enabled skeleton topics loaded`
- `[pipeline:extract] ai raw array counts`
- `[pipeline:extract] ai normalized counts`
- `[pipeline:extract] skeleton topic group received`
- `[pipeline:extract] skeleton topic group normalized`
- `[pipeline:extract] skeleton topic insert miss`
- `[pipeline:extract] skeleton topic insert hit`
- `[pipeline:extract] transaction start`
- `[pipeline:extract] delete existing start`
- `[pipeline:extract] delete existing done`
- `[pipeline:extract] insert timelines start / done`
- `[pipeline:extract] insert characters start / done`
- `[pipeline:extract] insert keyNodes start / done`
- `[pipeline:extract] insert skeletonTopicItems start / done`
- `[pipeline:extract] insert explosions start / done`
- `[pipeline:extract] transaction commit`
- `[pipeline:extract] transaction rollback`
- `[pipeline:extract] insert row failed`
- `[pipeline:extract] max length validation failed`
- `[pipeline:extract] field truncated with warning`

### 请求开始日志覆盖内容

- `novelId`
- `modelKey`
- `referenceTables`
- `promptLength`

### AI 返回结构日志覆盖内容

- 顶层数组原始长度：
  - `timelines`
  - `characters`
  - `keyNodes`
  - `skeletonTopicItems`
  - `explosions`
- 标准化后的数组长度

### skeleton topic 映射日志覆盖内容

- 当前启用 topic 数量
- 当前启用 `topicKey` 列表
- AI 每个 `skeletonTopicItems.topicKey` 是否命中
- 每个 group 原始 item 数量
- 标准化后保留数量
- 未命中的 `topicKey`

### 事务日志覆盖内容

- transaction start
- delete existing start / done
- 各表 insert start / done(count)
- transaction commit
- transaction rollback（带 `errorMessage`）

### 单条写入失败日志覆盖内容

出错时会记录：

- 表名
- 当前索引
- 关键字段摘要
- 高风险字段长度
- 原始 `error.message`

---

## 3. 哪些字段做了长度保护

文件：`apps/api/src/pipeline/pipeline-extract.service.ts`

新增 helper：

- `getStringLength(...)`
- `assertMaxLength(...)`
- `truncateWithWarning(...)`
- `safeTrim(...)`
- `previewText(...)`
- `logRowFailure(...)`
- `formatPersistError(...)`
- `logExtractStage(...)`

### 显式校验后直接抛错的字段

#### `novel_timelines`
- `time_node <= 100`

#### `novel_characters`
- `name <= 100`
- `faction <= 50`

#### `novel_key_nodes`
- `category <= 50`
- `title <= 255`

#### `novel_explosions`
- `explosion_type <= 50`
- `title <= 255`

### 可安全截断并记录 warning 的字段

#### `novel_skeleton_topic_items`
- `item_title <= 255`
- `source_ref <= 255`

#### `novel_explosions`
- `subtitle <= 255`

### 抛错信息示例风格

例如：

- `写入 novel_characters 失败：第 2 条记录的 faction 长度为 87，超过上限 50`

这类错误会在应用层先抛出，不再等数据库返回模糊 SQL 错误。

---

## 4. 错误包装策略

文件：`apps/api/src/pipeline/pipeline-extract.service.ts`

新增统一错误包装逻辑：`formatPersistError(...)`

### 已做的 SQL 错误可读化

对以下常见错误进行了更可读的转换：

- `Data too long for column 'xxx'`
- `Incorrect string value`
- `Cannot add or update a child row`
- `Invalid JSON text`

### 错误抛出规则

- 事务内任何失败都继续抛出
- 不吞错
- 外层事务捕获后打印 rollback 日志，再继续抛出

### 当前事务保证

事务仍然是：

- `dataSource.transaction(async (manager) => ...)`

因此：

- delete + 5 张目标表 insert 仍然在同一事务里
- 出错会 rollback
- 不会保留半成品

---

## 5. 前端错误提示改动

涉及文件：

- `apps/web/src/lib/api.ts`
- `apps/web/src/components/PipelinePanel.tsx`

### `apiClient` 改动

之前：

- 只尝试 `response.json()`
- 只读 `message`

现在：

- 先读原始 `response.text()`
- 尝试解析 JSON
- 支持读取并拼接：
  - `message`
  - `warnings`
  - `details`
- 最终构造更完整的 `Error.message`

### 前端失败展示改动

`PipelinePanel.tsx` 中 `extract-and-generate` 失败分支继续使用：

- `alert(err?.message || ...)`

但现在这个 `err.message` 已尽量是后端真实 message，不再是简单“写入数据库错误”。

### 前端成功展示改动

成功后除了 `summary` 和 `warnings`，还会显示：

- `details.enabledTopicCount`
- `details.enabledTopicKeys`
- 标准化后各数组长度
- `skeletonTopicItemsRequestedGroups`
- `skeletonTopicItemsRequestedItems`
- `skeletonTopicItemsInserted`
- `skeletonTopicItemsDropped`

这样成功但结果异常时也更容易发现。

---

## 6. skeletonTopicItems 调试改动

文件：`apps/api/src/pipeline/pipeline-extract.service.ts`

本次对 `novel_skeleton_topic_items` 的链路做了专门补强：

### 标准化阶段新增

- 记录 AI 返回的 `skeletonTopicItems` group 数量
- 统计 AI 请求了多少个 items
- 对每个 group 记录：
  - `topicKey`
  - `normalizedTopicKey`
  - `itemCount`
  - 是否命中 `topicMap`

### 插入阶段新增

- 对命中的 `topicKey` 打 hit 日志
- 对未命中的 `topicKey`：
  - 记录 warning
  - 记录日志

### 返回结果新增

`extract-and-generate` 成功响应新增 `details`：

- `enabledTopicCount`
- `enabledTopicKeys`
- `normalizedCounts`
- `skeletonTopicItemsRequestedGroups`
- `skeletonTopicItemsRequestedItems`
- `skeletonTopicItemsInserted`
- `skeletonTopicItemsDropped`

此外：

- 若 AI 返回了 skeleton groups，但最终 0 条写入，会自动追加 warning，提醒检查 `topicKey` 映射。

---

## 7. Build 结果

### 后端

命令：

```bash
pnpm --dir apps/api build
```

结果：

- 通过

### 前端

命令：

```bash
pnpm --dir apps/web build
```

结果：

- 通过

---

## 8. 复测结果

## 场景 A：正常生成

### 1) Prompt 预览接口

命令方式：

- 使用 `s01 / 123456` 登录获取 token
- 调用 `POST /pipeline/1/extract-preview-prompt`

结果摘要：

```json
{
  "status": 201,
  "modelKey": "chat_fast_imagine",
  "promptLength": 7821
}
```

说明：

- prompt preview 正常返回
- 后端链路可用

### 2) 真实生成接口

调用：

- `POST /pipeline/1/extract-and-generate`

返回摘要：

```json
{
  "ok": true,
  "summary": {
    "timelines": 4,
    "characters": 3,
    "keyNodes": 2,
    "skeletonTopicItems": 4,
    "explosions": 2
  },
  "details": {
    "enabledTopicCount": 2,
    "enabledTopicKeys": ["topic", "topic_2"],
    "normalizedCounts": {
      "timelines": 4,
      "characters": 3,
      "keyNodes": 2,
      "skeletonTopicItems": 2,
      "explosions": 2
    },
    "skeletonTopicItemsRequestedGroups": 2,
    "skeletonTopicItemsRequestedItems": 4,
    "skeletonTopicItemsInserted": 4,
    "skeletonTopicItemsDropped": 0
  }
}
```

### 3) 生成后数据库复核

```text
novel_timelines             4   2026-03-08 11:32:58   2026-03-08 11:32:58
novel_characters            3   2026-03-08 11:32:58   2026-03-08 11:32:58
novel_key_nodes             2   2026-03-08 11:32:58   2026-03-08 11:32:58
novel_skeleton_topic_items  4   2026-03-08 11:32:58   2026-03-08 11:32:58
novel_explosions            2   2026-03-08 11:32:58   2026-03-08 11:32:58
```

说明：

- overview 覆盖写入正常
- 本次 `novel_skeleton_topic_items` 已成功写入，不再是 0
- 成功链路下新的 `details` 可用于定位 topic 映射情况

## 场景 B：人为制造长度越界

本次**未做端到端强制注入**，原因如下：

1. 当前接口的最终入库内容来自外部 AI 返回。
2. 如果要稳定复现长度越界，需要在业务代码里引入测试专用注入分支，或者临时篡改 AI 返回内容。
3. 这会把测试逻辑混入正式业务实现，不符合本次“只做诊断增强与错误可见化”的边界。

因此本次采用的策略是：

- 在应用层实现严格长度校验与可读错误包装
- 通过代码与 build 保证路径打通
- 保留正常生成复测

若后续需要，我可以再单独做一版“仅本地开发用的可控测试注入方案”，但这不应直接混进正式逻辑。

---

## 9. 已知限制

1. 本次没有引入专门的单元测试或 e2e 测试文件。
2. 目前日志仍然使用 `console.log / warn / error`，未接入统一日志系统。
3. 对长文本字段（如 `description / scene_restoration / dramatic_quality / adaptability / content`）本次未加长度限制，因为对应数据库字段本身是 `text / longtext`，当前重点是短字段越界。
4. `apiClient` 成功分支仍假定返回 JSON；本次需求范围内已经足够，但若后续接口出现非 JSON 成功响应，还可以继续做兼容。

---

## 最终结论

本次实现已经完成以下目标：

1. 后端补齐了可复盘的结构化日志。
2. 高风险短字段增加了应用层长度保护。
3. SQL/持久化错误会被包装成更可读的 message 抛给前端。
4. 前端不再只显示笼统失败，而会尽量展示后端真实 `message / warnings / details`。
5. `novel_skeleton_topic_items` 的 topic 命中、掉落和插入情况现在可以通过日志和响应 `details` 直接观察。
