# Production Layer Implementation Report

## 1. 修改文件清单

### 新增文件

| 文件 | 说明 |
|------|------|
| `apps/api/sql/20260313_create_production_layer_tables.sql` | 5 张生产层表 migration |
| `apps/api/src/pipeline/dto/episode-script-version.dto.ts` | 脚本版本 CRUD DTO |
| `apps/api/src/pipeline/dto/episode-scene.dto.ts` | 场景 CRUD DTO |
| `apps/api/src/pipeline/dto/episode-shot.dto.ts` | 镜头 CRUD DTO |
| `apps/api/src/pipeline/dto/episode-shot-prompt.dto.ts` | 镜头提示词 CRUD DTO |
| `apps/api/src/pipeline/dto/narrator-script.dto.ts` | 旁白脚本生成/持久化 DTO |
| `apps/api/src/pipeline/episode-script-version.service.ts` | 脚本版本 Service |
| `apps/api/src/pipeline/episode-scene.service.ts` | 场景 Service |
| `apps/api/src/pipeline/episode-shot.service.ts` | 镜头 Service |
| `apps/api/src/pipeline/episode-shot-prompt.service.ts` | 镜头提示词 Service |
| `apps/api/src/pipeline/episode-script-production.controller.ts` | 生产层 CRUD Controller |
| `apps/api/src/pipeline/narrator-script.service.ts` | 旁白脚本生成 + draftId/cache/persist |
| `apps/web/src/types/episode-script.ts` | 生产层前端类型 |
| `apps/web/src/lib/episode-script-api.ts` | 生产层 API 客户端 |
| `apps/web/src/app/projects/[novelId]/pipeline/episode-scripts/page.tsx` | Episode Script 列表页路由 |
| `apps/web/src/app/projects/[novelId]/pipeline/episode-scripts/[episodeNumber]/page.tsx` | 单集 Script 详情页路由 |
| `apps/web/src/app/projects/[novelId]/pipeline/episode-scripts/[episodeNumber]/scenes/page.tsx` | Scene Board 路由 |
| `apps/web/src/app/projects/[novelId]/pipeline/episode-scripts/[episodeNumber]/shots/page.tsx` | Shot Board 路由 |
| `apps/web/src/components/production/EpisodeScriptsPage.tsx` | Episode Script 列表页组件 |
| `apps/web/src/components/production/EpisodeScriptDetailPage.tsx` | 单集 Script 详情组件 |
| `apps/web/src/components/production/SceneBoardPage.tsx` | Scene Board 组件 |
| `apps/web/src/components/production/ShotBoardPage.tsx` | Shot Board 组件 |

### 修改文件

| 文件 | 说明 |
|------|------|
| `apps/api/src/pipeline/dto/pipeline-resource.dto.ts` | 新增 `character-visual-profiles` 到 allowedPipelineResources |
| `apps/api/src/pipeline/pipeline-resource.service.ts` | 新增 character_visual_profiles 的 RESOURCE_CONFIG、character_id 校验 |
| `apps/api/src/pipeline/pipeline.controller.ts` | 新增 narrator-script-generate-draft、narrator-script-persist 路由，注入 NarratorScriptService |
| `apps/api/src/pipeline/pipeline.module.ts` | 注册 EpisodeScriptProductionController、4 个 production Service、NarratorScriptService |
| `apps/web/src/types/pipeline-resource.ts` | 新增 PipelineResourceName `character-visual-profiles`、PIPELINE_RESOURCE_CONFIG 配置 |
| `apps/web/src/components/PipelinePanel.tsx` | 新增「Episode Script 工作台」按钮、Step3 模块「7 角色视觉设定」 |
| `apps/web/src/components/episode-compare/EpisodeCompareWorkbench.tsx` | 新增「Open Episode Script Workspace」按钮 |

---

## 2. 新增 5 张表（含字段说明）

见 `apps/api/sql/20260313_create_production_layer_tables.sql`。

