# Production Flow Integration Check Report

第七轮实现：5集最小集成验证脚本升级 + drama_source_text / novel_source_segments / adaptation 统一进 PipelineReferenceContextService。

---

## 1. 修改文件清单

| 文件 | 变更说明 |
|------|----------|
| `apps/api/scripts/check-production-flow.js` | 从“前置检查”升级为完整最小集成验证：表存在 → 源数据就绪 → HTTP 调用 generateDraft → persist → 数据库回查（版本/场景/镜头/提示词 + active 唯一性）；支持参数 novelId startEpisode endEpisode batchSize modelKey；输出 [1]~[5] 与 FINAL RESULT: PASS/FAIL |
| `apps/api/package.json` | 新增脚本命令 `check:production-flow` |
| `apps/api/src/pipeline/pipeline-reference-context.service.ts` | 注入 SourceRetrievalService；EXTENDED_TABLE_CONFIG 增加 adaptation_modes（params: []）；getContext 支持 drama_source_text / novel_source_segments 特殊取数并写入 optionalTables；getDramaSourceTextBlock 私有方法；getTableBlock 支持 drama_source_text、novel_source_segments、adaptation_modes（params）；SHARED_SERVICE_TABLE_NAMES 增加 drama_source_text、novel_source_segments；buildNarratorPromptContext / buildEpisodeScriptPromptContext 为上述两表补 label |
| `apps/api/src/pipeline/pipeline-episode-script.service.ts` | buildReferenceBlock 中凡 SHARED_SERVICE_TABLE_NAMES 覆盖的表均只走 refContext.getTableBlock，移除整段 switch 重复查表逻辑；删除 getRawSourceTextBlock 死代码 |

---

## 2. check-production-flow.js 升级说明

- **原行为**：仅做表存在性检查 + 核心三表 1~5 集数据条数检查，输出“建议测试区间”后退出。
- **现行为**：
  1. **[1] Table existence**：5 张生产表 + 核心三表存在性，缺则退出。
  2. **[2] Source readiness**：指定 novelId 下 startEpisode~endEpisode 的 novel_episodes、drama_structure_template、novel_hook_rhythm 是否就绪。
  3. **[3] Generate draft**：`POST /pipeline/:novelId/narrator-script-generate-draft`，body 含 startEpisode、endEpisode、batchSize、可选 modelKey；校验 draftId、draft.scripts 条数、draft.meta.batchCount；401 时提示设置 API_TOKEN。
  4. **[4] Persist**：`POST /pipeline/:novelId/narrator-script-persist`，body 含 draftId 与 draft（fallback）；校验 summary 中 scriptVersions、scenes、shots、prompts、episodeCoverage、batchCount。
  5. **[5] DB verification**：直连 DB 查询 episode_script_versions / episode_scenes / episode_shots / episode_shot_prompts 在 novel_id + 集数范围内的条数；校验同一 novel_id + episode_number 仅一条 is_active=1。
- **参数**：`node scripts/check-production-flow.js [novelId] [startEpisode] [endEpisode] [batchSize] [modelKey]`，默认 novelId=1, startEpisode=1, endEpisode=5, batchSize=5。
- **环境变量**：DB_* 同现有；API_BASE_URL 默认 http://localhost:4000；API_TOKEN 可选（JWT），用于鉴权接口。
- **提示**：脚本开头说明会写入正式表，建议在测试库或指定 novel 上执行；不提供自动 cleanup，避免误删数据。

---

## 3. 最小集成验证流程说明

1. 确保 API 已启动（如 `pnpm --filter api dev`），且 DB 可连。
2. 可选：设置 `API_TOKEN`（若 pipeline 接口受 JWT 保护）。
3. 执行：`node apps/api/scripts/check-production-flow.js 1 1 5 5` 或 `pnpm --filter api check:production-flow -- 1 1 5 5`。
4. 脚本依次执行 [1]~[5]，任一步失败即打印失败阶段与原因并 `process.exit(1)`；全部通过则打印 `FINAL RESULT: PASS`。

---

## 4. 数据库回查验证逻辑

