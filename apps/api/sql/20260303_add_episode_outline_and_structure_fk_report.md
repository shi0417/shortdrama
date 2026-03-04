# 20260303 增加 episodes 大纲字段与结构模板外键报告

## Stage A 审计

执行 SQL：
- `SHOW COLUMNS FROM novel_episodes;`
- `SHOW CREATE TABLE novel_episodes;`
- `SHOW CREATE TABLE drama_structure_template;`
- 以及列/索引/外键/唯一键存在性检查

审计结论：
- `novel_episodes` 初始字段中不存在以下列：
  - `outline_content`
  - `history_outline`
  - `rewrite_diff`
  - `structure_template_id`
- `novel_episodes` 初始不存在索引：
  - `idx_episode_structure_template_id`
- `novel_episodes` 初始不存在外键：
  - `fk_episode_structure_template`
- `drama_structure_template` 初始不存在唯一约束：
  - `uk_template_novel_chapter (novels_id, chapter_id)`

## Stage B 迁移文件内容概要

迁移文件：
- `apps/api/sql/20260303_add_episode_outline_and_structure_fk.sql`

实现方式（幂等）：
- 通过 `INFORMATION_SCHEMA` 判断对象是否存在，再执行 DDL
- 使用存储过程 `sp_add_episode_outline_and_structure_fk` 串行执行

关键动作：
1. 条件新增列（不存在才 ADD）：
   - `outline_content LONGTEXT NULL`
   - `history_outline TEXT NULL`
   - `rewrite_diff LONGTEXT NULL`
   - `structure_template_id INT NULL`
2. 条件新增索引：
   - `idx_episode_structure_template_id(structure_template_id)`
3. 条件新增唯一键：
   - `uk_template_novel_chapter(novels_id, chapter_id)`
   - 若检测到重复 `(novels_id, chapter_id)` 组合，则跳过并输出告警（不直接失败）
4. 条件新增外键：
   - `fk_episode_structure_template`
   - `novel_episodes.structure_template_id -> drama_structure_template.id`
   - `ON DELETE SET NULL ON UPDATE CASCADE`

## Stage C 执行与验证结果

执行命令：
- `mysql -h 127.0.0.1 -P 3306 -u root -p123456 duanju < apps/api/sql/20260303_add_episode_outline_and_structure_fk.sql`

执行结果：
- 首次执行成功。
- 执行过程中出现一次 `ALTER TABLE` 元数据锁等待（`Waiting for table metadata lock`），定位后释放阻塞会话并继续，最终执行成功。
- 二次重跑成功（用于验证幂等性）。

验证 SQL 与结果摘要：

1) `SHOW COLUMNS FROM novel_episodes;`
- 已存在新增列：
  - `outline_content longtext NULL`
  - `history_outline text NULL`
  - `rewrite_diff longtext NULL`
  - `structure_template_id int NULL`

2) `SHOW INDEX FROM novel_episodes;`
- 已存在索引：`idx_episode_structure_template_id`（列 `structure_template_id`）

3) 外键验证：
- `fk_episode_structure_template`: `novel_episodes -> drama_structure_template`
- 原有外键仍在：`fk_novel_episodes_novel_id_drama_novels`
- `drama_structure_template` 仍保持到 `drama_novels` 的外键：`fk_drama_structure_novels`

4) 唯一键验证：
- `uk_template_novel_chapter` 已存在于 `drama_structure_template`

5) 抽查 join：
- 执行了：
  - `SELECT e.id,e.novel_id,e.episode_number,e.structure_template_id,t.id AS tpl_id,t.structure_name ...`
- 当前返回为空（该 `novel_id` 下暂无 episode 数据），SQL 正常执行，无报错。

## Stage D 代码改动清单（NestJS + Web API Client）

### 新增 Entity
- `apps/api/src/entities/episode.entity.ts`
  - 新增字段映射：`outlineContent` / `historyOutline` / `rewriteDiff` / `structureTemplateId`
  - 新增关系：
    - `@ManyToOne(() => DramaStructureTemplate, { nullable: true })`
    - `@JoinColumn({ name: 'structure_template_id' })`
    - `structureTemplate?: DramaStructureTemplate`
- `apps/api/src/entities/drama-structure-template.entity.ts`
  - 映射 `drama_structure_template`（含 `id`, `novelsId`, `chapterId`, `structureName`, `themeType`, `powerLevel` 等关键字段）
  - 提供与 `Episode` 的反向关系

### 新增 Episodes 模块
- `apps/api/src/episodes/episodes.module.ts`
- `apps/api/src/episodes/episodes.controller.ts`
  - `GET /episodes?novelId=xx`
  - `GET /episodes/:id`
  - 使用 `JwtAuthGuard`
- `apps/api/src/episodes/episodes.service.ts`
  - `findAll({ novelId? })`：支持按 `novelId` 过滤，按 `episodeNumber ASC` 排序
  - `findOne(id)`：带 `relations: ['structureTemplate']`
  - 输出 DTO 包含新增字段与可选 `structureTemplate`
- DTO：
  - `apps/api/src/episodes/dto/query-episodes.dto.ts`
  - `apps/api/src/episodes/dto/episode-response.dto.ts`

### 应用模块接入
- 更新 `apps/api/src/app.module.ts`
  - 引入 `EpisodesModule`

### 前端 API 客户端
- 更新 `apps/web/src/lib/api.ts`
  - 新增 `DramaStructureTemplateDto`、`EpisodeResponseDto`
  - 新增方法：`getEpisodes(novelId)`

## Stage E 本地验证

1) 测试命令：
- 执行 `pnpm test`（`apps/api`）
- 结果：项目未定义 `test` script，故无法执行单元测试（已在命令输出确认）

2) 编译校验：
- 执行 `pnpm build`（`apps/api`）
- 结果：通过

3) 运行与接口验证：
- 启动：`pnpm dev`（`apps/api`）
- 认证：
  - 使用数据库中存在用户 `s01/123456` 登录，获取 JWT 成功（201）
- 调用：
  - `GET /episodes?novelId=1`（带 `Authorization: Bearer <token>`）
  - 返回 200，当前数据为空数组 `[]`（说明接口链路与鉴权、查询逻辑已生效）

示例响应（当前数据）：
```json
[]
```

说明：
- 由于当前 `novel_id=1` 下暂无 episode 记录，无法展示单条数据字段实例。
- 当存在数据时，响应会包含：
  - `outlineContent`
  - `historyOutline`
  - `rewriteDiff`
  - `structureTemplate`（可选，可能为 `null/undefined`）

## 结论与下一步建议

结论：
- 迁移 SQL 已生成并成功执行，且可重跑（幂等）。
- 表结构、索引、外键、唯一键均按要求落地。
- NestJS 后端已补齐实体关系、DTO、服务查询、控制器接口。
- 前端 API 客户端已补齐 `getEpisodes(novelId)`。

下一步建议：
1. 为历史 `novel_episodes` 数据批量回填 `structure_template_id`（可按 `novel_id + episode_number/chapter_id` 规则匹配）。
2. 若需要更稳健联调，补充 `episodes` 的集成测试（含鉴权 + relation 映射）。
3. 若前端即将接入，建议在页面侧处理 `structureTemplate` 为空的兜底展示。
