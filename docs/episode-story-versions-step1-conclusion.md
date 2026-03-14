# Step 1 摸底结论（episode_story_versions）

## 1. 现有 production layer 命名风格

- **表名**：`episode_script_versions`、`episode_scenes`、`episode_shots`、`episode_shot_prompts`（小写 + 下划线）。
- **索引**：`idx_script_versions_ep`、`idx_script_versions_active`（idx_ + 表简称 + 用途）。
- **外键**：`fk_script_versions_novel`（fk_ + 表简称 + 引用表）。
- **SQL 文件**：`apps/api/sql/20260313_create_production_layer_tables.sql`，无 `source_episode_id` 外键（仅 COMMENT 关联 novel_episodes.id）。
- **Service**：`EpisodeScriptVersionService`，方法 listByNovel、getByNovelAndEpisode、getActiveByNovelAndEpisode、create、update、setActive、remove。
- **Controller**：`EpisodeScriptProductionController`，路由 `novels/:novelId/episode-script-versions`、`episode-script-versions/:id` 等，无 Controller 级 prefix。
- **DTO**：`CreateEpisodeScriptVersionDto`、`UpdateEpisodeScriptVersionDto`，class-validator + class-transformer，scriptType/status 用 IsIn 常量数组。

## 2. version_no / is_active 现有处理方式

- **version_no**：create 时若 dto.versionNo 未传则 `getNextVersionNo(novelId, episodeNumber)` 取 `COALESCE(MAX(version_no),0)+1`；同一 novel_id + episode_number 内递增。
- **is_active**：create 时 dto.isActive 默认 1；若 isActive === 1 则先 `deactivateOthersForEpisode(novelId, episodeNumber)`（同集其它行 SET is_active=0），再 INSERT 新行 is_active=1。update 时若 dto.isActive === 1 同样先 deactivate 再更新。setActive(id) 在事务内先同集 is_active=0 再该 id is_active=1。

见 `episode-script-version.service.ts`：getNextVersionNo（221–228 行）、deactivateOthersForEpisode（231–238 行）、create（92–97 行）、update（124–126 行）、setActive（179–186 行）。

## 3. 是否适合对 episode_story_versions 复用同类 service/controller 模式

**适合**。理由：

- episode_story_versions 与 episode_script_versions 同为「按 novel + episode 的版本表」，无子表（无 scenes/shots），CRUD 形态一致。
- 复用：DataSource 裸 SQL 查询、assertNovelExists、getNextVersionNo、deactivateOthersForEpisode、create/update/setActive/remove 模式；单独 Controller 提供 novels/:novelId/episode-story-versions 与 episode-story-versions/:id 路由，与 EpisodeScriptProductionController 并列，不污染现有 narrator 四表逻辑。
