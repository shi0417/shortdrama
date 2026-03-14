# episode_story_versions 故事正文层实现报告

## 1. 修改文件清单

| 类型 | 路径 | 说明 |
|------|------|------|
| 新增 | `apps/api/sql/20260314_create_episode_story_versions.sql` | 创建 episode_story_versions 表的 migration |
| 新增 | `apps/api/src/pipeline/dto/episode-story-version.dto.ts` | CreateEpisodeStoryVersionDto、UpdateEpisodeStoryVersionDto |
| 新增 | `apps/api/src/pipeline/episode-story-version.service.ts` | EpisodeStoryVersionService 全量 CRUD |
| 新增 | `apps/api/src/pipeline/episode-story-version.controller.ts` | EpisodeStoryVersionController 路由 |
| 修改 | `apps/api/src/pipeline/pipeline.module.ts` | 注册 EpisodeStoryVersionController、EpisodeStoryVersionService |
| 新增 | `docs/episode-story-versions-step1-conclusion.md` | Step 1 摸底结论（命名、version_no/is_active、复用结论） |

未修改：`narrator-script.service.ts`、`episode-script-production.controller.ts`、`episode-script-version.service.ts`、production layer 四表相关代码及 SQL。

---

## 2. Migration 内容摘要

- **文件**：`apps/api/sql/20260314_create_episode_story_versions.sql`
- **表名**：`episode_story_versions`
- **索引**：`idx_story_versions_ep (novel_id, episode_number, version_no)`、`idx_story_versions_active (novel_id, episode_number, is_active)`、`idx_story_versions_source_episode (source_episode_id)`
- **外键**：`fk_story_versions_novel` → `drama_novels(id)` ON DELETE CASCADE ON UPDATE CASCADE；`fk_story_versions_source_episode` → `novel_episodes(id)` ON DELETE SET NULL ON UPDATE CASCADE
- **引擎与字符集**：InnoDB、utf8mb4、utf8mb4_unicode_ci
- **表注释**：分集故事正文版本表（完整连续短剧故事文本层）

---

## 3. 新表字段与设计 rationale

| 字段 | 类型 | COMMENT / 说明 |
|------|------|----------------|
| id | INT AUTO_INCREMENT PRIMARY KEY | 主键 |
| novel_id | INT NOT NULL | 关联 drama_novels.id |
| episode_number | INT NOT NULL | 集数 |
| source_episode_id | INT DEFAULT NULL | 关联 novel_episodes.id，可空；提纲来源集 |
| version_no | INT DEFAULT 1 | 同集内版本号递增 |
| story_type | VARCHAR(50) NOT NULL DEFAULT 'story_text' | 故事类型：story_text / longform / revised 等 |
| title | VARCHAR(255) NOT NULL | 故事版本标题 |
| summary | TEXT NULL | 本集故事摘要（列表展示） |
| story_text | LONGTEXT NOT NULL | 本集完整连续短剧故事文本 |
| story_beat_json | JSON NULL | 结构化故事节拍，可空；后续可存目标/转折/尾钩等 |
| word_count | INT DEFAULT 0 | 故事文本字数，便于统计 |
| status | VARCHAR(30) DEFAULT 'draft' | 状态：draft / approved / locked |
| is_active | TINYINT DEFAULT 1 | 同集内当前启用版本（通常仅一个为 1） |
| generation_source | VARCHAR(50) DEFAULT 'ai' | 生成来源：ai / manual / mixed |
| notes | TEXT NULL | 备注 |
| created_at / updated_at | TIMESTAMP | 创建/更新时间 |

设计要点：与 `episode_script_versions` 保持同风格（version_no、is_active、source_episode_id）；故事层独立存「完整连续文本」与可选节拍 JSON，不污染 novel_episodes 提纲层，也不影响生产层四表。

---

## 4. 与 novel_episodes / episode_script_versions 的关系说明

- **novel_episodes**：提纲层，存集标题、outline、full_content 等；`episode_story_versions.source_episode_id` 可指向其 id，表示该故事版本基于哪一集提纲；ON DELETE SET NULL 保证删提纲不删故事版本。
- **episode_script_versions**：生产层脚本版本表，下挂 episode_scenes → episode_shots → episode_shot_prompts；与 episode_story_versions 无外键关联，二者并列：故事层只存「故事正文」版本，脚本层存分场/分镜/提示词。本轮不实现从 story → script 的自动流水线。

