# Pipeline Second AI Review Audit Report

## 审计范围

本次为只读审计，未修改业务代码、未写数据库、未新增 migration、未提交 commit。

审计目标：

- 为 `/projects -> Pipeline` 页面在 Step3 上方新增“二次AI自检”按钮做现状摸底
- 评估前端最小插入点、弹窗复用方案、后端最佳落点
- 核对 11 张相关表结构与行数
- 重点判断“修改说明/修正记录”应如何保存

---

## 基线

### 构建验证

后端：

```text
pnpm --dir apps/api build
=> 通过
```

前端：

```text
pnpm --dir apps/web build
=> 通过
```

### 数据库行数（只读）

```text
drama_novels               1
drama_source_text          1
novel_adaptation_strategy  1
adaptation_modes           3
set_core                   1
novel_timelines           11
novel_characters           8
novel_key_nodes            5
novel_skeleton_topics      2
novel_skeleton_topic_items 9
novel_explosions           4
```

---

## 一、文件链路

## 1. 前端链路

`/projects -> Pipeline` 当前链路：

- `apps/web/src/app/projects/page.tsx`
- `apps/web/src/components/ProjectDetail.tsx`
- `apps/web/src/components/PipelinePanel.tsx`

当前两个相关 AI 弹窗：

- `apps/web/src/components/pipeline/SetCoreEnhanceDialog.tsx`
- `apps/web/src/components/pipeline/PipelineExtractDialog.tsx`

相关前端 API：

- `apps/web/src/lib/set-core-api.ts`
- `apps/web/src/lib/pipeline-ai-api.ts`
- `apps/web/src/lib/api.ts`

相关前端类型：

- `apps/web/src/types/pipeline.ts`

## 2. 后端链路

当前与预处理 AI 相关链路：

- `apps/api/src/pipeline/pipeline.controller.ts`
- `apps/api/src/pipeline/pipeline-extract.service.ts`
- `apps/api/src/pipeline/pipeline.service.ts`
- `apps/api/src/ai-model-catalog/ai-model-catalog.controller.ts`
- `apps/api/src/ai-model-catalog/ai-model-catalog.service.ts`

可参考的另一套 AI 链路：

- `apps/api/src/set-core/set-core.controller.ts`
- `apps/api/src/set-core/set-core.service.ts`

---

## 二、前端现状审计

## A1. `/projects -> Pipeline` 最终主组件

最终主组件是：

- `apps/web/src/components/PipelinePanel.tsx`

## A2. 现在“抽取历史骨架和生成爆点”按钮的位置

最关键 JSX 位于 `PipelinePanel.tsx` 中，位置是：

- Step2 卡片结束之后
- Step3 卡片开始之前
- 当前是一个独立 sibling 操作区

原样摘录：

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

### 前端最佳插入位置结论

如果新增“二次AI自检”，**最佳位置仍然是 `PipelinePanel.tsx` 里这个预处理操作区**：

- 最小改动方案：直接把右侧单按钮改成按钮组
- 例如：`抽取历史骨架和生成爆点` + `二次AI自检`

不建议把它塞进 Step3 header，因为当前“预处理操作”已经明确是独立区域。

## A3. 当前按钮绑定函数

```ts
const handlePreStep3Action = () => {
  void handleOpenExtractDialog()
}
```

也就是说当前按钮点击后，实际打开的是 `PipelineExtractDialog`。

## A4. 当前“抽取历史骨架和生成爆点”弹窗组件

组件名：

- `PipelineExtractDialog`

文件：

- `apps/web/src/components/pipeline/PipelineExtractDialog.tsx`

主要 props：

```ts
interface PipelineExtractDialogProps {
  open: boolean
  models: AiModelOptionDto[]
  loading: boolean
  submitting: boolean
  selectedModelKey: string
  userInstruction: string
  referenceTables: PipelineExtractReferenceTable[]
  allowPromptEdit: boolean
  promptPreview: string
  fontSize: number
  onClose: () => void
  onChangeModelKey: (value: string) => void
  onChangeUserInstruction: (value: string) => void
  onToggleReferenceTable: (table: PipelineExtractReferenceTable) => void
  onChangeAllowPromptEdit: (value: boolean) => void
  onChangePromptPreview: (value: string) => void
  onRefreshPromptPreview: () => void
  onChangeFontSize: (value: number) => void
  onSubmit: () => void
}
```