- **episode_script_versions**：分集脚本版本（novel_id, episode_number, source_episode_id, version_no, script_type, title, summary, status, is_active）。索引 (novel_id, episode_number, version_no)、(novel_id, episode_number, is_active)。外键 drama_novels(id)。
- **episode_scenes**：分集场景（script_version_id, episode_number, scene_no, scene_title, location_name, scene_summary, main_conflict, narrator_text, screen_subtitle, estimated_seconds, sort_order）。索引 (script_version_id, sort_order)。外键 drama_novels(id)、episode_script_versions(id)。
- **episode_shots**：分集镜头（script_version_id, scene_id, episode_number, shot_no, shot_type, visual_desc, narrator_text, dialogue_text, subtitle_text, duration_sec, camera_movement, emotion_tag, sort_order）。索引 (scene_id, sort_order)。外键 drama_novels(id)、episode_script_versions(id)、episode_scenes(id)。
- **episode_shot_prompts**：镜头提示词（shot_id, prompt_type, prompt_text, negative_prompt, model_name, style_preset）。索引 (shot_id, prompt_type)。外键 drama_novels(id)、episode_shots(id)。
- **character_visual_profiles**：角色视觉设定（character_id, profile_name, age_range, appearance_text, costume_text, hairstyle_text, expression_keywords, style_keywords, negative_keywords, reference_image_path, is_default）。索引 (character_id, is_default)。外键 drama_novels(id)、novel_characters(id)。

---

## 3. 后端 API / DTO / Service / Module 变更

### API 路由

- **Script versions**  
  - `GET /novels/:novelId/episode-script-versions`  
  - `GET /novels/:novelId/episode-script-versions/:episodeNumber`  
  - `POST /novels/:novelId/episode-script-versions`  
  - `PATCH /episode-script-versions/:id`  
  - `POST /episode-script-versions/:id/set-active`  
  - `DELETE /episode-script-versions/:id`
- **Scenes**  
  - `GET /episode-script-versions/:scriptVersionId/scenes`  
  - `POST /episode-script-versions/:scriptVersionId/scenes`  
  - `PATCH /episode-scenes/:id`  
  - `DELETE /episode-scenes/:id`
- **Shots**  
  - `GET /episode-scenes/:sceneId/shots`  
  - `POST /episode-scenes/:sceneId/shots`  
  - `PATCH /episode-shots/:id`  
  - `DELETE /episode-shots/:id`
- **Shot prompts**  
  - `GET /episode-shots/:shotId/prompts`  
  - `POST /episode-shots/:shotId/prompts`  
  - `PATCH /episode-shot-prompts/:id`  
  - `DELETE /episode-shot-prompts/:id`
- **Narrator script**  
  - `POST /pipeline/:novelId/narrator-script-generate-draft`  
  - `POST /pipeline/:novelId/narrator-script-persist`

### DTO

- Create/Update DTO 见 `dto/episode-script-version.dto.ts`、`episode-scene.dto.ts`、`episode-shot.dto.ts`、`episode-shot-prompt.dto.ts`。
- `NarratorScriptGenerateDraftDto`（可选 targetEpisodeCount）、`NarratorScriptPersistDto`（draftId?、draft?）、draft 结构见 `dto/narrator-script.dto.ts`。

### Service

- `EpisodeScriptVersionService`：listByNovel、getByNovelAndEpisode、getOne、create、update、setActive、remove。
- `EpisodeSceneService`：listByScriptVersion、getOne、create、update、remove。
- `EpisodeShotService`：listByScene、getOne、create、update、remove。
- `EpisodeShotPromptService`：listByShot、getOne、create、update、remove。
- `NarratorScriptService`：generateDraft（聚合 episode/structure/hook，规则生成 draft）、persistDraft（draftId 优先，fallback 全量 draft，写 4 张表）。

### Module

- 所有生产层 Controller/Service 均挂在 **PipelineModule**。

---

## 4. 前端路由 / 页面 / 组件变更

### 路由

- `/projects/[novelId]/pipeline/episode-scripts` → Episode Script 列表（生成、保存草稿、按集查看/Scene/Shot）。
- `/projects/[novelId]/pipeline/episode-scripts/[episodeNumber]` → 单集脚本详情（版本列表、当前版本概述、场景列表、跳 Scene/Shot Board）。
- `/projects/[novelId]/pipeline/episode-scripts/[episodeNumber]/scenes` → Scene Board（按版本展示场景，增删改、旁白/字幕/时长等）。
- `/projects/[novelId]/pipeline/episode-scripts/[episodeNumber]/shots` → Shot Board（按场景分组镜头，增删改、画面说明/旁白/对白/时长、提示词展示）。

