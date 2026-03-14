# Pipeline Reference Context Service Report

第六轮实现：抽共享参考表聚合服务 + 5 集稳定生产验证支持。

---

## 1. 修改文件清单

| 文件 | 变更说明 |
|------|----------|
| `apps/api/src/pipeline/pipeline-reference-context.service.ts` | **新增**：统一参考表聚合服务，getContext / buildNarratorPromptContext / buildEpisodeScriptPromptContext / getTableBlock |
| `apps/api/src/pipeline/pipeline.module.ts` | 注册 `PipelineReferenceContextService` |
| `apps/api/src/pipeline/narrator-script.service.ts` | 移除内联 loadEpisodes、loadStructureTemplates、queryHookRhythmIfExists、buildWorldviewContext、hasTable；generateDraft 改为依赖 refContext.getContext + buildNarratorPromptContext；增强生成/持久化日志 |
| `apps/api/src/pipeline/pipeline-episode-script.service.ts` | 注入 `PipelineReferenceContextService`；buildReferenceBlock 中对共享服务支持的表优先调用 refContext.getTableBlock，其余走原有 switch |
| `apps/api/scripts/check-production-flow.js` | **新增**：5 集稳定生产验证前置检查脚本（5 张生产表 + 核心三表 1~5 集数据） |
| `apps/web/src/components/production/EpisodeScriptsPage.tsx` | 生成对话框默认 startEpisode=1、endEpisode=5；新增「只生成前 5 集（稳定验证）」快捷按钮 |

---

## 2. 新增共享聚合服务说明

- **类名**：`PipelineReferenceContextService`
- **职责**：
  - **getContext(novelId, options)**  
    按 novelId + 集数范围（episodeNumbers / startEpisode / endEpisode）+ requestedTables，聚合核心三表与扩展表，返回结构化 `PipelineReferenceContext`（含 novel、episodes、structureTemplates、hookRhythms、optionalTables、meta）。表不存在时记录到 `meta.missingTables`，不抛错。
  - **buildNarratorPromptContext(context, options)**  
    在结构化 context 基础上，将 optionalTables 格式化为供 narrator LLM 使用的字符串块，支持 charBudget。
  - **buildEpisodeScriptPromptContext(context, options)**  
    同上，供 episode-script 使用，可传 requestedTables 与 charBudget。
  - **getTableBlock(novelId, tableName, charBudget)**  
    单表取块，供 episode-script 的 buildReferenceBlock 复用，返回 `{ block, summary }` 或 null。
- **核心三表（必选）**：`novel_episodes`、`drama_structure_template`、`novel_hook_rhythm`。
- **扩展表**：通过 `EXTENDED_TABLE_CONFIG` 配置（label、sql、fields），包含任务要求的 drama_novels、set_*、novel_characters、novel_key_nodes 等；表存在性在 getContext 中统一检查。

---

## 3. Narrator 接入共享服务情况

- **主路径**：`NarratorScriptService.generateDraft()` 不再自行查询多张参考表，改为：
  1. 调用 `refContext.getContext(novelId, { startEpisode, endEpisode, requestedTables: [] })` 获取初始集数范围与 meta.episodeNumbers。
  2. 按 batchSize 拆成多个 batch。
  3. 每批调用 `refContext.getContext(novelId, { episodeNumbers: batch, requestedTables: NARRATOR_DEFAULT_EXTENSION, optionalTablesCharBudget })`，用返回的 context 构建 episodeMap / structureMap / hookMap，并用 `refContext.buildNarratorPromptContext(context, { charBudget })` 得到世界观字符串块。
  4. 调用现有 `generateNarratorScriptsWithLlm(..., worldviewBlock, modelKey)`，合并结果。
- **保留能力**：draftId、缓存 TTL、persist fallback、modelKey / batchSize / startEpisode / endEpisode 均未改动。
- **日志**：每次生成输出 novelId、episodeRange、batches、model、requestedTables、existingTables、missingTables；每批 LLM 调用保留 promptChars；persist 输出 scriptVersions、scenes、shots、prompts、episodeCoverage、episodes=[...]、batchCount。

---

## 4. Episode-script 接入共享服务情况

- **方式**：在 `PipelineEpisodeScriptService.buildReferenceBlock()` 开头，若表名属于 `SHARED_SERVICE_TABLE_NAMES`（即共享服务 `EXTENDED_TABLE_CONFIG` 中的表），则调用 `refContext.getTableBlock(novelId, table, sourceTextCharBudget)`，将返回的 block 与 summary 映射为原有 `ReferenceSummaryItem` 格式后返回；否则走原有 switch（drama_source_text、novel_source_segments、adaptation_modes 等仍由 episode-script 自行处理）。
- **效果**：核心参考表聚合与表存在性、字符截断逻辑统一到共享服务，episode-script 与 narrator 共用同一套表读取与块生成，避免两套逻辑继续分叉。

