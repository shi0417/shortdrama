# Pipeline 抽取历史骨架和生成爆点 AI 弹窗审计报告

## 1. 前端链路现状

### 1.1 当前按钮位置与绑定
`/projects -> Pipeline` 最终主组件仍是 `apps/web/src/components/PipelinePanel.tsx`。

当前“抽取历史骨架和生成爆点”按钮就在该文件中，位于：
- `Step 2` 卡片之后
- `Step 3` 卡片之前
- 作为一个独立 sibling 操作区

当前 JSX 结构为：

```tsx
<div
  style={{
    border: '1px solid #e8e8e8',
    borderRadius: '8px',
    padding: '12px 16px',
    background: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '16px',
    flexWrap: 'wrap',
  }}
>
  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
    <div style={{ fontWeight: 600, color: '#333' }}>预处理操作</div>
    <div style={{ fontSize: '12px', color: '#666' }}>
      在生成世界观前，先执行历史骨架抽取与爆点生成。
    </div>
  </div>
  <button
    onClick={handlePreStep3Action}
    style={{
      padding: '6px 12px',
      border: 'none',
      borderRadius: '4px',
      background: '#1890ff',
      color: '#fff',
      cursor: 'pointer',
      fontSize: '13px',
    }}
  >
    抽取历史骨架和生成爆点
  </button>
</div>
```

当前按钮绑定的函数是：

```tsx
const handlePreStep3Action = () => {
  console.log({
    action: 'extract_history_skeleton_and_generate_explosions',
    novelId,
    novelName,
  })
  alert('抽取历史骨架和生成爆点：后端接口尚未接入')
}
```

结论：
- 当前按钮**已经绑定函数**
- 但只是前端占位
- 还没有弹 AI 对话框，也没有调任何后端

### 1.2 当前最适合复用的 AI 弹窗实现
当前项目中最适合复用的 AI 弹窗实现是：
- `apps/web/src/components/pipeline/SetCoreEnhanceDialog.tsx`

原因：
- 已具备模型下拉
- 已具备参考表多选
- 已具备 prompt preview
- 已具备“允许手工编辑 prompt”
- 已具备“生成并回填”提交按钮

但不建议直接硬复用该组件本身，因为它目前语义强绑定：
- `set_core`
- `saveBehaviorDescription`
- 单对象返回结构

### 1.3 如果参考 set_core 的 AI 弹窗做法，最适合新增哪个组件文件
最适合新增为一个平行组件，例如：
- `apps/web/src/components/pipeline/PipelineExtractDialog.tsx`

不建议直接塞进：
- `SetCoreEnhanceDialog.tsx`

原因：
- 新功能返回的不是单个 `set_core` 对象，而是多表结构化结果
- 新功能还会涉及二次确认 / 多表落库 / 可能的批量预览
- 独立组件更清晰，也避免把 `set_core` 语义搞混

### 1.4 当前前端可复用逻辑

#### 可复用 1：模型下拉加载逻辑
在 `PipelinePanel.tsx` 中已有：

```tsx
const loadEnhanceModels = async () => {
  const models = await setCoreApi.listAiModelCatalogOptions()
  setEnhanceModels(models || [])
  return models || []
}
```

对应后端接口：
- `GET /ai-model-catalog/options`

#### 可复用 2：参考表多选逻辑
已有：

```tsx
const handleToggleEnhanceReferenceTable = (table: string) => {
  setEnhanceReferenceTables((prev) =>
    prev.includes(table) ? prev.filter((item) => item !== table) : [...prev, table]
  )
}
```

以及 `SetCoreEnhanceDialog.tsx` 中的复选框渲染模式。

#### 可复用 3：Prompt Preview 逻辑
已有：

```tsx
const refreshEnhancePromptPreview = async (modelKey?: string) => {
  const preview = await setCoreApi.previewSetCoreEnhancePrompt(novelId, {
    modelKey: resolvedModelKey,
    referenceTables: enhanceReferenceTables,
    currentCoreText: coreSettingText || undefined,
    currentFields: getCurrentEnhanceFields(),
    userInstruction: enhanceUserInstruction || undefined,
  })
  setEnhancePromptPreview(preview.promptPreview || '')
}
```

#### 可复用 4：生成提交流程
已有：
- 模型选择
- prompt override
- 弹窗提交
- 成功后刷新/回填的流程骨架

但返回结构是：
- 单对象 `EnhanceSetCoreResponseDto`

新功能需要改造成：
- 多表数组型返回结构

### 1.5 当前页面刷新 Step1 / Step2 数据靠什么函数，能否复用
当前 Step1 / Step2 / Step3 的只读展示都依赖：

```tsx
const loadOverview = async () => {
  const data = await api.getPipelineOverview(novelId)
  setTimelines(data.timelines || [])
  setCharacters(data.characters || [])
  setKeyNodes(data.keyNodes || [])
  setExplosions(data.explosions || [])
  setWorldview(data.worldview || ...)
}
```

结论：
- **可以直接复用**
- 如果未来成功写入 `novel_timelines / novel_characters / novel_key_nodes / novel_explosions / skeleton topics/items`
- 前端最小刷新链路就是：
  - `await loadOverview()`

