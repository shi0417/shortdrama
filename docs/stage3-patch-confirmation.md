# Stage 3 收尾补丁 — 实施前确认

## 1. 将修改的文件清单

| 补丁 | 文件 | 修改内容 |
|------|------|----------|
| Patch 1 | `apps/web/src/components/ProjectDetail.tsx` | 渲染 StoryTextPanel 时增加 `totalChapters={novel.totalChapters}` |
| Patch 2 | `apps/api/src/pipeline/dto/episode-story-generation.dto.ts` | EpisodeStoryCheckDto.referenceTables 校验白名单（@IsIn allowedEpisodeStoryReferenceTables each） |
| Patch 2 | `apps/api/src/pipeline/episode-story-generation.service.ts` | check() 内：构建参考上下文 → buildStoryCheckPrompt → 调 LLM → 解析为报告；runCheck 保留规则检查并合并 QA 结果；新增 issue type 维度 |
| Patch 2 | `apps/web/src/types/episode-story.ts` | 无需改契约，已有 referenceTables、episodeIssues[].issues[].type |
| Patch 2 | `apps/web/src/components/story-text/StoryGenerateDialog.tsx` | 检查报告区：展示 issue type、severity、message；无问题时显示「未发现明显问题，可进入写入步骤」 |
| Patch 3 | `apps/web/src/components/story-text/StoryTextPanel.tsx` | 新增 storyErrorMessage、storySuccessMessage；getErrorMessage 工具；preview/generate/check/persist 失败写 storyErrorMessage；persist 成功写 storySuccessMessage、刷新列表；成功区绿色提示条 |
| Patch 3 | `apps/web/src/components/story-text/StoryGenerateDialog.tsx` | 新增 props：errorMessage, successMessage；弹窗内错误区 / 成功区展示 |

## 2. 每个补丁点的落点文件

- **Patch 1**：仅 `ProjectDetail.tsx`。
- **Patch 2**：后端 `episode-story-generation.dto.ts`（referenceTables 白名单）、`episode-story-generation.service.ts`（QA v2 逻辑）；前端 `StoryGenerateDialog.tsx`（报告展示增强）。`episode-story-api.ts`、`StoryTextPanel` 已传 referenceTables，无需改请求形状。
- **Patch 3**：`StoryTextPanel.tsx`（状态 + getErrorMessage + 各 handler 设 error/success）、`StoryGenerateDialog.tsx`（展示 errorMessage/successMessage）。

## 3. 是否会影响现有 API 契约

- **Patch 1**：不影响。
- **Patch 2**：不破坏现有契约。`POST /pipeline/:novelId/episode-story-check` 已有 `referenceTables?: string[]`，仅后端对 referenceTables 做白名单校验并用于构建 QA 上下文；返回 `StoryCheckReportDto` 结构不变，仅 `episodeIssues[].issues[].type` 取值扩展（outline_mismatch、structure_mismatch 等），前端已按 type/message/severity 展示。
- **Patch 3**：不影响 API，仅前端状态与 UI。

## 4. 预计不修改的文件清单

- `apps/api/sql/20260314_create_episode_story_versions.sql`
- `apps/api/src/pipeline/episode-story-version.service.ts`
- `apps/api/src/pipeline/episode-story-version.controller.ts`
- `apps/api/src/pipeline/dto/episode-story-version.dto.ts`
- `apps/api/src/pipeline/narrator-script.service.ts`
- `apps/api/src/pipeline/pipeline-episode-script.service.ts`
- `apps/api/src/pipeline/pipeline.controller.ts`（DTO 已支持 referenceTables，无需改路由）
- `apps/web/src/lib/episode-story-api.ts`（check 已传 referenceTables，无需改）
- 所有 migration / task / queue / SSE 相关文件

---

确认后按顺序实施：Patch 1 → Patch 2 → Patch 3。