其主要 state 在 `PipelinePanel.tsx`：

```ts
const [extractDialogOpen, setExtractDialogOpen] = useState(false)
const [extractModels, setExtractModels] = useState<AiModelOptionDto[]>([])
const [extractLoading, setExtractLoading] = useState(false)
const [extractSubmitting, setExtractSubmitting] = useState(false)
const [extractReferenceTables, setExtractReferenceTables] =
  useState<PipelineExtractReferenceTable[]>(defaultExtractReferenceTables)
const [extractPromptPreview, setExtractPromptPreview] = useState('')
const [extractAllowPromptEdit, setExtractAllowPromptEdit] = useState(false)
const [extractUserInstruction, setExtractUserInstruction] = useState('')
const [extractSelectedModelKey, setExtractSelectedModelKey] = useState('')
const [extractFontSize, setExtractFontSize] = useState(14)
const [extractRefreshKey, setExtractRefreshKey] = useState(0)
```

## A5. 当前 set_core 的 AI 弹窗组件

组件名：

- `SetCoreEnhanceDialog`

文件：

- `apps/web/src/components/pipeline/SetCoreEnhanceDialog.tsx`

主要 props：

```ts
interface SetCoreEnhanceDialogProps {
  open: boolean
  models: AiModelOptionDto[]
  loading: boolean
  submitting: boolean
  saveBehaviorDescription: string
  selectedModelKey: string
  userInstruction: string
  referenceTables: string[]
  allowPromptEdit: boolean
  promptPreview: string
  onClose: () => void
  onChangeModelKey: (value: string) => void
  onChangeUserInstruction: (value: string) => void
  onToggleReferenceTable: (table: string) => void
  onChangeAllowPromptEdit: (value: boolean) => void
  onChangePromptPreview: (value: string) => void
  onRefreshPromptPreview: () => void
  onSubmit: () => void
}
```

其主要 state 也在 `PipelinePanel.tsx`：

```ts
const [setCoreEnhanceDialogOpen, setSetCoreEnhanceDialogOpen] = useState(false)
const [enhanceModels, setEnhanceModels] = useState<AiModelOptionDto[]>([])
const [enhanceLoading, setEnhanceLoading] = useState(false)
const [enhanceSubmitting, setEnhanceSubmitting] = useState(false)
const [enhanceReferenceTables, setEnhanceReferenceTables] = useState<string[]>(...)
const [enhancePromptPreview, setEnhancePromptPreview] = useState('')
const [enhanceAllowPromptEdit, setEnhanceAllowPromptEdit] = useState(false)
const [enhanceUserInstruction, setEnhanceUserInstruction] = useState('')
const [enhanceSelectedModelKey, setEnhanceSelectedModelKey] = useState('')
```

## A6. 哪些逻辑最适合复用到“二次AI自检”

### 最适合直接复用的交互模式

来自 `PipelineExtractDialog`：

- 模型下拉
- 参考表多选
- prompt preview
- allow edit prompt
- 字体大小切换
- loading / submitting
- 弹窗整体布局

来自 `SetCoreEnhanceDialog`：

- 更轻量的 prompt 展开/收起模式
- “生成并回填 / AI 纠偏”这类语义更贴近“自检修正”而不是“首轮生成”

### 建议复用方式

不建议直接复用现有两个组件本体，而建议：

- 新建一个平行组件
- 复用它们的 props 结构、交互节奏和样式写法

## A7. 最适合新增的前端组件文件

推荐：

- `apps/web/src/components/pipeline/PipelineSecondReviewDialog.tsx`

理由：

1. 语义上与 `PipelineExtractDialog.tsx` 平级
2. 同属 Step3 上方预处理动作
3. 不污染 `SetCoreEnhanceDialog.tsx`
4. 更便于把“检测对象表”和“参考资料表”拆成两块 UI

## A8. 当前成功写入后的刷新函数

当前成功写入后刷新 Step1 / Step2 的核心函数是：

