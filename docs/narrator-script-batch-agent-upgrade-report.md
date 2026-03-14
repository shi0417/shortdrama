# Narrator Script Batch Agent Upgrade Report

本文档记录「热修复 narrator persist 写库错误」与「第五轮升级」中已实现部分，以及未实现项的替代方案与建议。

---

## 1. 修改文件清单

### 后端 (apps/api)

| 文件 | 变更说明 |
|------|----------|
| `src/pipeline/narrator-script.service.ts` | persist 热修（INSERT 返回值不再数组解构）；按批 LLM 生成；可配置模型；draft.meta.batchCount；persist summary.batchCount；修复 log 中 scripts→allScripts |
| `src/pipeline/dto/narrator-script.dto.ts` | `NarratorScriptGenerateDraftDto` 增加 startEpisode、endEpisode、batchSize、modelKey；新增 `NarratorScriptDraftMeta`，`NarratorScriptDraftPayload` 增加 meta |

### 前端 (apps/web)

| 文件 | 变更说明 |
|------|----------|
| `src/types/episode-script.ts` | `NarratorScriptDraftMeta`、`NarratorScriptDraftPayload.meta`；`NarratorScriptPersistResponse.summary.batchCount` |
| `src/lib/episode-script-api.ts` | `generateDraft(novelId, params)` 支持 startEpisode、endEpisode、batchSize、modelKey |
| `src/components/production/EpisodeScriptsPage.tsx` | 生成对话框（batch size、模型、起始/结束集）；生成时传参；预览显示 batchCount；保存成功提示含 batchCount；cache miss 时用全量 draft 再 persist 的 fallback 已保留并兼容 |
| `src/components/production/ShotBoardPage.tsx` | 提示词区域突出 video_cn / video_en 状态；缺类型时「快速补齐」按钮；新增 prompt 时默认模板（镜头画面说明或占位文案） |

---

## 2. Persist 热修复说明

### 根因

- `manager.query()` 对 MySQL INSERT 返回的是 **OkPacket / ResultSetHeader**（或驱动封装后的单元素数组），不是「可迭代数组」。
- 原代码使用 `const [versionIns] = await manager.query(...)` 等数组解构，在返回值为非数组时触发 `TypeError: (intermediate value) is not iterable`。

### 修改方式

- 所有 INSERT 不再使用数组解构，统一改为：
  - `const versionIns: any = await manager.query(...)`
  - 使用 `Number(Array.isArray(versionIns) ? versionIns[0]?.insertId : versionIns?.insertId) || 0` 取 `scriptVersionId` / `sceneId` / `shotId`。
- 若取到的 id 为 0，则抛出 `BadRequestException`，避免静默写入失败。
- 对 SELECT 的 `episodeQuery`、`versionNoQuery` 等同样改为「先取 raw，再 `Array.isArray(raw) ? raw[0] : raw`」，避免对非数组解构。

### 涉及表与字段

- `episode_script_versions` → scriptVersionId
- `episode_scenes` → sceneId
- `episode_shots` → shotId
- `episode_shot_prompts` 使用上述 sceneId/shotId，无单独 insertId 取用问题

persist 在事务内顺序写入上述 4 张表，同一 novel_id + episode_number 仅保留一个 active version（先 UPDATE is_active=0 再 INSERT 新版本）。

---

## 3. 5 张表实际写入验证结果

| 表名 | 是否在 persist 中写入 | 说明 |
|------|------------------------|------|
| episode_script_versions | 是 | 每集一条新版本，version_no 递增，is_active=1 |
| episode_scenes | 是 | 按 script 下 scenes 循环 INSERT，关联 script_version_id |
| episode_shots | 是 | 按 scene 下 shots 循环 INSERT，关联 scene_id |
| episode_shot_prompts | 是 | 按 shot 下 prompts 循环 INSERT，关联 shot_id |
| character_visual_profiles | 否 | 按需求不绑进本次「脚本初稿」生成任务，未在 persist 中写入 |

验证建议：在本地执行「生成 5 集 → 保存草稿」后，在数据库中查询上述 4 张表，确认 novel_id、episode_number、script_version_id、scene_id、shot_id 对应关系正确且数量符合预期。

