# Claude Code 深度重构指令：短剧生成链路全方位进化 (基于代码深度分析)

## 指令目标

本指令旨在引导 Claude Code 对 `shortdrama` 仓库进行全方位的架构升级。通过深度分析 `material-sifting.service.ts` 和 `episode-story-generation.service.ts`，本指令精准定位了素材截断、Prompt 约束不足及 QA 门禁漏洞，并整合了**短期、中期、长期**改进方向。

## 核心重构指令 (Claude Code Prompt)

请将以下内容复制并粘贴到 Claude Code 终端中执行：

```markdown
### TASK: 基于代码细节全方位重构短剧生成链路 (整合短/中/长期改进方向)

你现在是一名资深的 AI 架构师。请针对 `apps/api/src/pipeline/` 目录下的核心服务进行以下深度重构，确保系统不仅解决当前的素材引用问题，还能为未来的多模态和反馈闭环打下基础：

#### 1. 素材引用与数据召回优化 (解决截断问题 & 中期目标)
- **修改文件**: `material-sifting.service.ts`
- **重构逻辑**: 
    - **废弃硬截断**: 修改 `fetchSourceMaterialContext` 和 `fetchSourceExcerptByKeywords`。废弃 `SOURCE_EXCERPT_MAX_CHARS` (10000) 的物理截断逻辑。
    - **引入 PriorityTokenManager**: 实现一个智能 Token 管理器。当 `novel_source_segments` 命中时，优先引入**完整段落**。若总长度超限，应通过 LLM 总结非核心背景（如环境描写），而非物理截断戏剧冲突核心。
    - **语义召回增强**: 优化 `fetchSourceExcerptByKeywords` 中的 `LIKE` 查询，结合 `segment_index` 确保召回的素材包含该情节在原著中的完整起承转合。

#### 2. Prompt 深度优化与衔接增强 (短期目标)
- **修改文件**: `episode-story-generation.service.ts`
- **Beat Planner 强化**: 在 `BEAT_PLANNER_SYSTEM_PROMPT` 中增加逻辑，要求 `execution_blocks` 的 `must_show` 必须基于素材细节转化为具体的、可视化的动作（特写、音效、具体道具交互）。
- **Writer 执行力补强**: 在 `P2_WRITER_SYSTEM_PROMPT` 中增加“Show, Don't Tell”量化约束，严禁抽象描述，强制逐一兑现 `must_show`。
- **衔接优化**: 在 `generateDraft` 批次循环中，除了 `prevTail`，增加传递上一集的“核心冲突状态”和“未竟悬念”的结构化摘要。

#### 3. 质量门禁与智能 QA (短期 & 中期目标)
- **QA 强化**: 严格化 `assertDraftQualityBeforePersist`。确保 `severeWeakHook` 和 `questionHookOnly` 的拦截逻辑扩展至所有非终局集。
- **LLM-based QA 预留**: 在 `runCheck` 方法中，优化 `runStoryCheckLlm` 的调用，使其不仅检查参考表一致性，还评估“引人入胜度”和“情感张力”等主观维度。
- **世界观一致性检查**: 在 `runBeatPlanner` 阶段引入初步检查，确保 `single_goal` 不超出 `set_power_ladder` 定义的能力边界。

#### 4. 长期探索：多模态与反馈闭环架构 (长期目标)
- **多模态融合预留**: 在 `StoryBeatJson` 和 `DramaticEvidencePack` (见 `material-sifting.dto.ts`) 中增加 `visual_profiles` 字段，预留用于注入角色视觉设定。
- **用户反馈闭环**: 
    - 在 `EpisodeStoryDraft` 结构中增加 `user_feedback` 字段。
    - 在 `autoRewriteIfNeeded` 逻辑中，增加对 `user_feedback` 的读取，使其能根据用户之前的修改偏好进行“个性化重写”。

请先阅读相关文件，提出详细的修改方案，并在我确认后执行代码修改。
```

## 指令设计说明 (基于代码分析)

### 1. 精准定位素材截断
在 `material-sifting.service.ts` 第 327-329 行及第 382-385 行，系统使用了 `SOURCE_EXCERPT_MAX_CHARS` 进行物理截断。
*   **改进点**：指令明确要求废弃这种“一刀切”的做法，改为“戏剧单元完整引用”，通过智能总结非核心内容来释放 Token 空间。

### 2. 强化“按谱填词”
在 `episode-story-generation.service.ts` 中，`P2_WRITER_SYSTEM_PROMPT` 虽然提到了 `must_show`，但缺乏对“如何扩写”的量化指导。
*   **改进点**：指令要求在 Prompt 中注入“像素级还原”要求，确保 Writer 代理不会跳过任何一个 `execution_block` 中的细节。

### 3. 架构前瞻性
*   **多模态**：通过在 DTO 中预留 `visual_profiles`，为未来接入分镜图生成代理做准备。
*   **反馈闭环**：通过在 `autoRewriteIfNeeded` 中引入 `user_feedback`，使系统具备学习用户审美偏好的潜力。

## 使用建议

1.  **Schema 同步**：由于涉及 `StoryBeatJson` 和 `DramaticEvidencePack` 的修改，请确保 Claude Code 同步更新了 `material-sifting.dto.ts`。
2.  **分步验证**：建议先让 Claude Code 完成 `material-sifting.service.ts` 的重构，验证素材引用是否完整，再进行 Prompt 的优化。

---
**Manus AI** 编写于 2026年3月15日