### 1.6 成功写入后，前端最小刷新链路
最小刷新链路建议：
1. 关闭新弹窗
2. `await loadOverview()`
3. 若还要同步某些局部 state，再补局部刷新

对于 Step1 / Step2 的结果展示来说，**`loadOverview()` 足够成为 MVP 的统一刷新入口**。

---

## 2. 后端链路现状

### 2.1 当前是否已有“抽取历史骨架和生成爆点”的组合接口
**没有。**

当前 `pipeline` 模块只有：

```ts
@Get(':novelId/overview')
getOverview(@Param('novelId', ParseIntPipe) novelId: number) {
  return this.pipelineService.getOverview(novelId);
}
```

也就是说：
- 只有只读 overview
- 没有任何 AI 编排 / 生成 / 批量写入接口

### 2.2 当前 `pipeline` 模块能否作为这个功能的后端落点
**能，而且是当前最合适的落点。**

理由：
- 功能横跨 Step1 和 Step2
- 需要同时写多个表
- 语义上是 Pipeline 前置编排
- 当前 `PipelineService.getOverview()` 已经聚合读出了这些目标表

比起放到：
- `set-core`
- `source-texts`

更适合放在：
- `pipeline` 模块

### 2.3 当前 `set_core:enhance` 哪些逻辑可复用
`apps/api/src/set-core/set-core.service.ts` 已经有一整条 AI 编排链路，可以复用的包括：

#### 1. 模型读取
```ts
private async resolveModelKey(modelKey?: string): Promise<string>
```

#### 2. Prompt 预览
```ts
async previewEnhancePrompt(...)
```

#### 3. 外部 AI 调用
```ts
private async callLcAiApi(modelKey: string, promptPreview: string)
```

#### 4. JSON 解析
```ts
private extractAiText(payload: any)
private parseJsonObjectFromText(text: string)
```

#### 5. 参考表按 `novel_id` 读取
```ts
private async selectByNovel(tableName, alias, novelId, orderBy?)
```

结论：
- 这套逻辑非常适合抽成一层共用 helper / service
- 否则直接复制到 `pipeline` 里会形成重复

### 2.4 当前有没有现成的 service 可按 `novel_id` 读取参考表
有，但分散：

#### 在 `pipeline.service.ts`
- `novel_timelines`
- `novel_characters`
- `novel_key_nodes`
- `novel_explosions`
- `novel_skeleton_topics`
- `novel_skeleton_topic_items`

#### 在 `set-core.service.ts`
- `drama_source_text`
- `novel_adaptation_strategy`
- `adaptation_modes`
- 以及对多表 prompt block 的组织

#### 在 `source-texts.service.ts`
- 有 `findByNovelId(novelId)`，但更偏 CRUD/展示，不是 prompt 组织

### 2.5 当前有没有现成的写入逻辑可复用到目标表

#### 已有一定复用的
- `novel_skeleton_topics`
  - 有 `SkeletonTopicsService.create/update/remove/listItemsByTopic`

#### 当前没有现成写入逻辑的
- `novel_timelines`
- `novel_characters`
- `novel_key_nodes`
- `novel_skeleton_topic_items`
- `novel_explosions`

也就是说：
- **没有现成的“整套生成后批量写入”逻辑**
- 目前只有骨架主题配置表的 CRUD

### 2.6 如果没有现成写入逻辑，最适合新增到哪个模块
最推荐：
- **`pipeline` 模块中新建一个 orchestration service**

例如：
- `PipelineExtractService`
- 或 `PipelineGenerationService`

原因：
- 该功能天然是多表事务编排
- 需要调 AI、做校验、分发表写入
- 不建议把这些重逻辑直接堆在 `PipelineService.getOverview()` 里

MVP 阶段不建议一开始就拆成很多小 service，因为会增加接线成本。

---

## 3. 数据库表只读核对

### 3.1 总览

| 表名 | 是否存在 | 行数 |
|---|---|---:|
| `drama_novels` | 是 | 1 |
| `drama_source_text` | 是 | 1 |
| `novel_adaptation_strategy` | 是 | 1 |
| `adaptation_modes` | 是 | 3 |
| `set_core` | 是 | 1 |
| `novel_timelines` | 是 | 0 |
| `novel_characters` | 是 | 19 |
| `novel_key_nodes` | 是 | 0 |
| `novel_skeleton_topics` | 是 | 2 |
| `novel_skeleton_topic_items` | 是 | 0 |
| `novel_explosions` | 是 | 10 |
| `ai_model_catalog` | 是 | 525 |

> 说明：行数以 `COUNT(*)` 为准。

### 3.2 各表分析

#### `drama_novels`
- 关键字段摘要：
  - `id`
  - `novels_name`
  - `description`
  - `total_chapters`
  - `power_up_interval`
  - `author`
  - `status`
  - `theme_id`
- 适合喂给 AI：
  - `novels_name`
  - `description`
  - `total_chapters`
  - `power_up_interval`
  - `author`