---

## 4. 按批 LLM 生成实现说明

- **集数范围**：由 `startEpisode`、`endEpisode`、`targetEpisodeCount` 共同决定；先按 episode 数据过滤起止集，再按 targetEpisodeCount 截断。
- **分批**：`batchSize` 默认 5（常量 `DEFAULT_BATCH_SIZE`），可从前端或 API 传入；按批将 episode numbers 切分为多个 batch。
- **每批**：调用 `generateNarratorScriptsWithLlm(novelId, batch, ..., modelKey)`，仅对该批集数调用一次 LLM；任一批失败则抛出带 episode range 的 `BadRequestException`。
- **合并**：所有 batch 的脚本合并后按 `episodeNumber` 排序，得到完整 `draft.scripts`；`draft.meta.batchCount = batches.length`。
- **日志**：每批打 log 含 batch 序号与 episode range，便于排查。

已不再使用「一次性 61 集一个 prompt」作为主路径；主路径为按批生成并合并。

---

## 5. 共享世界观聚合器设计

**当前状态**：未抽取独立 Service；世界观构建仍内联在 `NarratorScriptService.buildWorldviewContext()` 中。

**建议替代方案**：

- 后续可新增 `PipelineReferenceContextService` 或 `NarratorReferenceBuilderService`，由该服务统一负责：
  - 读取核心三表：novel_episodes、drama_structure_template、novel_hook_rhythm；
  - 读取世界观相关表并按字符预算压缩；
  - 输出结构化 brief / context block。
- `NarratorScriptService` 在 generateDraft 中改为调用该聚合器，其它生成服务（如后续的 Script Architect、Shot Writer）也可复用同一套 context。
- 必选/可选参考表列表可按任务文档中的「核心三表 + 扩展参考表」在聚合器内做配置化（如表名列表 + 是否必选 + 字符预算）。

当前实现优先保证「生成 → 保存 → 编辑」链路稳定，聚合器抽取可在链路稳定后再做。

---

## 6. 生成对话框实现说明

- **入口**：Episode Script 工作台页「生成旁白主导脚本初稿」按钮点击后，先打开对话框，不再直接发起生成。
- **对话框内容**：
  - **每批集数 (batch size)**：数字输入，默认 5。
  - **模型**：可选文本输入，不填则使用后端默认（环境变量或 fallback）。
  - **起始集 / 结束集**：可选，用于限定生成范围。
- **提交**：点击「开始生成」后关闭对话框，调用 `narratorScriptApi.generateDraft(novelId, { batchSize, modelKey, startEpisode, endEpisode })`；生成完成后预览区显示集数及批次数（若有）。
- **参考表选择、输出目标表、生成模式（快速/标准/严格）**：本期未在 UI 实现，后端也未接对应参数；可在后续迭代中增加表勾选与模式字段，并由后端扩展 DTO 与逻辑。

---

## 7. 编排型多阶段代理说明

**当前状态**：未实现独立的 Context Planner、Script Architect、Shot Writer、QA Reviewer 四阶段编排；当前为「单阶段按批 LLM 生成 + 单次 persist」。

**建议**：

- 在「生成 5 集 → 保存成功 → Scene/Shot 可编辑 → prompt 可改」这条链路稳定后，再引入多阶段编排。
- 可先在同一 service 内用分层函数实现：例如 `buildContext()` → `generateScriptBatches()` → `expandShotsAndPrompts()` → `runQAReview()`，再按需拆成独立 service 或 pipeline 节点。
- 不做「自由对话式多 agent」，保持「编排型多阶段流水线」：每阶段输入输出明确，失败时返回明确错误与 episode range。

---

## 8. 模型配置化说明

- **默认模型**：`getNarratorDefaultModel()` 优先读取 `process.env.NARRATOR_DEFAULT_MODEL`，未配置时使用常量 `NARRATOR_MODEL_FALLBACK`（如 `claude-3-5-sonnet-20241022`）。
- **请求模型**：生成时 `modelKey = dto.modelKey || this.getNarratorDefaultModel()`，最终 LLM 请求使用该 modelKey。
- **前端**：生成对话框提供可选「模型」输入框，传入即作为 `modelKey`，不传则后端用默认。
- **QA 模型**：当前未单独配置 QA 复修模型；若后续增加 QA 阶段，可增加 `NARRATOR_QA_DEFAULT_MODEL` 或 DTO 字段。

