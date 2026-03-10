# Pipeline Second Review 质量增强实现报告

## 修改文件清单
- `apps/api/src/pipeline/pipeline-review.service.ts`
- `docs/cursor_impl/pipeline_second_review_quality_uplift_report.md`

说明：
- 本批次没有改 `extract-and-generate`
- 没有改前端 UI 结构
- 没有改数据库结构
- 没有改 `revision_notes_json` 的累计逻辑

## 实现目标
本次只增强 `pipeline second review` 的质量规则，不重做整条链路，重点提升 3 张表：
- `novel_characters`
- `novel_skeleton_topic_items`
- `novel_explosions`

保持不变的能力：
- `review-preview-prompt`
- `review-and-correct`
- 单事务覆盖写回
- `revision_notes_json` 历史累计
- `reviewNotes.table` 命名映射
- 前端现有按钮与弹窗交互

## review prompt 增强点

主改动在 `apps/api/src/pipeline/pipeline-review.service.ts` 的 `buildReviewPrompt()`。

### 1. reviewer 角色升级
新增“结构化质检纠偏器”角色描述，明确：
- 不是普通润色
- 不是简单换一种说法复述
- 要优先修结构质量

### 2. `characters` 强规则
新增明确约束：
- 必须覆盖主角、核心对手、关键盟友/辅臣、关键阻碍者/内应
- 必须统一人物别名，不允许把多个写法直接拼进 `name`
- `faction` 要规范化
- `description` 必须说明人物如何推动剧情
- `personality` 不能只有空泛性格词
- `settingWords` 要适合后续角色设定/绘图/风格化生成

### 3. `skeletonTopicItems` 强规则
新增明确约束：
- 每组内容必须围绕 `topicKey / topicName / topicType / description`
- 不允许只是改写 `drama_source_text`
- `list` 型 topic 必须拆条
- `text` 型 topic 也必须聚焦作答
- 每条 item 必须有分析/提炼价值
- `itemTitle` 不能大量使用“原因一/阶段一/过程一”这类空标题

### 4. `explosions` 强规则
新增明确约束：
- 必须是“短剧可拍的爆点单元”，不是普通历史摘要
- 每条至少体现两项：压迫 / 反击 / 反转 / 翻盘 / 身份差 / 权力逆转 / 生死危机 / 情绪释放
- `title` 必须短剧化
- `sceneRestoration` 必须有角色、场景、动作、冲突
- `dramaticQuality` 必须说明“为什么有戏”
- `adaptability` 必须说明为什么适合短剧改编

### 5. `reviewNotes` 强规则
保持 schema 不变，仍然是：

```json
{ "table": "...", "issue": "...", "fix": "..." }
```

但增强了输出要求：
- `novel_characters`：要写清补了哪些人物、统一了哪些别名、规范了哪些 faction
- `novel_skeleton_topic_items`：要写清哪些 topic 原先摘要化、现在如何改成围绕 topic 定义的提炼结果
- `novel_explosions`：要写清哪些爆点原先太平、现在增强了哪些冲突/反转/画面感/传播钩子

## 三张重点表新增的轻量程序兜底

## 1. `novel_characters`
新增轻量别名归一逻辑：
- 若 `name` 中出现明显别名拼接，如 `/`、`／`
- 取第一个非空主名作为 `name`
- 剩余别名以 `别名：...。` 前缀拼到 `description`
- 统计 `charactersAliasNormalizedCount`

特点：
- 只做轻量处理
- 不引入复杂 NLP
- 不改变整体写库结构

## 2. `novel_skeleton_topic_items`
新增轻量弱质量识别：
- 若 `itemTitle` 命中空泛标题模式，如“原因一 / 阶段一 / 过程一 / 内容一”
- 或 `content` 过短
- 记为弱 item

同时增加 topic 级弱告警：
- `list` 型 topic 若输出少于 2 条 item，记录 warning
- `text` 型 topic 若所有 item 都偏空泛摘要，记录 warning

并统计：
- `skeletonTopicWeakItemCount`

说明：
- 本批只做 warning 和日志，不阻断写库

## 3. `novel_explosions`
新增轻量弱质量识别：
- 若 `dramaticQuality` 或 `adaptability` 过短
- 或明显只是空泛短句
- 记录 warning

并统计：
- `explosionWeakCount`

说明：
- 同样只做 warning 和日志，不阻断写库

## 新增日志项

在 `reviewAndCorrect()` 中新增一条质量诊断日志：

- `charactersAliasNormalizedCount`
- `skeletonTopicWeakItemCount`
- `explosionWeakCount`
- `reviewNotesByTable`
- `focusTablesReceivedAiNotes`

日志风格保持：

```text
[pipeline:review] quality diagnostics ...
```

这条日志可直接帮助判断：
- 人物别名归一是否有触发
- `skeletonTopicItems` 是否仍偏弱
- `explosions` 是否仍偏模板化
- 三张重点表本轮是否都收到了真实 AI notes

## 兼容性与未破坏项

本次实现没有改动：
- `pipeline.controller.ts` 路由结构
- `PipelineSecondReviewDto`
- 前端 `PipelinePanel` 成功提示结构
- `revision_notes_json` merge 逻辑
- `reviewNotes.table` 映射函数
- `persistReviewedData()` 的 delete + recreate 主流程

额外做的最小扩展：
- 将 skeleton topic map 从只含 `id/topicKey` 扩展为包含：
  - `topicName`
  - `topicType`
  - `description`

用途仅限：
- review prompt 质量规则
- `skeletonTopicItems` 的轻量弱质量告警

## build 结果

已执行：

```bash
pnpm --dir apps/api build
pnpm --dir apps/web build
```

结果：
- `apps/api` build 通过
- `apps/web` build 通过

## 已知限制

### 1. 本批没有做真正的质量评分引擎
当前仍然是：
- prompt 强约束为主
- 轻量程序兜底为辅

还没有做：
- 全量规则机
- 评分系统
- 自动拒收机制

### 2. `characters` 只做了轻量别名归一
目前只处理：
- `/`
- `／`

还没有覆盖更复杂的别名、称呼、官职别称映射。

### 3. `skeletonTopicItems` 仍然没有强制拦截低质量内容
本次只记录 warning，不拒绝写库。

### 4. `explosions` 的弱质量识别仍是启发式
当前只看：
- 字段是否过短
- 是否明显空泛

还没有真正理解“冲突核/反转核/传播钩子”的细粒度结构。

### 5. 本批没有重新做真实 review 联调
本次任务要求聚焦实现与 build 验证，因此本报告没有追加新一轮数据库效果审计。
如果需要，下一步最自然的是：
- 跑一次真实 `review-and-correct`
- 再做一轮“质量 uplift 验收审计”

## 结论
这次实现已经把第二轮 review 从“方向性提示”提升到“更明确的质检纠偏规则”：
- prompt 更硬
- 重点表要求更具体
- 有了轻量程序兜底
- 有了更可观测的质量日志

同时又保持了当前系统最关键的稳定性：
- 不重做链路
- 不破坏现有接口
- 不破坏事务写回
- 不破坏 `revision_notes_json` 历史累计