- 不适合直接喂给 AI：
  - `id`
  - `created_at`
  - `updated_at`
  - `status`（除非需要上下文）
- 将来若写入：本功能不建议写这张表
- 原样 `SHOW CREATE TABLE`：

```sql
CREATE TABLE `drama_novels` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '�̾�ID����Ӧstructure����novels_id��',
  `novels_name` varchar(100) NOT NULL COMMENT '�̾����ƣ��磺��������������',
  `description` text COMMENT '����',
  `total_chapters` int DEFAULT '0' COMMENT '�ܼ���',
  `power_up_interval` int DEFAULT '5' COMMENT 'Ȩ���㼶�������������Nֵ��Ĭ��5����һ����',
  `author` varchar(50) DEFAULT NULL COMMENT '���/����',
  `status` tinyint DEFAULT '0' COMMENT '0=δ���ߣ�1=�����У�2=�����',
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '����ʱ��',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '����ʱ��',
  `theme_id` int DEFAULT NULL COMMENT '题材ID',
  PRIMARY KEY (`id`),
  KEY `idx_drama_novels_theme_id` (`theme_id`),
  CONSTRAINT `fk_drama_novels_theme` FOREIGN KEY (`theme_id`) REFERENCES `ai_short_drama_theme` (`id`) ON DELETE SET NULL ON UPDATE RESTRICT
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='�̾������Ϣ������Ȩ����������'
```

#### `drama_source_text`
- 关键字段摘要：
  - `id`
  - `novels_id`
  - `source_text`
  - `update_time`
- 适合喂给 AI：
  - `source_text`
- 不适合直接喂给 AI：
  - `id`
  - `novels_id`
- 将来若写入本功能：通常不写，只读作为原始素材输入
- 原样 `SHOW CREATE TABLE`：

```sql
CREATE TABLE `drama_source_text` (
  `id` int NOT NULL AUTO_INCREMENT,
  `novels_id` int NOT NULL COMMENT '�����̾�ID',
  `source_text` longtext COMMENT '�ο�����',
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_source_novels` (`novels_id`),
  CONSTRAINT `fk_source_novels` FOREIGN KEY (`novels_id`) REFERENCES `drama_novels` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='�̾�ο��ı���'
