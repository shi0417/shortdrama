# Narrator Script LLM Upgrade Report

## 1. 修改文件清单

### 后端 (apps/api)

| 文件 | 变更说明 |
|------|----------|
| `scripts/run-production-migration.js` | 新增：执行生产层 SQL 的 Node 脚本 |
| `scripts/verify-production-tables.js` | 新增：验证 5 张生产层表是否存在 |
| `package.json` | 新增脚本：`db:migrate:production`、`db:verify:production` |
| `src/pipeline/narrator-script.service.ts` | **重写**：规则生成改为 LLM 聚合生成，聚合世界观表，默认 3~5 scene / 2~4 shot，JSON 解析与归一化 |
| `src/pipeline/episode-script-version.service.ts` | `setActive` 改为事务内先 deactivate 再 activate；新增 `listSummaryByNovel`（返回每集 active 版本的 scene/shot/prompt 数量） |
| `src/pipeline/episode-script-production.controller.ts` | 新增 `GET novels/:novelId/episode-script-versions/summary` |

### 前端 (apps/web)

| 文件 | 变更说明 |
|------|----------|
| `src/types/episode-script.ts` | `NarratorScriptPersistResponse.summary` 增加可选 `episodeCoverage` |
| `src/lib/episode-script-api.ts` | 新增 `EpisodeScriptVersionSummary` 与 `listSummaryByNovel` |
| `src/components/production/EpisodeScriptsPage.tsx` | 保留 `lastDraft`；persist 优先 `draftId`，catch 到 `NARRATOR_SCRIPT_DRAFT_CACHE_MISS` 时用 `draft` 重试；列表展示每集场/镜/提示词数；未保存草稿提示文案 |
| `src/components/production/ShotBoardPage.tsx` | 每个 shot 下可展开「提示词」：查看、编辑、新增、删除 prompt（prompt_type / prompt_text / negative_prompt / model_name / style_preset） |
| `src/components/production/EpisodeScriptDetailPage.tsx` | 当前版本下展示本集「共 X 场 · Y 镜 · Z 条提示词」 |

### 未改动的相关文件

- `apps/api/sql/20260313_create_production_layer_tables.sql`：已存在，未修改。
- `apps/api/src/pipeline/episode-shot-prompt.service.ts`：已有 CRUD，未改。
- `apps/api/src/pipeline/dto/narrator-script.dto.ts`：已有 DTO，未改。

---

## 2. 5 张表落库执行与验证结果

### 执行方式

- 项目**无**统一 migration 执行器（无 TypeORM migrations、无 npm migrate 等）。
- 已新增**最小可用**执行方式：
  - **执行建表**：`pnpm --filter api db:migrate:production`（内部执行 `node scripts/run-production-migration.js`）。
  - **验证表存在**：`pnpm --filter api db:verify:production`（内部执行 `node scripts/verify-production-tables.js`）。

### 脚本行为

- `run-production-migration.js`：读取 `apps/api/sql/20260313_create_production_layer_tables.sql`，使用 `mysql2` 连接环境变量（或默认 `127.0.0.1:3306/duanju`），`multipleStatements: true` 执行整份 SQL。
- `verify-production-tables.js`：查询 `information_schema.tables`，检查以下 5 张表是否存在：  
  `episode_script_versions`、`episode_scenes`、`episode_shots`、`episode_shot_prompts`、`character_visual_profiles`。全部存在则退出码 0，否则打印缺失表并退出码 1。

### 验证要求

- 请在**实际运行后端/前端的数据库环境**中执行：
  1. `pnpm --filter api db:migrate:production`
  2. `pnpm --filter api db:verify:production`
- 若 `character_visual_profiles` 建表报错（外键依赖 `novel_characters.id`），说明当前库中尚无 `novel_characters` 表，需先建立该表或暂时注释生产层 SQL 中 `character_visual_profiles` 的建表与外键后再执行。其余 4 张表仅依赖 `drama_novels`，一般可单独建表成功。

### 结论

- 建表与验证**依赖本地/目标环境数据库可用**。本次实现已提供可执行脚本与验证脚本；若因环境未配置或缺少 `novel_characters` 导致未执行成功，请在报告中注明「未执行原因 + 已执行的命令与报错」，并在具备条件后按上述步骤执行并再次运行验证脚本。

---

## 3. NarratorScriptService 升级内容

### 原逻辑（已移除）

- 纯规则生成：每集固定 1 scene、1 shot，从 `novel_episodes` / `drama_structure_template` / `novel_hook_rhythm` 取字段拼成占位稿，无 LLM、无世界观表。

### 现逻辑（主路径）

1. **输入聚合**  
   - 必查：`novel_episodes`、`drama_structure_template`、`novel_hook_rhythm`。  
   - 世界观表（若表存在则查，按字符预算约 25k 截断）：  
     `set_core`、`set_payoff_arch`、`set_payoff_lines`、`set_opponent_matrix`、`set_opponents`、`set_power_ladder`、`set_traitor_system`、`set_traitors`、`set_traitor_stages`、`set_story_phases`。