- `loadOverview()`

相关代码：

```ts
const loadOverview = async () => {
  const data = await api.getPipelineOverview(novelId)
  setTimelines(data.timelines || [])
  setCharacters(data.characters || [])
  setKeyNodes(data.keyNodes || [])
  setExplosions(data.explosions || [])
  setWorldview(data.worldview || ...)
}
```

此外，若要刷新 `SkeletonTopicsPanel` 中的 items，当前还会触发：

- `setExtractRefreshKey((prev) => prev + 1)`

## A9. 二次AI自检成功后的最小刷新链路建议

建议完全复用当前 extract 成功后的最小链路：

1. `await loadOverview()`
2. `setExtractRefreshKey((prev) => prev + 1)`  
   更稳的实现建议是后续把它改名为通用的 `pipelineRefreshKey`
3. 关闭“二次AI自检”弹窗

---

## 三、后端现状审计

## B1. 当前“抽取历史骨架和生成爆点”接口

位于 `apps/api/src/pipeline/pipeline.controller.ts`：

```ts
@Post(':novelId/extract-preview-prompt')
previewExtractPrompt(...) {
  return this.pipelineExtractService.previewPrompt(novelId, dto);
}

@Post(':novelId/extract-and-generate')
extractAndGenerate(...) {
  return this.pipelineExtractService.extractAndGenerate(novelId, dto);
}
```

当前已有接口：

- `POST /pipeline/:novelId/extract-preview-prompt`
- `POST /pipeline/:novelId/extract-and-generate`

## B2. 这些接口所在位置

- controller：`apps/api/src/pipeline/pipeline.controller.ts`
- service：`apps/api/src/pipeline/pipeline-extract.service.ts`

## B3. 当前 AI 调用、prompt preview、模型读取、JSON 解析能力在哪里

### 模型读取

文件：

- `apps/api/src/ai-model-catalog/ai-model-catalog.service.ts`

方法：

```ts
async listOptions(): Promise<AiModelCatalogOptionRow[]> {
  return this.dataSource.query(`
    SELECT ...
    FROM ai_model_catalog
    WHERE is_active = 1
    ORDER BY ...
  `);
}
```

对应接口：

- `GET /ai-model-catalog/options`

### Prompt Preview

文件：

- `apps/api/src/pipeline/pipeline-extract.service.ts`

方法：

- `previewPrompt(...)`
- `buildPrompt(...)`
- `buildReferenceBlocks(...)`
- `buildSkeletonTopicDefinitionBlock(...)`

### AI 调用

文件：

- `apps/api/src/pipeline/pipeline-extract.service.ts`

方法：

- `getLcApiEndpoint()`
- `getLcApiKey()`
- `callLcAiApi(...)`

### JSON 解析

文件：

- `apps/api/src/pipeline/pipeline-extract.service.ts`

方法：

- `extractAiText(...)`
- `parseJsonObjectFromText(...)`
- `parsePossiblyDirtyJson(...)`
- `normalizeJsonLikeText(...)`

### 统一 schema 校验

方法：

- `validateAndNormalizeAiResult(...)`

### 多表事务写入

方法：

- `persistGeneratedData(...)`

## B4. 哪些能力适合直接复用到“二次AI自检”

最适合复用：

1. `resolveModelKey(...)`
2. `buildReferenceBlocks(...)`
3. `buildSkeletonTopicDefinitionBlock(...)`
4. `callLcAiApi(...)`
5. `extractAiText(...)`
6. `parseJsonObjectFromText(...)`
7. `validateAndNormalizeAiResult(...)`
8. `persistGeneratedData(...)`

### 需要新增但不建议硬塞进现有 extract 主方法的能力

“二次AI自检”额外需要：

1. 读取**当前已生成结果表**作为“检测对象输入”
2. 组装“当前结果 + 参考资料 + 规则”的 review prompt
3. 返回 `reviewNotes`
4. 可能区分“检测对象表”与“参考资料表”

这些都和“首轮抽取生成”语义不同。

## B5. 当前是否已有 `reviewNotes / qualityMode / second pass / reviewer prompt`

检索结果：

