# Claude Code 专用指令：短剧生成链路深度优化 (P2/P3 架构)

## 指令目标

本指令旨在引导 Claude Code 对 `shortdrama` 仓库中的 AI 短剧生成链路进行深度重构。核心目标是解决 **`drama_source_text` 素材引用不完整、截断随意** 的问题，并同步落实《AI 短剧文本生成质量改进报告》中的关键建议，提升生成文本的“可拍性”与“戏剧张力”。

## 核心重构指令 (Claude Code Prompt)

请将以下内容复制并粘贴到 Claude Code 终端中执行：

```markdown
### TASK: 重构短剧生成链路的素材引用与质量控制逻辑

你现在是一名资深的后端架构师与 AI Prompt 工程师。请针对 `apps/api/src/pipeline/` 目录下的核心服务进行以下深度重构：

#### 1. 素材引用逻辑重构 (重点解决 drama_source_text 截断问题)
- **修改文件**: `material-sifting.service.ts`
- **重构目标**: 废弃简单的 `SOURCE_EXCERPT_MAX_CHARS` 截断逻辑。
- **具体要求**:
    - **全量引用/智能搜索**: 当 `novel_source_segments` 中的片段与当前集高度相关时，优先引入该片段的**完整上下文**，而非强行截断。
    - **语义召回增强**: 优化 `buildEvidencePack` 中的素材筛选逻辑。如果当前集涉及关键剧情转折，必须确保召回的 `source_material_context` 包含该情节在原著中的完整起承转合。
    - **Token 预算动态管理**: 引入智能 Token 预算分配机制。优先保障 `drama_source_text` 的完整性，若超出预算，应通过 LLM 总结非核心背景，而非物理截断戏剧冲突核心。

#### 2. Beat Planner 导演指令强化
- **修改文件**: `episode-story-generation.service.ts` 中的 `BEAT_PLANNER_SYSTEM_PROMPT`
- **重构目标**: 提升 `execution_blocks` 的“可拍性”指导。
- **具体要求**:
    - 在 Prompt 中增加逻辑：要求模型在填充 `must_show` 时，必须基于 `drama_source_text` 提供的细节，转化为具体的、可视化的动作（如：特写、音效、具体道具交互）。
    - 严禁在 `must_show` 中出现“主角意识到”、“局势紧张”等抽象描述。

#### 3. Writer Agent 执行力补强
- **修改文件**: `episode-story-generation.service.ts` 中的 `P2_WRITER_SYSTEM_PROMPT`
- **重构目标**: 强化“Show, Don't Tell”的硬性约束。
- **具体要求**:
    - 增加“像素级还原”指令：Writer 必须逐一兑现 `execution_blocks` 中的所有 `must_show` 项。
    - 引入负面示例：明确禁止将 `must_show` 简单复述，必须扩写为生动的短剧旁白。

#### 4. QA 门禁与自动重写闭环
- **修改文件**: `episode-story-generation.service.ts` 中的 `diagnoseEpisode` 与 `assertDraftQualityBeforePersist`
- **重构目标**: 统一质量标准，实现“不达标、不落库”。
- **具体要求**:
    - 将 `severeWeakHook` 和 `questionHookOnly` 的拦截逻辑扩展至所有非终局集。
    - 增加“模板句重复”检测的严重程度，若重复率过高，触发 `high severity` 警告并强制重写。

#### 5. 衔接上下文优化
- **修改逻辑**: 在 `generateDraft` 的批次循环中，除了传递 `prevTail`，增加传递上一集的“核心冲突状态”和“未竟悬念”的结构化摘要。

请先阅读相关文件，提出详细的修改方案，并在我确认后执行代码修改。
```

## 指令设计说明

### 1. 解决素材截断问题的逻辑
在原有的代码中，`material-sifting.service.ts` 使用了硬编码的字符限制（如 `SOURCE_EXCERPT_MAX_CHARS = 1000`）。这导致 LLM 拿到的素材往往是断头去尾的，无法理解完整的戏剧逻辑。
*   **改进点**：指令要求 Claude Code 修改 `buildEvidencePack` 逻辑，改为基于“戏剧单元”的完整引用。如果某个片段被判定为相关，则完整保留该片段，并通过 Token 预算管理（如优先压缩背景信息）来腾出空间。

### 2. 强化“导演执行谱”
改进报告指出，Writer 代理的“摘要味”重是因为 Beat Planner 给出的指令不够具体。
*   **改进点**：指令要求 Claude Code 在 `BEAT_PLANNER_SYSTEM_PROMPT` 中注入更强的约束，强制要求 `must_show` 必须是“可视化动作”，从而为 Writer 提供高质量的“剧本大纲”。

### 3. 闭环质量控制
目前的 QA 逻辑在某些环节存在“漏网之鱼”。
*   **改进点**：指令要求 Claude Code 统一 `diagnoseEpisode` 和 `assertDraftQualityBeforePersist` 的标准，确保任何存在 `high severity` 问题的文本都无法通过 `persist` 接口写入数据库，强制触发 `autoRewrite` 或人工干预。

## 使用建议

1.  **分步执行**：建议先让 Claude Code 修改 `material-sifting.service.ts` 并运行测试，确保素材引用逻辑正确后，再进行 Prompt 的修改。
2.  **上下文注入**：在执行指令前，确保 Claude Code 已经读取了 `apps/api/src/pipeline/` 下的所有 `.ts` 文件，以便它能理解完整的调用链路。
3.  **验证结果**：修改完成后，建议调用 `generateDraft` 接口，观察生成的 `storyText` 是否在细节丰富度和素材还原度上有显著提升。

---
**Manus AI** 编写于 2026年3月15日