- **episode_script_versions**：`novel_id = ? AND episode_number BETWEEN ? AND ? AND is_active = 1` 的 COUNT，要求 ≥ expectedEpisodes（endEpisode - startEpisode + 1）。
- **episode_scenes**：通过 script_version_id 关联 is_active=1 的 version，按 episode_number 范围 COUNT。
- **episode_shots**：同上关联，按 episode_number 范围 COUNT。
- **episode_shot_prompts**：通过 shot → script_version 关联，按 episode_number 范围 COUNT。
- **唯一性**：对 episode_script_versions 按 novel_id、episode_number 分组，`HAVING COUNT(*) > 1` 的组数为 0。

---

## 5. PipelineReferenceContextService 扩展内容

- **adaptation_modes**：加入 EXTENDED_TABLE_CONFIG，sql 无占位符，`params: []`；getTableBlock 对配置中带 `params` 的用 `params ?? [novelId]` 传参。
- **drama_source_text**：不放入 EXTENDED_TABLE_CONFIG 的通用 SQL 路径；新增私有方法 `getDramaSourceTextBlock(novelId, charBudget)`，按 novels_id 查 drama_source_text，按字符预算拼接 source_text；getContext 的 requestedTables 若含 drama_source_text 则调用该方法写入 optionalTables；getTableBlock('drama_source_text') 调用该方法并返回块与 summary。
- **novel_source_segments**：依赖 SourceRetrievalService.buildWorldviewEvidence(novelId, charBudget)；getContext 的 requestedTables 若含 novel_source_segments 且表存在则调用并写入 optionalTables；getTableBlock('novel_source_segments') 调用并返回块与 summary。PipelineReferenceContextService 构造函数注入 SourceRetrievalService（必选，由 PipelineModule 导入 SourceTextsModule 提供）。
- **meta**：getContext 的 meta.requestedTables / existingTables / missingTables / episodeNumbers 仍包含上述新源；表不存在或取数异常时仅记入 missingTables，不抛错。

---

## 6. Narrator / Episode-script 接入情况

- **Narrator**：未改 requestedTables 默认列表；若后续在 NARRATOR_DEFAULT_EXTENSION 或调用方 requestedTables 中加入 drama_source_text / novel_source_segments，getContext 会拉取并写入 optionalTables，buildNarratorPromptContext 会按 label 输出；日志中 existingTables / missingTables 会体现这些表。
- **Episode-script**：buildReferenceBlock 对所有在 SHARED_SERVICE_TABLE_NAMES 中的表（含 drama_source_text、novel_source_segments、adaptation_modes 及原 EXTENDED_TABLE_CONFIG 全部表）统一只调 `refContext.getTableBlock(novelId, table, sourceTextCharBudget)`，不再保留本地 switch 查表；删除 getRawSourceTextBlock。

---

## 7. 手工验证步骤

1. 启动 API：`pnpm --filter api dev`。
2. 可选：登录获取 JWT，设置 `API_TOKEN`。
3. 执行集成检查：`node apps/api/scripts/check-production-flow.js 1 1 5 5`。
4. 确认输出 [1]~[5] 均为 OK，最终为 `FINAL RESULT: PASS`。
5. 若 [3] 或 [4] 失败，根据控制台错误与 API 日志排查；401 时配置 API_TOKEN 或临时放开 pipeline 鉴权。
6. 在 Episode Script 页做一次“只生成前 5 集”并保存，再在 Scene Board / Shot Board 确认可编辑；可选：在 episode-script 生成时勾选 drama_source_text / novel_source_segments，确认参考块来自共享服务。

---

## 8. 已知限制 / 下一步建议

- **限制**：集成脚本依赖 HTTP 调用，需 API 已启动；若 pipeline 使用 JwtAuthGuard，需提供有效 API_TOKEN。脚本不提供 --cleanup，写入数据需手动或另脚本清理。
- **建议**：后续若需在无 API 环境下验证，可考虑 Nest  bootstrap 脚本直调 NarratorScriptService.generateDraft / persistDraft；或为本地验证提供免鉴权端点（仅限测试环境）。Narrator 若需默认带 drama_source_text / novel_source_segments，可将二者加入 NARRATOR_DEFAULT_EXTENSION。

---

*报告生成时间：第七轮实现完成时。*