- 当前代码中**没有现成的**：
  - `reviewNotes`
  - `review_notes`
  - `qualityMode`
  - `quality_mode`
  - `second pass`
  - `second_pass`
  - reviewer / 二次review / 自检 相关能力

结论：

- “二次AI自检”目前在后端是一个全新能力
- 但可以建立在 `pipeline-extract.service.ts` 已有能力之上

## B6. 后端最佳落点推荐

### 明确推荐

推荐新建：

- `apps/api/src/pipeline/pipeline-review.service.ts`

并在现有：

- `apps/api/src/pipeline/pipeline.controller.ts`

中新增 review 相关接口。

### 不推荐的方式

不建议把二次AI自检全部继续堆进 `pipeline-extract.service.ts`，原因：

1. extract 是“从参考资料首轮生成结构化结果”
2. review 是“从当前已生成结果出发，做二次纠偏”
3. 两者共享底层 AI / parse / validate / persist 工具，但 orchestration 语义不同

### 最佳结构建议

- `pipeline-extract.service.ts`
  - 保持一轮生成
- `pipeline-review.service.ts`
  - 负责二次AI自检
- 共享底层 helper
  - 初期可以先抽到 `pipeline-extract.service.ts` 的私有转受保护方法不方便
  - 更稳的后续方式是抽一个 `pipeline-ai-shared.service.ts`

但若追求最小实现，第一版也可先让 `pipeline-review.service.ts` 内部复用少量 helper 代码。

---

## 四、数据库只读核对结果

## C1. 表存在与行数

| 表名 | 是否存在 | 行数 |
|---|---|---:|
| `drama_novels` | 是 | 1 |
| `drama_source_text` | 是 | 1 |
| `novel_adaptation_strategy` | 是 | 1 |
| `adaptation_modes` | 是 | 3 |
| `set_core` | 是 | 1 |
| `novel_timelines` | 是 | 11 |
| `novel_characters` | 是 | 8 |
| `novel_key_nodes` | 是 | 5 |
| `novel_skeleton_topics` | 是 | 2 |
| `novel_skeleton_topic_items` | 是 | 9 |
| `novel_explosions` | 是 | 4 |

## C2. SHOW CREATE TABLE 原样

### `drama_novels`