2. **LLM 调用**  
   - 使用环境变量 `lc_api_url`、`lc_api_key`，请求体为 OpenAI 兼容的 chat completions（model 固定为 `claude-3-5-sonnet-20241022`，temperature 0.4）。  
   - System：只输出严格 JSON，格式为 `{"scripts":[{"episodeNumber", "title", "summary", "scriptType", "scenes":[...]}]}`。  
   - User：任务说明（旁白主导、古装权谋、竖屏 60 秒）+ 分集与节奏摘要（每集一行）+ 世界观设定块 + 输出契约示例。

3. **生成目标与数量**  
   - 每集 **3~5 个 scenes**，每 scene **2~4 个 shots**（提示中写默认 3 场、每场 3 镜）。  
   - 每个 shot：`visualDesc`、`narratorText`、`subtitleText`、`durationSec`、`emotionTag`、`prompts`（至少含 `video_cn` / `video_en`）。

4. **解析与归一化**  
   - 从响应中提取文本（choices[0].message.content 或等价），去掉 markdown 代码围栏，解析 JSON。  
   - 若解析失败，尝试截取首尾 `{`～`}` 再解析。  
   - `normalizeScripts`：按请求的 `episodeNumbers` 顺序，将解析出的 `scripts` 与每集一一对应；`normalizeOneScript` / `normalizeScene` / `normalizeShot` 做字段截长、默认值、prompts 默认补全（无则补一条 video_cn、一条 video_en）。  
   - 若某集无对应 script 或 scenes/shots 为空，则插入 fallback 的 1 scene 1 shot，保证可 persist。

5. **draftId / 缓存 / persist**  
   - 生成后写入内存 cache（TTL 30 分钟，最多 50 条），返回 `draftId` 与完整 `draft`。  
   - persist 时优先用 `draftId` 取 cache；若 cache miss 且请求体带 `draft` 则用 `draft`；否则抛出 `NARRATOR_SCRIPT_DRAFT_CACHE_MISS` 或 `NARRATOR_SCRIPT_DRAFT_REQUIRED`。

---

## 4. 世界观表聚合接入情况

- 以下表在**表存在**的前提下会被查询并拼进 LLM 的「世界观设定」块（字符总预算约 25000）：  
  `set_core`、`set_payoff_arch`、`set_payoff_lines`、`set_opponent_matrix`、`set_opponents`、`set_power_ladder`、`set_traitor_system`、`set_traitors`、`set_traitor_stages`、`set_story_phases`。  
- 每个表查询前通过 `information_schema.tables` 判断是否存在，不存在则跳过，不报错。  
- 未复用 `PipelineEpisodeScriptService` 的 `buildReferenceBlock`（避免引入重量依赖与循环依赖），在 `NarratorScriptService` 内独立实现了一套按表名 + 字段的查询与序列化。

---

## 5. LLM prompt / JSON 输出结构说明

- **风格与约束**：古装架空权谋爽剧；旁白推进剧情，对白点睛；每集 3~5 场、每场 2~4 镜；60 秒竖屏；每个 shot 必须有可拍画面、旁白、屏幕字幕、时长、情绪；prompts 至少包含 video_cn / video_en，偏影视化。  
- **输出契约**：  
  `{"scripts":[{"episodeNumber":1,"title":"...","summary":"...","scriptType":"narrator_video","scenes":[{"sceneNo":1,"sceneTitle":"...","locationName":"...","sceneSummary":"...","mainConflict":"...","narratorText":"...","screenSubtitle":"...","estimatedSeconds":18,"shots":[{"shotNo":1,"shotType":"close","visualDesc":"...","narratorText":"...","dialogueText":"...","subtitleText":"...","durationSec":3.5,"cameraMovement":"push","emotionTag":"压迫","prompts":[{"promptType":"video_cn","promptText":"...","negativePrompt":"","modelName":"generic","stylePreset":"古装权谋"},{"promptType":"video_en",...}]}]}]}]}`  
- 解析失败时抛出 `BadRequestException`，提示「Narrator script LLM output is not valid JSON」，不静默失败。

---

## 6. draftId / cache / persist / fallback 升级说明

- **服务端**：逻辑不变，仍为 draftId + 30 分钟 TTL、最多 50 条；persist 优先 draftId，无 draftId 或 cache miss 时若带 `draft` 则用 `draft`，否则返回 `NARRATOR_SCRIPT_DRAFT_CACHE_MISS` 或 `NARRATOR_SCRIPT_DRAFT_REQUIRED`。  
- **前端**：  
  - 生成后除保存 `draftId` 外，同时保存完整 `lastDraft`。  
  - 保存时优先传 `{ draftId, draft: lastDraft }`（或仅 `{ draft }` 当无 draftId）。  
  - 若 persist 请求**抛错**且 `response.data.code === 'NARRATOR_SCRIPT_DRAFT_CACHE_MISS'`，则自动用 `{ draft: lastDraft }` 再请求一次 persist；成功则清空草稿状态并刷新列表。  
