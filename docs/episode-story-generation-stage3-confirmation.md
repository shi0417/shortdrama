# Stage 3 实施前确认报告：生成完整短剧故事

## 1. 实际将修改/新增的文件清单

| 类型 | 路径 | 说明 |
|------|------|------|
| **新增** | `apps/api/src/pipeline/dto/episode-story-generation.dto.ts` | Preview/Generate/Persist/Check DTO，allowedEpisodeStoryReferenceTables，class-validator |
| **新增** | `apps/api/src/pipeline/episode-story-generation.service.ts` | previewPrompt、generateDraft、persistDraft、check；Context/Planner/Writer/Merge/Cache |
| **修改** | `apps/api/src/pipeline/pipeline.controller.ts` | 新增 4 个 POST：episode-story-preview-prompt、episode-story-generate-draft、episode-story-persist、episode-story-check |
| **修改** | `apps/api/src/pipeline/pipeline.module.ts` | 注册 EpisodeStoryGenerationService，Controller 注入 |
| **新增** | `apps/web/src/types/episode-story.ts` | EpisodeStoryDraft、请求/响应类型、StoryCheckReportDto、BatchInfo 等 |
| **新增** | `apps/web/src/lib/episode-story-api.ts` | previewPrompt、generateDraft、persistDraft、check 四个 API 调用 |
| **新增** | `apps/web/src/components/story-text/StoryGenerateDialog.tsx` | 高级对话框，模型/核心参考只读/扩展多选/用户说明/allowPromptEdit/Prompt 预览/生成/检查/写入 |
| **修改** | `apps/web/src/components/story-text/StoryTextPanel.tsx` | 全部 state、打开 Dialog、拉模型、刷新预览、生成、持久化、检查、阶段文案、列表刷新 |

**明确不改：**  
- narrator-script.service.ts、episode-script 四表 persist、pipeline-episode-script.service 的 episode-script 逻辑  
- episode_story_versions 表结构及 migration  
- EpisodeStoryVersionService/Controller/dto（仅被本功能 persist 时调用 create）  
- PipelinePanel、PipelineEpisodeScriptDialog

---

## 2. 现有可复用的 API / Service / UI 模式

| 复用项 | 位置 | 用法 |
|--------|------|------|
| **PipelineReferenceContextService** | pipeline-reference-context.service.ts | getContext(novelId, { requestedTables: 核心三表 + referenceTables, optionalTablesCharBudget })、buildNarratorPromptContext 或 buildEpisodeScriptPromptContext、buildReferenceSummary |
| **CORE_REFERENCE_TABLES** | 同上 | novel_episodes、drama_structure_template、novel_hook_rhythm，getContext 时始终包含 |
| **EpisodeStoryVersionService.create** | episode-story-version.service.ts | persist 时每集调用 create(novelId, { episodeNumber, title, summary, storyText, storyType: 'story_text', ... }) |
| **LC API 调用** | pipeline-episode-script.service.ts | getLcApiEndpoint、getLcApiKey、fetch POST JSON、extractAiText、parseJsonObjectFromText；本服务内自实现同风格方法 |
| **Draft Cache** | pipeline-episode-script.service.ts | Map + TTL 30min + 上限 50、generateDraftId（randomUUID）、cacheDraft、getCachedDraft、cleanExpiredDrafts、enforceDraftCacheLimit |
| **PipelineEpisodeScriptDialog** | PipelineEpisodeScriptDialog.tsx | 布局与表单项结构、模型 select、参考多选、用户说明、allowPromptEdit、Prompt textarea、草稿/批次状态、取消/生成/写入按钮、generatingPhase 展示 |
| **pipelineAiApi.listAiModelOptions** | pipeline-ai-api.ts | 前端拉模型列表，GET /ai-model-catalog/options |
| **PipelineController** | pipeline.controller.ts | 路由风格 POST `:novelId/xxx`，Body DTO，JwtAuthGuard |

---

## 3. 可能冲突点

- **路由命名**：与现有 episode-script、narrator-script 并列，路径为 episode-story-*，无重叠。  
- **referenceTables 语义**：前端传「扩展参考表」列表，后端 getContext 的 requestedTables = CORE_REFERENCE_TABLES + referenceTables；与 episode-script 一致。  
- **EpisodeStoryPersistDto.draft**：若用 class-validator，draft 为嵌套对象，需用 @ValidateNested 或 @IsObject() 放宽；Persist 响应接口与 DTO 分开定义在 dto 文件中。  
- **check 端点**：draftId 与 draft 二选一或与 versionIds 三选一，校验逻辑在 service 内统一处理。  
- **前端 state**：全部在 StoryTextPanel，不与其他 Tab 共享，无冲突。

---

## 4. 实施顺序（严格按此执行）

1. DTO + 后端占位路由  
2. EpisodeStoryGenerationService skeleton  
3. Context + Planner  
4. Writer 分批 + Merge + Cache  
5. Persist 写库  
6. 前端 API + 类型  
7. StoryGenerateDialog  
8. StoryTextPanel 对接  
9. 阶段状态文案  
10. AI 检查  

---

*确认完成后开始编码。*