```sql
CREATE TABLE `drama_novels` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '…',
  `novels_name` varchar(100) NOT NULL COMMENT '…',
  `description` text,
  `total_chapters` int DEFAULT '0',
  `power_up_interval` int DEFAULT '5',
  `author` varchar(50) DEFAULT NULL,
  `status` tinyint DEFAULT '0',
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `theme_id` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_drama_novels_theme_id` (`theme_id`),
  CONSTRAINT `fk_drama_novels_theme` FOREIGN KEY (`theme_id`) REFERENCES `ai_short_drama_theme` (`id`) ON DELETE SET NULL ON UPDATE RESTRICT
) ENGINE=InnoDB ...
```

### `drama_source_text`

```sql
CREATE TABLE `drama_source_text` (
  `id` int NOT NULL AUTO_INCREMENT,
  `novels_id` int NOT NULL,
  `source_text` longtext,
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_source_novels` (`novels_id`),
  CONSTRAINT `fk_source_novels` FOREIGN KEY (`novels_id`) REFERENCES `drama_novels` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB ...
```

### `novel_adaptation_strategy`

```sql
CREATE TABLE `novel_adaptation_strategy` (
  `id` int NOT NULL AUTO_INCREMENT,
  `novel_id` int NOT NULL,
  `mode_id` int NOT NULL,
  `strategy_title` varchar(200) DEFAULT NULL,
  `strategy_description` longtext,
  `ai_prompt_template` longtext,
  `version` int DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_adaptation_novel` (`novel_id`),
  KEY `fk_adaptation_mode` (`mode_id`),
  CONSTRAINT `fk_adaptation_mode` FOREIGN KEY (`mode_id`) REFERENCES `adaptation_modes` (`id`),
  CONSTRAINT `fk_adaptation_novel` FOREIGN KEY (`novel_id`) REFERENCES `drama_novels` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB ...
```

### `adaptation_modes`

```sql
CREATE TABLE `adaptation_modes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `mode_key` varchar(50) NOT NULL,
  `mode_name` varchar(100) NOT NULL,
  `description` text,
  `is_active` tinyint DEFAULT '1',
  `sort_order` int DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `mode_key` (`mode_key`)
) ENGINE=InnoDB ...
```

### `set_core`

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
) ENGINE=InnoDB ...
```

### `novel_timelines`

```sql
CREATE TABLE `novel_timelines` (
  `id` int NOT NULL AUTO_INCREMENT,
  `novel_id` int NOT NULL,
  `time_node` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `event` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `sort_order` int DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_novel_sort` (`novel_id`,`sort_order`),
  CONSTRAINT `fk_novel_timelines_novel_id_drama_novels` FOREIGN KEY (`novel_id`) REFERENCES `drama_novels` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB ...
```

### `novel_characters`

```sql
CREATE TABLE `novel_characters` (
  `id` int NOT NULL AUTO_INCREMENT,
  `novel_id` int NOT NULL,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `faction` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `personality` text COLLATE utf8mb4_unicode_ci,
  `setting_words` text COLLATE utf8mb4_unicode_ci,
  `image_path` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sort_order` int DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_novel_faction` (`novel_id`,`faction`),
  CONSTRAINT `fk_novel_characters_novel_id_drama_novels` FOREIGN KEY (`novel_id`) REFERENCES `drama_novels` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB ...
```

### `novel_key_nodes`

```sql
CREATE TABLE `novel_key_nodes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `novel_id` int NOT NULL,
  `timeline_id` int DEFAULT NULL,
  `category` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` longtext COLLATE utf8mb4_unicode_ci,
  `sort_order` int DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_novel_category` (`novel_id`,`category`),
  KEY `fk_novel_key_nodes_timeline_id_novel_timelines` (`timeline_id`),
  CONSTRAINT `fk_novel_key_nodes_novel_id_drama_novels` FOREIGN KEY (`novel_id`) REFERENCES `drama_novels` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_novel_key_nodes_timeline_id_novel_timelines` FOREIGN KEY (`timeline_id`) REFERENCES `novel_timelines` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB ...
```

### `novel_skeleton_topics`

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
) ENGINE=InnoDB ...
```

### `novel_skeleton_topic_items`

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
) ENGINE=InnoDB ...
```

### `novel_explosions`

```sql
CREATE TABLE `novel_explosions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `novel_id` int NOT NULL,
  `timeline_id` int DEFAULT NULL,
  `explosion_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `subtitle` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `scene_restoration` text COLLATE utf8mb4_unicode_ci,
  `dramatic_quality` text COLLATE utf8mb4_unicode_ci,
  `adaptability` text COLLATE utf8mb4_unicode_ci,
  `sort_order` int DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_novel_type` (`novel_id`,`explosion_type`),
  KEY `idx_explosions_timeline_id` (`timeline_id`),
  CONSTRAINT `fk_novel_explosions_novel_id_drama_novels` FOREIGN KEY (`novel_id`) REFERENCES `drama_novels` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_novel_explosions_timeline_id_novel_timelines` FOREIGN KEY (`timeline_id`) REFERENCES `novel_timelines` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB ...
```

## C3. 哪些字段适合作为“检测对象表”输入

### `novel_timelines`

- 适合作为检测输入：
  - `time_node`
  - `event`
  - `sort_order`

### `novel_characters`

- 适合作为检测输入：
  - `name`
  - `faction`
  - `description`
  - `personality`
  - `setting_words`

### `novel_key_nodes`

- 适合作为检测输入：
  - `category`
  - `title`
  - `description`
  - `timeline_id`
  - `sort_order`

### `novel_skeleton_topic_items`

- 适合作为检测输入：
  - `topic_id`
  - `item_title`
  - `content`
  - `content_json`
  - `source_ref`
  - `sort_order`

### `novel_explosions`

- 适合作为检测输入：
  - `explosion_type`
  - `title`
  - `subtitle`
  - `scene_restoration`
  - `dramatic_quality`
  - `adaptability`
  - `timeline_id`

## C4. 哪些字段适合作为参考 prompt 输入