### 组件

- `EpisodeScriptsPage`：列表、一键生成旁白初稿、保存草稿（draftId）、每集「查看」「Scene Board」「Shot Board」。
- `EpisodeScriptDetailPage`：版本列表、设为当前、当前版本概述与场景列表。
- `SceneBoardPage`：场景列表、内联编辑（scene_title、location_name、narrator_text、screen_subtitle、estimated_seconds）、新增/删除场景。
- `ShotBoardPage`：按场景分组镜头、内联编辑（visual_desc、narrator_text、dialogue_text、duration_sec 等）、提示词只读展示、新增/删除镜头。

---

## 5. 哪些接入了 pipeline resource，哪些没有

- **接入 pipeline resource framework**：仅 **character_visual_profiles**（resource 名 `character-visual-profiles`）。  
  - 后端：`pipeline-resource.dto.ts`、`pipeline-resource.service.ts`（RESOURCE_CONFIG + character_id 校验）。  
  - 前端：`pipeline-resource.ts`（PIPELINE_RESOURCE_CONFIG）、整页路由 `/projects/[novelId]/pipeline/character-visual-profiles`（沿用 `[resource]` 动态路由）。  
  - PipelinePanel Step3 增加「7 角色视觉设定」入口。
- **未接入 pipeline resource（独立 CRUD + 工作台）**：  
  - **episode_script_versions**、**episode_scenes**、**episode_shots**、**episode_shot_prompts** 仅通过 `EpisodeScriptProductionController` 与 4 个 Service 提供 API，前端为 Episode Script / Scene Board / Shot Board 工作台，不做通用 resource 表页。

---

## 6. 旁白主导脚本初稿生成链路说明

1. **输入**：后端直接查库聚合，不依赖 Compare API。  
   - 必查：`novel_episodes`、`drama_structure_template`、`novel_hook_rhythm`（表存在则查）。  
   - 当前实现为规则生成，未再查世界观表；如需可在此处扩展 set_core、set_payoff_*、set_opponents 等。
2. **规则生成**：按 episode_number 对齐三表，每集生成 1 个 script version、1 个 scene、1 个 shot；scene 取 episode_title、opening/outline_content 等；shot 取 visual_desc、narrator_text；prompts 生成 `video_cn`、`video_en`（内容与 visual_desc 一致）。
3. **输出**：`{ draftId, draft: { scripts: [...] } }`，每 script 含 scenes[].shots[].prompts。
4. **持久化**：  
   - `POST /pipeline/:novelId/narrator-script-persist` 支持 `draftId` 或全量 `draft`。  
   - 写入 `episode_script_versions`（按集 deactivate 旧版本后 insert）、`episode_scenes`、`episode_shots`、`episode_shot_prompts`。  
   - 返回 `{ ok: true, summary: { scriptVersions, scenes, shots, prompts } }`。

---

## 7. draftId / cache / persist 如何复用

- **NarratorScriptService** 内实现与现有 Episode Script 类似的 draft 缓存：  
  - `generateDraft` 返回 `draftId`（UUID），并将 `{ novelId, draft, createdAt }` 存入内存 `Map`。  
  - TTL 30 分钟、最大 50 条、写入时清理过期与超量。  
  - `persistDraft` 优先用 `dto.draftId` 从 cache 取 draft；不存在则用 `dto.draft`；两者皆无则报错 `NARRATOR_SCRIPT_DRAFT_REQUIRED` 或 `NARRATOR_SCRIPT_DRAFT_CACHE_MISS`。  
  - 使用 draftId 且 novelId 不一致时报错 `NARRATOR_SCRIPT_DRAFT_ID_NOVEL_MISMATCH`。  
  - 持久化成功后删除该 draftId 缓存。