---

## 5. 新增 API 列表

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /novels/:novelId/episode-story-versions | 列出该小说下所有故事版本（listByNovel） |
| GET | /novels/:novelId/episode-story-versions/:episodeNumber/active | 该集当前启用故事版本（getActiveByNovelAndEpisode） |
| GET | /novels/:novelId/episode-story-versions/:episodeNumber | 该集所有故事版本（getByNovelAndEpisode） |
| POST | /novels/:novelId/episode-story-versions | 创建故事版本（create） |
| PATCH | /episode-story-versions/:id | 更新故事版本（update） |
| POST | /episode-story-versions/:id/set-active | 设为当前启用版本（setActive） |
| DELETE | /episode-story-versions/:id | 删除故事版本（remove） |

说明：与 `EpisodeScriptProductionController` 一致，无 Controller 级 prefix；应用未设置全局 API 前缀，故上述路径为根路径。需 JWT 鉴权（`JwtAuthGuard`）。

---

## 6. version_no / is_active 实现方式

- **version_no**：与 `EpisodeScriptVersionService` 一致。create 时若 DTO 未传 `versionNo`，则调用私有方法 `getNextVersionNo(novelId, episodeNumber)`，执行 `SELECT COALESCE(MAX(version_no), 0) + 1 AS next FROM episode_story_versions WHERE novel_id = ? AND episode_number = ?`，得到该集下一版本号；若传则用 DTO 值。
- **is_active**：create 时默认 `isActive ?? 1`；若为 1，则先执行 `deactivateOthersForEpisode(novelId, episodeNumber)`（`UPDATE episode_story_versions SET is_active = 0 WHERE novel_id = ? AND episode_number = ?`），再 INSERT 新行 is_active=1。update 时若 `dto.isActive === 1` 同样先 deactivate 再更新。`setActive(id)` 在事务内先将同 novel_id+episode_number 的 is_active 置 0，再将指定 id 置 1。见 `episode-story-version.service.ts`：create（约 95–102 行）、update（约 128–131 行）、setActive（约 184–195 行）、getNextVersionNo、deactivateOthersForEpisode。

---

## 7. 为何本轮不打通 story → script

需求明确「本轮不实现从 story -> script 的自动流水线，只先把 story layer 建起来」。故事正文层与脚本生产层分离后，可先独立维护故事版本与提纲的对应关系；后续若要做「从故事正文生成/更新脚本」，再在 Blueprint 中设计流水线及对 `episode_script_versions` 的写入策略，避免本步改动范围过大并保持 narrator 四表逻辑不被破坏。

---

## 8. 构建 / 类型检查结果

- 在项目根目录执行 `npx nx run api:build`：**通过**（exit code 0）。
- 在 `apps/api` 下执行 `npx tsc --noEmit`：**通过**（exit code 0）。
- 未对 `apps/api/src/pipeline/dto/episode-story-version.dto.ts`、`episode-story-version.service.ts`、`episode-story-version.controller.ts`、`pipeline.module.ts` 做修改的前提下，ReadLints 无报错。

---

## 9. 风险项与下一步建议

| 风险项 | 说明 | 建议 |
|--------|------|------|
| Migration 未自动执行 | 当前项目 SQL 为手工或 CI 执行，需在目标库执行 `20260314_create_episode_story_versions.sql` | 在部署/迁移流程中加入该文件执行 |
| GET 单条 by id | 未提供 GET /episode-story-versions/:id，前端若需单条可先用 list 或 getByNovelAndEpisode 过滤 | 若后续需要可新增 getOne(id) 路由 |
| story_beat_json 校验 | DTO 使用 IsObject()，仅接受对象；若上游传字符串需在业务层 JSON.parse 或放宽 DTO | 保持现状，客户端传对象即可 |
| 大文本 story_text | LONGTEXT 与 20mb body limit 已配置，超大单集需注意超时与存储 | 监控单条大小与写入耗时 |

下一步建议：执行 migration 后，用 Postman 或前端调用上述 API 做 CRUD 与 setActive 联调；若产品需要「从故事生成脚本」，再出 Blueprint 并实现 story → script 流水线（不改变本轮已实现的 story 层 CRUD 与表结构）。