### 参考资料表

- `drama_novels`
  - `novels_name`
  - `description`
  - `total_chapters`
  - `power_up_interval`
  - `author`

- `drama_source_text`
  - `source_text`

- `novel_adaptation_strategy`
  - `strategy_title`
  - `strategy_description`
  - `ai_prompt_template`
  - `version`

- `adaptation_modes`
  - `mode_key`
  - `mode_name`
  - `description`

- `set_core`
  - `title`
  - `core_text`
  - `protagonist_name`
  - `protagonist_identity`
  - `target_story`
  - `rewrite_goal`
  - `constraint_text`

### 系统自动补充

- `novel_skeleton_topics`
  - `topic_key`
  - `topic_name`
  - `topic_type`
  - `description`
  - `is_enabled`

## C5. 哪些字段是短字段、容易超长报错

### 明显高风险短字段

- `drama_novels.novels_name` `varchar(100)`
- `drama_novels.author` `varchar(50)`
- `novel_adaptation_strategy.strategy_title` `varchar(200)`
- `adaptation_modes.mode_key` `varchar(50)`
- `adaptation_modes.mode_name` `varchar(100)`
- `set_core.title` `varchar(255)`
- `set_core.protagonist_name` `varchar(100)`
- `set_core.protagonist_identity` `varchar(255)`
- `set_core.target_story` `varchar(100)`
- `set_core.rewrite_goal` `varchar(255)`
- `set_core.constraint_text` `varchar(255)`
- `novel_timelines.time_node` `varchar(100)`
- `novel_characters.name` `varchar(100)`
- `novel_characters.faction` `varchar(50)`
- `novel_key_nodes.category` `varchar(50)`
- `novel_key_nodes.title` `varchar(255)`
- `novel_skeleton_topics.topic_key` `varchar(64)`
- `novel_skeleton_topics.topic_name` `varchar(100)`
- `novel_skeleton_topic_items.item_title` `varchar(255)`
- `novel_skeleton_topic_items.source_ref` `varchar(255)`
- `novel_explosions.explosion_type` `varchar(50)`
- `novel_explosions.title` `varchar(255)`
- `novel_explosions.subtitle` `varchar(255)`

## C6. 哪些字段若要保存“修正说明/修改记录”，现有结构是否适合直接扩展

### 结论先行

**现有业务表结构都不适合作为“批次级 review 说明”的主落点。**

原因：

1. 当前 `overview` 和页面展示大量直接读业务表原始结果。
2. 二次AI自检是一次可能跨多表、多行、整批覆盖写回的批次行为。
3. “修改说明”包含的元信息通常是：
   - 哪次 review
   - 用了哪个模型
   - 检测了哪些表
   - 参考了哪些表
   - prompt / prompt hash
   - summary / warnings / reviewNotes
   - 本次改动影响了哪些行
4. 这些信息不是单条 timeline / 单条 character / 单条 explosion 的自然属性。

---

## 五、审计重点：修改说明如何保存

## D1. 方案比较

### 方案 A：每张业务表加一个大字段

例如：

- `revision_notes_json`
- `review_notes_json`

#### 缺点

1. 业务表被迫承载批次级元信息，不自然。
2. 一次 review 会同时改很多行，批次信息会重复灌到多条记录里，冗余严重。
3. 当前 `PipelineService.getOverview()` 大量直接 `select *` 读业务表，给每张表塞大字段会增加查询负担。
4. 后续多轮 review 历史难管理：
   - 是覆盖？
   - 还是数组累计？
5. 一次 review 涉及多张表时，无法自然表达“这一次 review 的整体上下文”。

### 方案 B：独立日志表

例如：

- `pipeline_ai_review_logs`

#### 优点

1. 更符合“批次审计日志”的语义。
2. 可以自然保存：
   - `novel_id`
   - `review_type`
   - `model_key`
   - `target_tables_json`
   - `reference_tables_json`
   - `prompt_preview`
   - `review_notes`
   - `warnings_json`
   - `summary_json`
   - `created_at`
3. 不污染当前业务表和 `overview` 查询。
4. 更适合追踪多次历史修正。
5. 更适合一批次同时修改很多条记录的场景。