- **前端**：Episode Script 列表页生成后保存 `draftId`，点击「保存草稿」仅传 `{ draftId }`，不传大 body；未实现 cache miss 时自动 fallback 全量 draft（可后续加）。

---

## 8. Scene Board / Shot Board 交互说明

- **Scene Board**：  
  - 依赖当前集的「当前启用」脚本版本；若无则提示先生成或创建版本。  
  - 列表展示场景序号、标题、地点、旁白摘要、时长；支持「编辑」（内联表单：scene_title、location_name、scene_summary、main_conflict、narrator_text、screen_subtitle、estimated_seconds）、「删除」、「+ 新增场景」。
- **Shot Board**：  
  - 按场景分组展示镜头；每组可「+ 新增镜头」。  
  - 每个镜头展示 shot_no、shot_type、visual_desc 摘要、duration_sec、该 shot 的 prompts 类型列表。  
  - 支持「编辑」（visual_desc、narrator_text、dialogue_text、duration_sec 等）、「删除」。  
  - 提示词为只读展示，未做独立弹窗编辑（可后续扩展）。

---

## 9. 与 Episode Compare / Pipeline 的入口整合

- **Episode Compare**：在 Compare 工作台顶部增加「Open Episode Script Workspace」按钮，跳转 `/projects/[novelId]/pipeline/episode-scripts`。
- **PipelinePanel**：  
  - 在「生成每集纲要和每集剧本」与「Open Episode Compare」旁增加「Episode Script 工作台」按钮，跳转同上。  
  - Step3 增加「7 角色视觉设定」，点击进入 `/projects/[novelId]/pipeline/character-visual-profiles`。

---

## 10. 手工验证步骤

1. **Migration**：在目标库执行 `apps/api/sql/20260313_create_production_layer_tables.sql`，确认 5 张表及外键、索引创建成功。
2. **角色视觉设定**：登录后进入某项目 Pipeline，Step3 点击「7 角色视觉设定」，应进入整页管理；可列表/新增/编辑/删除（需先有 novel_characters）。
3. **Episode Script 列表**：Pipeline 点击「Episode Script 工作台」或 Compare 点击「Open Episode Script Workspace」，进入 episode-scripts 列表；点击「一键生成旁白主导脚本初稿」，应返回草稿并显示保存按钮；点击「保存草稿」应写入 4 张表并刷新列表。
4. **单集详情**：在列表某集点击「查看」，应进入该集脚本详情，可切换版本、查看场景列表，并跳 Scene Board / Shot Board。
5. **Scene Board**：从列表或详情进入某集 scenes，应有场景列表（若已生成则至少 1 个）；可新增、编辑、删除场景。
6. **Shot Board**：从列表或详情进入某集 shots，应按场景分组显示镜头；可新增、编辑、删除镜头；提示词类型列表可见。
7. **API**：用 Postman/curl 调 `GET /novels/:novelId/episode-script-versions`、`POST /pipeline/:novelId/narrator-script-generate-draft`、`POST /pipeline/:novelId/narrator-script-persist`（body: `{ "draftId": "..." }`），确认返回与写入符合预期。

---

## 11. 已知限制 / 后续建议

- **生成逻辑**：当前旁白初稿为规则生成（一集一 scene 一 shot），未调用 LLM；若需「从世界观表聚合 + AI 生成」，可在 NarratorScriptService 内复用 PipelineEpisodeScriptService 的聚合与调用，输出改为 narrator draft 结构。
- **Compare 入口**：未在 Compare 行级增加「生成该集脚本」或「打开该集 Script」的快捷入口；若需要可在一行操作列增加链接带 episodeNumber。
- **Shot prompts 编辑**：Shot Board 仅展示提示词类型，未做弹窗/内联编辑；可后续加「编辑提示词」入口，调用 episode-shot-prompt API。
- **set_core 等世界观表**：生成 draft 时未读取 set_core、set_payoff_* 等；若要做更丰富旁白/镜头描述，可在 generateDraft 内按 novelId 查询并传入规则或 prompt。
- **错误码**：前端未统一解析 `NARRATOR_SCRIPT_DRAFT_CACHE_MISS` 等 code 做友好提示或自动 fallback；可对齐现有 episode-script 的 cache miss 处理。