---

## 5. 默认参考表配置

- **核心必选**（getContext 始终尝试加载，表不存在记入 missingTables）：
  - `novel_episodes`
  - `drama_structure_template`
  - `novel_hook_rhythm`
- **Narrator 默认扩展**（`NARRATOR_DEFAULT_EXTENSION`）：  
  set_core、set_payoff_arch、set_payoff_lines、set_opponents、set_power_ladder、set_story_phases、novel_characters、novel_key_nodes、novel_timelines。
- **Episode-script 默认扩展**（文档用，当前仍用 DTO 中 `DEFAULT_REFERENCE_TABLES` 等）：  
  可与 narrator 类似，保守子集为 set_core、novel_characters、novel_key_nodes、novel_timelines、set_payoff_arch、set_payoff_lines、set_opponents、set_power_ladder；episode-script 实际勾选仍由前端/ DTO 决定，共享服务仅提供按表名取块能力。

---

## 6. 字符预算与表存在性处理

- **字符预算**：getContext 支持 `overallCharBudget`、`optionalTablesCharBudget`、`perTableMaxChars`；optional 表按顺序填充直至用满 optionalTablesCharBudget，单字段过长按 WORLDVIEW_TRIM_FIELD（600）截断。buildNarratorPromptContext / buildEpisodeScriptPromptContext 支持 charBudget 参数。
- **表存在性**：getContext 内对核心三表 + requestedTables 逐一 `hasTable()`，存在的表加入 existingTables，不存在的加入 missingTables（仅当该表被请求或是核心表时）。表不存在不抛错，仅影响 meta 与 optionalTables 内容。

---

## 7. 5 集稳定生产验证支持（脚本 / 日志 / 步骤）

- **脚本**：`apps/api/scripts/check-production-flow.js`  
  - 用法：`node scripts/check-production-flow.js [novelId]`，默认 novelId=1。  
  - 检查：5 张生产层表存在；核心三表存在；novel_episodes / novel_hook_rhythm 在指定 novel_id 下 1~5 集有数据，drama_structure_template 有数据。  
  - 输出：建议测试区间（起始集=1，结束集=5，batchSize=5）及是否满足「生成 5 集 → 保存 → Scene/Shot 可编辑 → prompt 可改」前置条件。
- **日志**：见第 3 节；persist 日志含 episodes 列表与 batchCount。
- **前端**：生成对话框默认起始集=1、结束集=5；新增「只生成前 5 集（稳定验证）」按钮，一键填入 1、5、5 与 batchSize=5。

---

## 8. 手工验证步骤

1. **前置**：执行 `node apps/api/scripts/check-production-flow.js 1`，确认 5 张生产表与核心三表 1~5 集就绪。
2. **生成**：进入项目 Episode Script 页，点击「生成旁白主导脚本初稿」，确认默认 1~5 集（或点「只生成前 5 集（稳定验证）」），点击「开始生成」。
3. **日志**：查看 API 日志，应出现 novelId、episodeRange、batches、model、existingTables、missingTables；每批 promptChars；persist 时 scriptVersions、scenes、shots、prompts、episodes、batchCount。
4. **保存**：点击「保存草稿」，确认无报错，提示中有 version/scene/shot/prompt 数量及 batchCount。
5. **库表**：查询 episode_script_versions、episode_scenes、episode_shots、episode_shot_prompts，确认 novel_id 与 1~5 集数据一致。
6. **编辑**：进入 Scene Board / Shot Board，确认场景与镜头可编辑；在 Shot Board 中确认 prompt 可改、video_cn/video_en 快速补齐可用。

---

## 9. 已知限制 / 下一步建议

- **限制**：  
  - drama_source_text、novel_source_segments、adaptation_modes 仍由 episode-script 单独实现，未纳入共享服务 EXTENDED_TABLE_CONFIG。  
  - 参考表勾选 UI、输出目标表勾选、生成模式（快速/标准/严格）未在本轮实现。
- **建议**：  
  - 稳定跑通「生成 5 集 → 保存 → Scene/Shot 可编辑 → prompt 可改」后，再扩展多阶段编排与 QA 复修。  
  - 若需统一 drama_source_text / novel_source_segments 的读取与预算，可在 PipelineReferenceContextService 中增加配置与 getTableBlock 分支，再由 episode-script 逐步切过去。

---

*报告生成时间：第六轮实现完成时。*