### 方案 C：A+B 混合

例如：

- 主日志落独立表
- 业务表只留一个很轻的 `last_review_log_id`

#### 评价

这是未来可扩展方案，但**不适合作为第一步最小实现**。  
当前系统没有这类关联设计，第一版会增加额外复杂度。

## D2. 结合当前系统特点的判断

### 当前系统特点

1. 页面查询目前偏“直接读取业务表内容”。
2. 预处理动作本身是批次式覆盖写回，不是单条编辑。
3. 未来很可能需要多次 review 历史。
4. “二次AI自检”天然需要记录批次上下文，而不是单条字段注释。

## D3. 明确推荐结论

### 最终推荐：方案 B

**推荐新建独立日志表，例如 `pipeline_ai_review_logs`，不要直接在 5 张业务表上加大字段作为主方案。**

### 一句话理由

因为“二次AI自检”的修改说明本质上是**批次级、多表级、可追溯的审计数据**，不是单条业务记录本身的自然属性。

### 如果以后需要更细粒度

可在第二阶段考虑：

- `pipeline_ai_review_logs`
- `pipeline_ai_review_log_items`

其中：

- 主表存批次元信息
- 明细表存每张目标表/每条记录的变化摘要

但第一版最小实现可以只做主日志表。

---

## 六、“二次AI自检”统一返回 JSON schema 建议

## E1. 后端内部 AI 输出 schema 建议

建议保持与当前 `extract-and-generate` 相同的目标结构，降低复用成本：

```json
{
  "timelines": [
    { "timeNode": "string", "event": "string" }
  ],
  "characters": [
    {
      "name": "string",
      "faction": "string",
      "description": "string",
      "personality": "string",
      "settingWords": "string"
    }
  ],
  "keyNodes": [
    {
      "category": "string",
      "title": "string",
      "description": "string",
      "timelineRef": "string"
    }
  ],
  "skeletonTopicItems": [
    {
      "topicKey": "string",
      "items": [
        {
          "itemTitle": "string",
          "content": "string",
          "contentJson": null,
          "sourceRef": "string"
        }
      ]
    }
  ],
  "explosions": [
    {
      "explosionType": "string",
      "title": "string",
      "subtitle": "string",
      "sceneRestoration": "string",
      "dramaticQuality": "string",
      "adaptability": "string",
      "timelineRef": "string"
    }
  ],
  "reviewNotes": [
    {
      "table": "novel_characters",
      "issue": "string",
      "fix": "string"
    }
  ]
}
```

### 说明

1. 结果表结构继续复用当前 extract 的统一 schema，便于直接复用 `validateAndNormalizeAiResult()` 和 `persistGeneratedData()`
2. 新增 `reviewNotes` 仅作为 review 说明输出，不直接写业务表

## E2. 前后端接口返回 schema 建议