- 错误码：前端能识别并处理 `NARRATOR_SCRIPT_DRAFT_REQUIRED`、`NARRATOR_SCRIPT_DRAFT_CACHE_MISS`、`NARRATOR_SCRIPT_DRAFT_ID_NOVEL_MISMATCH`。

---

## 7. persist 的事务与 active version 一致性处理

- **persist**：整次 persist 在 `dataSource.transaction` 内执行：对每集先 deactivate 该集所有版本，再 insert 新版本（is_active=1），再按顺序 insert scenes → shots → shot_prompts。保证同一 `novel_id + episode_number` 下最终仅有一个 active version。  
- **setActive**：`EpisodeScriptVersionService.setActive(id)` 改为在事务内：先 `UPDATE episode_script_versions SET is_active = 0 WHERE novel_id = ? AND episode_number = ?`，再 `UPDATE episode_script_versions SET is_active = 1 WHERE id = ?`，保证一致性。

---

## 8. Shot prompts 编辑工作流说明

- **Shot Board** 每个镜头卡片上增加「提示词 (N) ▼」按钮，点击展开该 shot 下的提示词列表。  
- 列表内每条 prompt 可：  
  - **编辑**：内联编辑 `prompt_type`、`prompt_text`、`negative_prompt`、`model_name`、`style_preset`，保存后 PATCH `/episode-shot-prompts/:id`。  
  - **删除**：确认后 DELETE `/episode-shot-prompts/:id`。  
- 展开区域内可点击「+ 新增」：填写 type / promptText / negativePrompt / modelName / stylePreset，提交后 POST `/episode-shots/:shotId/prompts`。  
- 使用的 API：`episodeShotPromptApi.listByShot`、`create`、`update`、`remove`（已存在于 `lib/episode-script-api.ts`）。

---

## 9. 前端页面增强说明

- **Episode Script 列表页**：  
  - 调用 `listSummaryByNovel`，表格增加一列「场/镜/提示词」，展示每集当前 active 版本的 scene_count、shot_count、prompt_count。  
  - 有未保存草稿时显示「已生成未保存」提示；保存成功后清空草稿状态并弹出 summary（版本数、场、镜、提示词数、覆盖集数）。  

- **单集详情页**：  
  - 在「当前版本概述」下展示本集统计：「共 X 场 · Y 镜 · Z 条提示词」（来自 summary 接口）。  
  - 版本列表与「设为当前」、Scene Board / Shot Board 入口保持原样。  

- **Scene Board**：  
  - 已有每场时长、旁白、屏幕字幕的展示与编辑，本次未改。  

- **Shot Board**：  
  - 按 scene 分组不变；每个 shot 展示 narrator/subtitle 摘要与时长；新增提示词折叠区与提示词的增删改（见第 8 节）。

---

## 10. 手工验证步骤

1. **建表与验证**  
   - 配置好 DB 环境变量（或使用默认），执行：  
     `pnpm --filter api db:migrate:production`  
     `pnpm --filter api db:verify:production`  
   - 确认输出为「All 5 tables exist」或按需处理 `character_visual_profiles` 依赖。

2. **后端**  
   - 配置 `lc_api_url`、`lc_api_key`，启动 API。  
   - 对某 novel 调用 `POST /pipeline/:novelId/narrator-script-generate-draft`，检查返回含 `draftId` 与 `draft.scripts`，且每集 scripts 含多场、每场多镜。  
   - 调用 `POST /pipeline/:novelId/narrator-script-persist`，body 为 `{ draftId }` 或 `{ draft }`，检查返回 summary 含 scriptVersions、scenes、shots、prompts、episodeCoverage。  
   - 调用 `GET /novels/:novelId/episode-script-versions/summary`，检查每集有 scene_count、shot_count、prompt_count。

3. **前端**  
   - 在 Episode Script 列表页：生成草稿 → 确认出现「已生成未保存」→ 保存 → 确认列表出现场/镜/提示词数且草稿状态清除。  
   - 关闭或刷新后仅带 draftId 再保存：若服务端 cache 已过期，应触发前端用 lastDraft 重试并成功（或明确提示 cache miss）。  
   - 进入 Shot Board，展开某镜头的提示词：编辑一条、新增一条、删除一条，确认列表与接口一致。

---

## 11. 已知限制 / 后续建议

- **LLM 单次请求**：当前为「所有请求集数」一次 prompt 生成；若集数很多（例如 >10），可能超长或超时，可改为按批（如每 5 集一发）生成再合并。  
- **character_visual_profiles**：建表依赖 `novel_characters`；若项目尚未有该表，需先建表或暂时不建 character_visual_profiles。  
- **模型与 endpoint**：当前写死 `claude-3-5-sonnet-20241022` 与 `lc_api_*`；后续可改为配置项或与 PipelineEpisodeScriptService 共用配置。  
- **前端错误码**：若 API 错误体结构不同（例如错误在 body 而非 response.data），需根据实际响应再微调 `getErrorCode(e)` 的取法，以正确识别 `NARRATOR_SCRIPT_DRAFT_CACHE_MISS`。