---

## 9. 前端 Fallback / Prompt 工作流增强

### Persist Fallback

- 保存时优先传 `draftId`，并附带 `draft: lastDraft ?? undefined`（若项目风格允许）。
- 若接口返回错误码 `NARRATOR_SCRIPT_DRAFT_CACHE_MISS`，前端自动使用全量 `lastDraft` 再调用一次 `persistDraft(novelId, { draft: lastDraft })`。
- 错误码从 `error.payload?.code` / `error.response?.data?.code` / `error.data?.code` 中提取，兼容当前 apiClient 返回结构。

### Shot Board Prompt 工作流

- **video_cn / video_en 突出显示**：在每个镜头的提示词区域，显式展示「video_cn: ✓ 已有」或「video_cn: 缺」；「video_en」同理。
- **快速补齐**：若缺 video_cn 或 video_en，提供「快速补齐」按钮，点击后打开新增提示词表单，类型已填为对应项，提示词正文默认使用该镜头 `visual_desc` 或占位文案「画面描述（请根据镜头画面说明填写）」。
- **新增 prompt 默认模板**：新增时 prompt 类型默认 `video_cn`，正文可为空或由快速补齐带入默认值；其它类型（如 image_cn）仍可手动输入。

---

## 10. 手工验证步骤

1. **生成**  
   - 进入某项目的 Episode Script 页，点击「生成旁白主导脚本初稿」。  
   - 在对话框中设置 batch size（如 5）、可选起始/结束集、可选模型。  
   - 点击「开始生成」，等待完成；确认预览显示集数与批次数。

2. **保存**  
   - 点击「保存草稿」。  
   - 确认无 `(intermediate value) is not iterable` 等报错；确认提示为「保存成功：x 版本，x 场，x 镜，x 条提示词，覆盖 x 集，x 批」。

3. **数据库**  
   - 查询 `episode_script_versions`、`episode_scenes`、`episode_shots`、`episode_shot_prompts`，确认 novel_id、episode_number、版本与条数一致。

4. **Scene/Shot 编辑**  
   - 进入对应集的 Script / Scene Board / Shot Board，确认可编辑场景与镜头。

5. **Prompt 与快速补齐**  
   - 在 Shot Board 中展开某镜头的提示词，确认 video_cn / video_en 状态显示正确；对缺项点击「快速补齐」，确认类型与默认正文正确并可保存。

6. **Cache miss fallback**  
   - 可选：清空或过期服务端 draft 缓存后，仅带 draftId 保存，确认返回 cache miss 后前端用全量 draft 重试并保存成功。

---

## 11. 已知限制与下一步建议

### 已知限制

- 共享世界观聚合器未抽取，仍内联在 NarratorScriptService。
- 编排型多阶段（Context Planner / Script Architect / Shot Writer / QA Reviewer）未实现；当前为单阶段按批生成 + 一次 persist。
- 生成对话框未包含：参考表勾选、输出目标表勾选、生成模式（快速/标准/严格）；character_visual_profiles 未绑入本次任务。
- QA 复修与 QA 模型未实现。

### 下一步建议

1. 稳定主链路：**生成 5 集 → 保存成功 → Scene/Shot 可编辑 → prompt 可改**，再扩展多阶段与质量复修。
2. 在链路稳定后：抽取共享世界观聚合器；按阶段拆分或实现 Script Architect / Shot Writer / QA Reviewer 编排。
3. 前端：可增加参考表与输出表勾选、生成模式选择；若接入 ai_model_catalog，可将模型选择改为下拉。
4. 配置：在部署环境中设置 `NARRATOR_DEFAULT_MODEL`（及后续 `NARRATOR_QA_DEFAULT_MODEL`），避免硬编码。

---

*报告生成时间：基于当前代码与对话摘要整理。*