```

#### `novel_adaptation_strategy`
- 关键字段摘要：
  - `id`
  - `novel_id`
  - `mode_id`
  - `strategy_title`
  - `strategy_description`
  - `ai_prompt_template`
  - `version`
- 适合喂给 AI：
  - `strategy_title`
  - `strategy_description`
  - `ai_prompt_template`
  - `version`
- 不适合直接喂给 AI：
  - `id`
  - `novel_id`
  - `mode_id`（更适合先 join 成 mode 信息）
- 将来若写入：本功能不建议直接改该表
- 原样 `SHOW CREATE TABLE`：

```sql
CREATE TABLE `novel_adaptation_strategy` (
  `id` int NOT NULL AUTO_INCREMENT,
  `novel_id` int NOT NULL,
  `mode_id` int NOT NULL COMMENT '�ı�ģʽ',
  `strategy_title` varchar(200) DEFAULT NULL,
  `strategy_description` longtext COMMENT '�ı����˵��',
  `ai_prompt_template` longtext COMMENT 'AI Promptģ��',
  `version` int DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_adaptation_novel` (`novel_id`),
  KEY `fk_adaptation_mode` (`mode_id`),
  CONSTRAINT `fk_adaptation_mode` FOREIGN KEY (`mode_id`) REFERENCES `adaptation_modes` (`id`),
  CONSTRAINT `fk_adaptation_novel` FOREIGN KEY (`novel_id`) REFERENCES `drama_novels` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
```

#### `adaptation_modes`
- 关键字段摘要：
  - `id`
  - `mode_key`
  - `mode_name`
  - `description`
  - `is_active`
  - `sort_order`
- 适合喂给 AI：
  - `mode_key`
  - `mode_name`
  - `description`
- 不适合直接喂给 AI：
  - `id`
  - `sort_order`
  - `created_at`
- 将来若写入：本功能不建议改该表
- 原样 `SHOW CREATE TABLE`：

```sql
CREATE TABLE `adaptation_modes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `mode_key` varchar(50) NOT NULL COMMENT 'ģʽkey',
  `mode_name` varchar(100) NOT NULL COMMENT 'ģʽ����',
  `description` text COMMENT 'ģʽ˵��',
  `is_active` tinyint DEFAULT '1',
  `sort_order` int DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `mode_key` (`mode_key`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
```

#### `set_core`
- 关键字段摘要：
  - `id`
  - `novel_id`
  - `title`
  - `core_text`
  - `protagonist_name`
  - `protagonist_identity`
  - `target_story`
  - `rewrite_goal`
  - `constraint_text`
  - `version`
  - `is_active`
- 适合喂给 AI：
  - `title`
  - `core_text`
  - `protagonist_name`
  - `protagonist_identity`
  - `target_story`
  - `rewrite_goal`
  - `constraint_text`
- 不适合直接喂给 AI：
  - `id`
  - `novel_id`
  - `version`
  - `is_active`
- 将来若写入：本功能大概率只读，作为上下文输入
- 原样 `SHOW CREATE TABLE`：

```sql
CREATE TABLE `set_core` (
  `id` int NOT NULL AUTO_INCREMENT,
  `novel_id` int NOT NULL,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `core_text` longtext COLLATE utf8mb4_unicode_ci NOT NULL,
  `protagonist_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `protagonist_identity` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `target_story` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `rewrite_goal` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `constraint_text` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `version` int DEFAULT '1',
  `is_active` tinyint DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_set_core_novel` (`novel_id`),
  KEY `idx_set_core_active` (`novel_id`,`is_active`),
  CONSTRAINT `fk_set_core_novel` FOREIGN KEY (`novel_id`) REFERENCES `drama_novels` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
```

#### `novel_timelines`
- 关键字段摘要：
  - `id`
  - `novel_id`
  - `time_node`
  - `event`
  - `sort_order`
- 适合喂给 AI：
  - `time_node`
  - `event`
- 不适合直接喂给 AI：
  - `id`
  - `novel_id`
  - `sort_order`
- 将来若写入最关键必填字段：
  - `novel_id`
  - `time_node`
  - `event`
- 原样 `SHOW CREATE TABLE`：

```sql
CREATE TABLE `novel_timelines` (
  `id` int NOT NULL AUTO_INCREMENT,
  `novel_id` int NOT NULL,
  `time_node` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'ʱ��ڵ�',
  `event` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '�¼�����',
  `sort_order` int DEFAULT '0' COMMENT '����˳��',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_novel_sort` (`novel_id`,`sort_order`),
  CONSTRAINT `fk_novel_timelines_novel_id_drama_novels` FOREIGN KEY (`novel_id`) REFERENCES `drama_novels` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
```

#### `novel_characters`
- 关键字段摘要：
  - `id`
  - `novel_id`
  - `name`
  - `faction`
  - `description`
  - `personality`
  - `setting_words`
  - `image_path`
  - `sort_order`
- 适合喂给 AI：
  - `name`
  - `faction`
  - `description`
  - `personality`
  - `setting_words`
- 不适合直接喂给 AI：
  - `id`
  - `novel_id`
  - `image_path`
  - `sort_order`
- 将来若写入最关键必填字段：
  - `novel_id`
  - `name`
- 原样 `SHOW CREATE TABLE`：

```sql
CREATE TABLE `novel_characters` (
  `id` int NOT NULL AUTO_INCREMENT,
  `novel_id` int NOT NULL,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '��������',
  `faction` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '��Ӫ���磺������Ӫ��������Ӫ��Ļ�����',
  `description` text COLLATE utf8mb4_unicode_ci COMMENT '��������',
  `personality` text COLLATE utf8mb4_unicode_ci COMMENT '�Ը��ص�',
  `setting_words` text COLLATE utf8mb4_unicode_ci COMMENT '��ɫ�趨�ʣ����ڻ�ͼ',
  `image_path` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '�ο�ͼ·��',
  `sort_order` int DEFAULT '0' COMMENT '����˳��',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_novel_faction` (`novel_id`,`faction`),
  CONSTRAINT `fk_novel_characters_novel_id_drama_novels` FOREIGN KEY (`novel_id`) REFERENCES `drama_novels` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=20 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
```

#### `novel_key_nodes`
- 关键字段摘要：
  - `id`
  - `novel_id`
  - `timeline_id`
  - `category`
  - `title`
  - `description`
  - `sort_order`
- 适合喂给 AI：
  - `category`
  - `title`
  - `description`
- 不适合直接喂给 AI：
  - `id`
  - `novel_id`
  - `timeline_id`
  - `sort_order`
- 将来若写入最关键必填字段：
  - `novel_id`
  - `title`
  - `category`（建议强制）
- 原样 `SHOW CREATE TABLE`：

```sql
CREATE TABLE `novel_key_nodes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `novel_id` int NOT NULL,
  `timeline_id` int DEFAULT NULL,
  `category` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '���ࣨսǰ���ġ�ս�����̡�ս����β��',
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '�ڵ����',
  `description` longtext COLLATE utf8mb4_unicode_ci COMMENT '��ϸ����',
  `sort_order` int DEFAULT '0' COMMENT '����˳��',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_novel_category` (`novel_id`,`category`),
  KEY `fk_novel_key_nodes_timeline_id_novel_timelines` (`timeline_id`),
  CONSTRAINT `fk_novel_key_nodes_novel_id_drama_novels` FOREIGN KEY (`novel_id`) REFERENCES `drama_novels` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_novel_key_nodes_timeline_id_novel_timelines` FOREIGN KEY (`timeline_id`) REFERENCES `novel_timelines` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
```

#### `novel_skeleton_topics`
- 关键字段摘要：
  - `id`
  - `novel_id`
  - `topic_key`
  - `topic_name`
  - `topic_type`
  - `description`
  - `sort_order`
  - `is_enabled`
- 适合喂给 AI：
  - `topic_key`
  - `topic_name`
  - `topic_type`
  - `description`
- 不适合直接喂给 AI：
  - `id`
  - `novel_id`
  - `sort_order`
  - `is_enabled`
- 将来若写入最关键必填字段：
  - `novel_id`
  - `topic_key`
  - `topic_name`
  - `topic_type`
- 原样 `SHOW CREATE TABLE`：

```sql
CREATE TABLE `novel_skeleton_topics` (
  `id` int NOT NULL AUTO_INCREMENT,
  `novel_id` int NOT NULL,
  `topic_key` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `topic_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `topic_type` enum('text','list','json') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'text',
  `description` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sort_order` int DEFAULT '0',
  `is_enabled` tinyint DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_novel_skeleton_topics_novel_topic_key` (`novel_id`,`topic_key`),
  KEY `idx_novel_skeleton_topics_novel_sort` (`novel_id`,`sort_order`),
  CONSTRAINT `fk_novel_skeleton_topics_novel` FOREIGN KEY (`novel_id`) REFERENCES `drama_novels` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
```

#### `novel_skeleton_topic_items`
- 关键字段摘要：
  - `id`
  - `novel_id`
  - `topic_id`
  - `item_title`
  - `content`
  - `content_json`
  - `sort_order`
  - `source_ref`
- 适合喂给 AI：
  - `item_title`
  - `content`
  - `content_json`
  - `source_ref`
- 不适合直接喂给 AI：
  - `id`
  - `novel_id`
  - `topic_id`
  - `sort_order`
- 将来若写入最关键必填字段：
  - `novel_id`
  - `topic_id`
  - 以及至少 `item_title / content / content_json` 其一
- 原样 `SHOW CREATE TABLE`：

```sql
CREATE TABLE `novel_skeleton_topic_items` (
  `id` int NOT NULL AUTO_INCREMENT,
  `novel_id` int NOT NULL,
  `topic_id` int NOT NULL,
  `item_title` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `content` longtext COLLATE utf8mb4_unicode_ci,
  `content_json` json DEFAULT NULL,
  `sort_order` int DEFAULT '0',
  `source_ref` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_novel_skeleton_topic_items_topic_sort` (`topic_id`,`sort_order`),
  KEY `idx_novel_skeleton_topic_items_novel_topic` (`novel_id`,`topic_id`),
  CONSTRAINT `fk_novel_skeleton_topic_items_novel` FOREIGN KEY (`novel_id`) REFERENCES `drama_novels` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_novel_skeleton_topic_items_topic` FOREIGN KEY (`topic_id`) REFERENCES `novel_skeleton_topics` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
```

#### `novel_explosions`
- 关键字段摘要：
  - `id`
  - `novel_id`
  - `timeline_id`
  - `explosion_type`
  - `title`
  - `subtitle`
  - `scene_restoration`
  - `dramatic_quality`
  - `adaptability`
  - `sort_order`
- 适合喂给 AI：
  - `explosion_type`
  - `title`
  - `subtitle`
  - `scene_restoration`
  - `dramatic_quality`
  - `adaptability`
- 不适合直接喂给 AI：
  - `id`
  - `novel_id`
  - `timeline_id`
  - `sort_order`
- 将来若写入最关键必填字段：
  - `novel_id`
  - `explosion_type`
  - `title`
- 原样 `SHOW CREATE TABLE`：

```sql
CREATE TABLE `novel_explosions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `novel_id` int NOT NULL,
  `timeline_id` int DEFAULT NULL,
  `explosion_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '�������ͣ����ı��㡢����չ���㣩',
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '�������',
  `subtitle` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '������',
  `scene_restoration` text COLLATE utf8mb4_unicode_ci COMMENT '������ԭ',
  `dramatic_quality` text COLLATE utf8mb4_unicode_ci COMMENT 'Ϸ����',
  `adaptability` text COLLATE utf8mb4_unicode_ci COMMENT '�ɸı���',
  `sort_order` int DEFAULT '0' COMMENT '����˳��',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_novel_type` (`novel_id`,`explosion_type`),
  KEY `idx_explosions_timeline_id` (`timeline_id`),
  CONSTRAINT `fk_novel_explosions_novel_id_drama_novels` FOREIGN KEY (`novel_id`) REFERENCES `drama_novels` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_novel_explosions_timeline_id_novel_timelines` FOREIGN KEY (`timeline_id`) REFERENCES `novel_timelines` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=11 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
```

#### `ai_model_catalog`
- 关键字段摘要：
  - `id`
  - `model_key`
  - `display_name`
  - `provider`
  - `family`
  - `model_group`
  - `modality`
  - `capability_tags`
  - `version_label`
  - `is_active`
- 适合喂给 AI：
  - 不建议作为 prompt 业务上下文喂给模型
- 适合作为前端模型选择器数据源：
  - `model_key`
  - `display_name`
  - `provider`
  - `family`
  - `modality`
- 原样 `SHOW CREATE TABLE`：

```sql
CREATE TABLE `ai_model_catalog` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `model_key` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '模型�?��标识，�? gpt-4o / claude-4-sonnet / mj_imagine',
  `display_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '展示名称',
  `provider` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '供应商，�?openai/anthropic/google/qwen/deepseek/xai/midjourney',
  `family` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '模型家族，�? gpt/claude/gemini/qwen/mj/grok/o-series',
  `model_group` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '模型分组，�? llm/image/video/audio/embedding/realtime/search/coder',
  `modality` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '模�?，�? text/image/audio/video/multimodal/text-vector',
  `capability_tags` json DEFAULT NULL COMMENT '能力标�?JSON，�? [\"thinking\",\"search\",\"vision\"]',
  `version_label` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '版本标�?，�? 2025-08-07 / preview / latest / thinking',
  `source_type` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'import' COMMENT '来源类型 manual/import/system',
  `is_active` tinyint(1) NOT NULL DEFAULT '1' COMMENT '�?���?�� 1�?�� 0停用',
  `is_deprecated` tinyint(1) NOT NULL DEFAULT '0' COMMENT '�?��废弃',
  `sort_order` int NOT NULL DEFAULT '0' COMMENT '排序�',
  `notes` text COLLATE utf8mb4_unicode_ci COMMENT '备注',
  `raw_meta` json DEFAULT NULL COMMENT '原�?扩展信息',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ai_model_catalog_model_key` (`model_key`),
  KEY `idx_ai_model_catalog_provider` (`provider`),
  KEY `idx_ai_model_catalog_family` (`family`),
  KEY `idx_ai_model_catalog_group` (`model_group`),
  KEY `idx_ai_model_catalog_active` (`is_active`),
  KEY `idx_ai_model_catalog_sort` (`sort_order`)
) ENGINE=InnoDB AUTO_INCREMENT=1051 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI模型�?���'
```

---

## 4. 参考表 -> Prompt 投喂建议

下面重点针对用户指定的 5 张参考表给出明确建议。

### 4.1 `drama_novels`
- 建议取字段：
  - `novels_name`
  - `description`
  - `total_chapters`
  - `power_up_interval`
  - `author`
- 建议组织方式：
  - 标题块 `【项目基础信息】`
  - 每个字段一行
  - 例如：
    - `项目名：xxx`
    - `简介：xxx`
    - `总章节：xx`
    - `升级节奏：每 x 章`
- 是否截断：
  - `description` 需要
- 推荐最大长度：
  - `description` 500~800 字
- 是否建议默认勾选：
  - **建议默认勾选**

### 4.2 `drama_source_text`
- 建议取字段：
  - 只取 `source_text`
- 组织方式：
  - `【背景原始资料】`
  - 如果有多条，按 `update_time DESC, id DESC`
  - MVP 建议只取最新一条
- 是否截断：
  - 必须截断
- 推荐最大长度：
  - 3000~5000 字
- 是否建议默认勾选：
  - **建议默认勾选**

### 4.3 `novel_adaptation_strategy`
- 建议取字段：
  - `version`
  - `strategy_title`
  - `strategy_description`
  - `ai_prompt_template`
- 组织方式：
  - `【改编策略】`
  - 只取当前小说最新版本一条
  - 按：
    - 版本
    - 标题
    - 说明
    - Prompt 模板
- 是否截断：
  - `strategy_description` 和 `ai_prompt_template` 都要截断
- 推荐最大长度：
  - `strategy_description` 500~800
  - `ai_prompt_template` 800~1200
- 是否建议默认勾选：
  - **建议默认勾选**

### 4.4 `adaptation_modes`
- 建议取字段：
  - `mode_key`
  - `mode_name`
  - `description`
- 组织方式：
  - `【改编模式】`
  - 如果已经存在 `novel_adaptation_strategy.mode_id`，只取该 mode
  - 不建议把所有 mode 全量喂进去
- 是否截断：
  - 需要
- 推荐最大长度：
  - `description` 300~500
- 是否建议默认勾选：
  - **建议默认勾选**

### 4.5 `set_core`
- 建议取字段：
  - 只取当前 active 版本
  - `title`
  - `core_text`
  - `protagonist_name`
  - `protagonist_identity`
  - `target_story`
  - `rewrite_goal`
  - `constraint_text`
- 组织方式：
  - `【当前核心设定】`
  - 按字段一行行展开
- 是否截断：
  - `core_text` 要截断
- 推荐最大长度：
  - `core_text` 1200~1800
- 是否建议默认勾选：
  - **建议默认勾选**

### 4.6 额外建议：这 5 张表的默认勾选组合
MVP 默认勾选建议：
1. `drama_novels`
2. `drama_source_text`
3. `novel_adaptation_strategy`
4. `adaptation_modes`
5. `set_core`

原因：
- 它们能提供“项目目标 + 原始素材 + 改编策略 + 当前核心设定”
- 比直接把 Step1/Step2 结果表一起默认塞进去更稳定

第二层可选参考：
- `novel_timelines`
- `novel_characters`
- `novel_key_nodes`
- `novel_skeleton_topics`
- `novel_skeleton_topic_items`
- `novel_explosions`

适合在“已有数据基础上二次优化”时勾选。

---

## 5. AI 返回结构 -> 多表落库建议

### 5.1 顶层返回结构建议
MVP 建议一次 AI 返回一个统一 JSON：

```json
{
  "timelines": [],
  "characters": [],
  "keyNodes": [],
  "skeletonTopics": [],
  "explosions": []
}
```

其中：
- `skeletonTopics` 内部再嵌套 `items`

例如：

```json
{
  "skeletonTopics": [
    {
      "topicKey": "political_landscape",
      "topicName": "政治格局",
      "topicType": "list",
      "description": "朝堂与军权结构",
      "items": [
        {
          "itemTitle": "皇权中心",
          "content": "..."
        }
      ]
    }
  ]
}
```

### 5.2 各目标表建议

#### `novel_timelines`
- 最合理 AI 返回结构：
  - 数组
  - 每项：
    - `timeNode`
    - `event`
- 单条还是数组：
  - **数组**
- 字段映射：
  - `timeNode -> time_node`
  - `event -> event`
- 是否先删旧数据再插新数据：
  - MVP **建议先删旧数据再整批插入**
- 是否建议事务整体写入：
  - 是
- 应用层补充：
  - `novel_id`
  - `sort_order`

#### `novel_characters`
- 最合理 AI 返回结构：
  - 数组
  - 每项：
    - `name`
    - `faction`
    - `description`
    - `personality`
    - `settingWords`
- 单条还是数组：
  - **数组**
- 字段映射：
  - `settingWords -> setting_words`
- 是否先删旧数据再插新数据：
  - MVP 建议先删旧数据再插新数据
- 是否建议事务：
  - 是
- 应用层补充：
  - `novel_id`
  - `sort_order`
  - `image_path` 先不填

#### `novel_key_nodes`
- 最合理 AI 返回结构：
  - 数组
  - 每项：
    - `category`
    - `title`
    - `description`
    - `timelineRef`（可选）
- 单条还是数组：
  - **数组**
- 字段映射：
  - `category -> category`
  - `title -> title`
  - `description -> description`
- 是否先删旧数据再插新数据：
  - MVP 建议删旧再插新
- 是否建议事务：
  - 是
- 顺序依赖：
  - 如果要写 `timeline_id`，则必须先写 `novel_timelines`
- 应用层补充：
  - `novel_id`
  - `sort_order`
  - `timeline_id`（通过 `timelineRef` 或匹配得到）

#### `novel_skeleton_topics`
- 最合理 AI 返回结构：
  - 数组
  - 每项：
    - `topicKey`
    - `topicName`
    - `topicType`
    - `description`
    - `items: []`
- 单条还是数组：
  - **数组**
- 是否先删旧数据再插新数据：
  - 对“自动生成结果表”来说，MVP 建议先删旧再插新
- 是否建议事务：
  - 是
- 应用层补充：
  - `novel_id`
  - `sort_order`
  - `is_enabled`

#### `novel_skeleton_topic_items`
- 最合理 AI 返回结构：
  - 不单独作为顶层数组
  - 建议嵌在 `skeletonTopics[].items`
- 单条还是数组：
  - **数组**
- 是否先删旧数据再插新数据：
  - 随父 topic 一起重建
- 是否建议事务：
  - 是
- 顺序依赖：
  - **必须先写 `novel_skeleton_topics`，再写 `novel_skeleton_topic_items`**
- 应用层补充：
  - `novel_id`
  - `topic_id`
  - `sort_order`
  - `source_ref`

#### `novel_explosions`
- 最合理 AI 返回结构：
  - 数组
  - 每项：
    - `explosionType`
    - `title`
    - `subtitle`
    - `sceneRestoration`
    - `dramaticQuality`
    - `adaptability`
    - `timelineRef`（可选）
- 单条还是数组：
  - **数组**
- 是否先删旧数据再插新数据：
  - MVP 建议删旧再插新
- 是否建议事务：
  - 是
- 顺序依赖：
  - 如果要落 `timeline_id`，应先有 `novel_timelines`
- 应用层补充：
  - `novel_id`
  - `sort_order`
  - `timeline_id`

### 5.3 多表落库顺序建议
建议顺序：
1. `novel_timelines`
2. `novel_characters`
3. `novel_key_nodes`
4. `novel_skeleton_topics`
5. `novel_skeleton_topic_items`
6. `novel_explosions`

原因：
- `novel_key_nodes.timeline_id` 依赖 `novel_timelines`
- `novel_skeleton_topic_items.topic_id` 依赖 `novel_skeleton_topics`
- `novel_explosions.timeline_id` 也可能依赖 `novel_timelines`

### 5.4 是否建议整体事务
**强烈建议整体事务。**

建议一个 AI 生成结果的整批写入在一个事务里完成：
- 先删旧数据
- 再按顺序重建
- 任一表失败则全部回滚

---

## 6. AI 自检/纠偏方案建议

### 6.1 一次调用还是两次调用
从产品理想形态看：
- **两次调用更稳**

但从 MVP 成本看：
- **第一版建议先做一次调用 + 后端基础校验**

### 6.2 如果两次调用，第二次校验最适合输入什么
建议输入：
1. 第一次 AI 生成结果 JSON
2. 原始参考资料摘要
3. 明确的校验规则

例如要求校验：
- 时间线是否合理
- 角色是否重复/冲突
- 关键节点是否脱离原始素材
- 骨架主题和爆点是否缺少支撑逻辑

### 6.3 第二次校验最适合输出什么
建议输出：
- 修正后的最终 JSON
- 外加一个简短 `validationNotes`（仅服务端日志使用或调试）

例如：

```json
{
  "correctedResult": { ... },
  "validationNotes": [
    "角色X重复，已合并",
    "关键节点顺序已调整"
  ]
}
```

### 6.4 第二次校验之后，后端如何决定采用结果
更合理的策略是：
- MVP 阶段：直接采用修正后结果
- 未来高级模式：可再加“用户确认”

因为这个功能目标是 Step1/Step2 预处理编排，若每次都强制人工确认，会大幅拉长流程。

### 6.5 MVP 是否应该先不上二次 AI 校验
**是，建议 MVP 先不上二次 AI 校验。**

MVP 建议：
1. 一次生成
2. 后端基础结构校验
3. 事务写入
4. 前端刷新结果

后端基础结构校验至少包括：
- JSON 结构完整性
- 数组字段存在性
- 必填字段非空
- 长度和数量上限
- `topicKey` 去重
- timeline/key node/explosion 的基础字段检查

---

## 7. 最小实现文件清单建议

### 前端
- `apps/web/src/components/PipelinePanel.tsx`
  - 新按钮改为打开 AI 对话框
  - 成功后调用刷新
- `apps/web/src/components/pipeline/PipelineExtractDialog.tsx`
  - 新增
  - 复用 set_core 弹窗模式
- `apps/web/src/lib/pipeline-ai-api.ts`
  - 新增
  - 封装 preview / generate / maybe commit
- `apps/web/src/types/pipeline.ts`
  - 扩展新的请求/响应 DTO

### 后端
- `apps/api/src/pipeline/pipeline.controller.ts`
  - 增加新接口
- `apps/api/src/pipeline/pipeline.service.ts`
  - 或拆出编排 service
- 推荐新增：
  - `apps/api/src/pipeline/dto/extract-skeleton-and-explosions.dto.ts`
  - `apps/api/src/pipeline/pipeline-ai.service.ts` 或 `pipeline-extract.service.ts`

### 可复用但不一定要改
- `apps/api/src/set-core/set-core.service.ts`
  - 可抽共用 AI helper
- `apps/api/src/ai-model-catalog/ai-model-catalog.service.ts`
  - 继续复用模型 options

---

## 8. 风险点清单

1. 多表事务复杂，尤其是 `timeline_id`、`topic_id` 这类外键映射。
2. AI 一次性输出多表 JSON，结构可能不稳定，必须有后端 schema 校验。
3. `drama_source_text` 是长文本，若不截断，prompt 可能过长。
4. `novel_characters`、`novel_explosions` 等已有数据若采用“删旧重建”，需要确认产品是否接受覆盖。
5. 当前外部 AI 接口偶发返回 `text/event-stream`，而现有解析主要按 JSON，一旦复用必须注意这一点。
6. `novel_skeleton_topics` 有唯一键 `(novel_id, topic_key)`，AI 若重复生成 `topicKey`，需要后端先规范化去重。
7. `novel_key_nodes` 与 `novel_explosions` 若需要绑定 timeline，必须先建立应用层 ref 映射，不适合让 AI 直接给数据库 id。

---

## 9. MVP 推荐实现顺序

### 推荐顺序
1. 新增前端 AI 弹窗，复用模型下拉 / 参考表多选 / prompt preview
2. 后端在 `pipeline` 模块新增 preview + generate 接口（先只返回结构化 JSON，不写库）
3. 后端增加基础 schema 校验与事务落库（先一次生成，不上二次 AI 校验）
4. 前端接入“生成并写入后刷新 `loadOverview()`”

### 我最推荐先做的一件事
**先把后端的统一返回 JSON schema 设计定死。**

原因：
- 这是前端弹窗、prompt 设计、后端校验、事务写入的共同基石
- 只要 schema 不稳定，前后端和多表落库都会反复返工

---

## 结论 Top 5

1. 当前前端最适合复用的 AI 弹窗模式就是 `SetCoreEnhanceDialog`，但应该新增平行组件而不是硬复用原组件。
2. 当前后端没有“抽取历史骨架和生成爆点”的现成组合接口，最合适的落点是 `pipeline` 模块。
3. `set_core:enhance` 的模型读取、prompt preview、外部 AI 调用、JSON 解析逻辑都可以复用，但最好抽成共用 helper/service。
4. 多表落库应走单事务，顺序应为 `timelines -> characters -> key_nodes -> skeleton_topics -> skeleton_topic_items -> explosions`。
5. MVP 第一版不建议上“二次 AI 纠偏”，先做一次生成 + 后端基础校验 + 事务写入更稳。