建议接口响应：

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
  "reviewNotes": [
    "发现人物 faction 过长并已压缩",
    "修正了 1 条未命中 topicKey 的骨架主题项"
  ],
  "warnings": [
    "subtitle 超长已截断"
  ]
}
```

---

## 七、最小实现文件清单建议

## 前端

推荐最小新增/改动：

- `apps/web/src/components/PipelinePanel.tsx`
- `apps/web/src/components/pipeline/PipelineSecondReviewDialog.tsx`（新）
- `apps/web/src/lib/pipeline-review-api.ts`（新）
- `apps/web/src/types/pipeline-review.ts`（新）  
  如果想最小，也可先继续合并在 `types/pipeline.ts`

## 后端

推荐最小新增/改动：

- `apps/api/src/pipeline/pipeline.controller.ts`
- `apps/api/src/pipeline/pipeline-review.service.ts`（新）
- `apps/api/src/pipeline/dto/pipeline-review.dto.ts`（新）
- `apps/api/src/pipeline/pipeline.module.ts`

## 可选 migration

如果要保存 review 日志，**推荐新增独立日志表 migration**，而不是改现有业务表：

- 可选新表：
  - `pipeline_ai_review_logs`

---

## 八、UI 布局建议

## 1. 按钮位置

推荐直接放在当前“预处理操作”区右侧按钮组中：

- `抽取历史骨架和生成爆点`
- `二次AI自检`

## 2. 弹窗布局

推荐与 `PipelineExtractDialog` 平行：

1. 标题：`二次AI自检`
2. AI 模型下拉
3. 检测对象表多选
4. 参考资料表多选
5. 提示文案：
   - 系统自动补充启用中的 `novel_skeleton_topics`
6. 用户附加要求
7. 允许编辑 prompt
8. Prompt 预览
9. 按钮：
   - 取消
   - 刷新 Prompt 预览
   - 执行二次AI自检/纠偏

## 3. 检测对象表建议单独一块

因为它和“参考资料表”语义不同，不建议混在一起。

---

## 九、后端 service 组织建议

## 明确推荐

### 第一层

- `pipeline.controller.ts`
  - 新增：
    - `POST /pipeline/:novelId/review-preview-prompt`
    - `POST /pipeline/:novelId/review-and-correct`

### 第二层

- `pipeline-review.service.ts`
  - 负责：
    - 读取当前结果表
    - 读取参考资料
    - 组装 review prompt
    - 调 AI
    - 解析 review JSON
    - 复用现有 validate / persist 写回
    - 返回 `summary + reviewNotes + warnings`

### 第三层（复用/共享能力）

可直接复用现有：

- 模型校验
- reference block 组装
- skeleton topic 约束
- AI 调用
- JSON 解析
- schema 校验
- 多表事务写入

---

## 十、是否建议做“快速模式 / 高质量模式”

## 当前代码现状判断

### 当前更适合先做

**快速模式（一次）**

理由：

1. 当前已有的是单轮 AI orchestration
2. 当前没有 job / queue / 多阶段 review 状态管理
3. 当前前端弹窗和后端接口都偏同步一次性返回

### 不建议第一版直接做

**高质量模式（二次review串两轮）**

理由：

1. 需要更复杂的 prompt orchestration
2. 需要更多状态返回
3. 需要更细日志和失败恢复
4. 当前代码基础可以承接，但不是最小实现路径

### 建议

第一版先做：

- `qualityMode = quick`

第二版再扩展：

- `qualityMode = high`

但第一版接口 DTO 就可以预留：

- `qualityMode?: 'quick' | 'high'`

---

## 最终结论 Top 10

1. `/projects -> Pipeline` 的最终主组件是 `apps/web/src/components/PipelinePanel.tsx`。
2. “抽取历史骨架和生成爆点”当前已经位于最佳预处理区域：Step2 之后、Step3 之前。
3. “二次AI自检”最合适的前端插入点，就是当前 `PipelinePanel.tsx` 里的预处理操作区按钮组。
4. 最合适的新前端组件名是 `PipelineSecondReviewDialog.tsx`，不建议硬复用现有两个弹窗本体。
5. 模型下拉、参考表多选、prompt preview、allow edit prompt、loading/submitting、字体大小切换，都可以直接沿用 `PipelineExtractDialog` 的交互模式。
6. 成功后刷新页面数据的最小链路应复用 `loadOverview()`，并同时触发 `SkeletonTopicsPanel` 刷新 key。
7. 后端最适合新增“二次AI自检”的落点不是继续堆进 `pipeline-extract.service.ts`，而是新建 `pipeline-review.service.ts`。
8. 当前后端已经具备模型读取、AI 调用、JSON 解析、schema 校验、多表事务写回等核心基础能力，二次AI自检无需重造底层轮子。
9. 当前代码中没有现成的 `reviewNotes / qualityMode / second pass / reviewer prompt` 能力，需要新建。
10. “修改说明/修正记录”的最终推荐方案是：**不要直接加到 5 张业务表里，优先新建独立日志表，例如 `pipeline_ai_review_logs`。**

---

## 最终推荐（一句话版）

如果现在立刻实现：

- 前端：在 `PipelinePanel.tsx` 的预处理操作区新增按钮，配套新组件 `PipelineSecondReviewDialog.tsx`
- 后端：在 `pipeline` 模块下新增 `pipeline-review.service.ts`
- 记录方案：优先独立日志表 `pipeline_ai_review_logs`
