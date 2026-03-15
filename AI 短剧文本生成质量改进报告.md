# AI 短剧文本生成质量改进报告

## 摘要

本报告旨在深入分析用户提供的 `shortdrama` 云仓库代码及相关文档，针对 AI 短剧文本生成过程中出现的“质量不达标”问题，提出具体的改进建议。通过对现有生成链路（包括素材筛证、节拍规划、按谱写作及自动重写）的详细审查，我们发现尽管系统已具备先进的多代理架构，但生成质量问题主要源于 Prompt 设计的精细度不足、QA 规则的严格性欠缺以及代理间协作的优化空间。本报告将提供针对性的优化方案，以期显著提升 AI 短剧文本的“可拍性”、“引人入胜度”和“剧情衔接流畅性”。

## 1. 当前 AI 短剧文本生成链路概述

根据对 `shortdrama` 仓库代码（特别是 `episode-story-generation.service.ts` 和 `material-sifting.service.ts`）以及用户提供的设计文档的分析，当前 AI 短剧文本生成系统已实现了一个先进的**三阶段代理流水线**，并辅以自动重写机制，其架构与用户文档中提及的“方案 C：完整重构（爆款短剧生成链）”高度吻合。具体流程如下：

| 阶段 | 代理名称 | 核心功能 | 关键输入 | 关键输出 | 对应代码/文档 |
| :--- | :------- | :------- | :------- | :------- | :------------ |
| **P2-1** | **素材筛证代理 (Material Sifting Agent)** | 动态从数据库“蒸馏”出与当前集最相关的“戏剧证据包”。 | `novelId`, `episodeNumber` | `DramaticEvidencePack` (JSON) | `material-sifting.service.ts`，`P2 阶段核心：Beat Planner 输入 Schema 设计提案.md` |
| **P2-2** | **Beat 规划代理 (Beat Planner Agent)** | 根据“戏剧证据包”和严格的 JSON Schema，规划每集的详细故事节拍。 | `DramaticEvidencePack`, `prevTailBeat` | `StoryBeatJson` (JSON) | `episode-story-generation.service.ts` (`runBeatPlanner`), `P2 阶段核心：Beat Planner Agent 最终 Prompt 设计 (V1).md` |
| **P2-3** | **Writer 代理 (Script Executor Agent)** | 将结构化的“故事节拍规划”精准扩写成生动、连贯、可拍摄的短剧故事正文。 | `StoryBeatJson`, `prevTail`, `prevSummary` | `storyText` (纯文本) | `episode-story-generation.service.ts` (`runP2WriterBatch`), `P2 阶段核心：新版 Writer Agent Prompt 设计 (V1).md` |
| **P3** | **导演可拍性 QA 代理 (Rule-based QA)** | 对生成的 `storyText` 进行规则校验，诊断问题并生成结构化报告。 | `storyText`, `episodeNumber` | `EpisodeQaDiagnosis` | `episode-story-generation.service.ts` (`diagnoseEpisode`) |
| **P3** | **自动重写代理 (Auto-Rewrite Agent)** | 当 `storyText` 未通过 QA 时，根据 QA 报告和原始节拍规划进行精准修复。 | `storyText`, `StoryBeatJson`, `EpisodeQaDiagnosis` | 修复后的 `storyText` | `episode-story-generation.service.ts` (`runAutoRewrite`, `autoRewriteIfNeeded`), `P3 自动重写代理 (Auto-Rewrite Agent) — 一次性 Cursor 指令.md` |

整个流程由 `EpisodeStoryGenerationService` 中的 `generateDraft` 方法进行编排，实现了从数据准备到文本生成再到质量修复的自动化闭环。

## 2. “质量不达标”问题分析

尽管系统架构已趋于完善，但生成文本仍存在“质量不达标”（摘要味重、不可拍、衔接差、不引人入胜）的问题，这主要归因于以下几个方面：

### 2.1 Prompt 设计的精细度与执行力问题

1.  **Beat Planner Prompt (BEAT_PLANNER_SYSTEM_PROMPT)**：
    *   **优点**：已明确要求输出 `hook_3s`, `conflict_15s`, `mid_reversal`, `climax`, `tail_hook` 等关键节拍，并引入 `execution_blocks` 概念，试图将策划意图转化为可执行的指令。对终局集（59-61）的收束有明确要求。
    *   **潜在问题**：
        *   `execution_blocks` 的 `must_show` 和 `forbidden` 字段在 Prompt 中仅作为示例，实际填充时可能不够具体或模型理解不到位，导致 Writer 代理在扩写时仍有自由发挥空间，未能完全“按谱填词”。
        *   `single_goal` 和 `antagonist_goal` 的定义可能仍需强化，确保模型在规划时能围绕核心冲突展开，避免剧情发散。
        *   `estimated_word_count` 虽有，但模型在规划时可能未充分考虑其对节拍描述粒度的影响。

2.  **Writer Agent Prompt (P2_WRITER_SYSTEM_PROMPT)**：
    *   **优点**：明确要求“按执行块逐块写”，并强调“must_show 必须落成具体动作”，禁止“心理句/总结句”。对第一人称、字数、钩子类型、改写目标等有硬性约束。
    *   **潜在问题**：
        *   尽管有“绝对命令”，但 LLM 仍可能在细节上“偷懒”，例如将 `must_show` 简单复述而非扩写成生动场景，或在字数压力下牺牲细节。
        *   `execution_blocks` 的 `must_show` 列表在 Writer 阶段的实际运用中，模型是否能将其完全转化为具体的、可拍的文字，是关键挑战。如果 `must_show` 本身不够“可拍”，Writer 也很难生成高质量文本。
        *   批次间的衔接 (`prevTail`, `prevSummary`) 机制，虽然已从 `summary` 改进为 `storyText` 尾部片段，但仍可能存在上下文丢失或衔接生硬的问题，尤其是在跨批次的关键剧情点。

3.  **Auto-Rewrite Agent Prompt (AUTO_REWRITE_SYSTEM_PROMPT)**：
    *   **优点**：明确了修复规则，并允许在特定高严重度问题（如 `rewrite_goal_violation`, `ending_closure_missing`）时进行“结构性重写”，而非仅“最小化修复”，这对于纠正根本性问题至关重要。
    *   **潜在问题**：
        *   修复规则的描述虽然详细，但模型对“最小化修复”与“结构性重写”的边界理解可能存在偏差，导致过度修改或修改不足。
        *   `AUTO_REWRITE_MAX_RETRIES` 设置为 2 次，如果问题复杂，可能不足以完全修复。

### 2.2 QA 规则的严格性与反馈机制问题

1.  **`diagnoseEpisode` 方法**：
    *   **优点**：已实现了多维度的规则校验，包括字数、第一人称、事件密度、结尾钩子类型、改写目标一致性、终局收束等，并能识别出 `high severity` 问题。
    *   **潜在问题**：
        *   QA 规则的阈值（如 `MIN_NARRATION_CHARS_STRONG` = 360 字）是否完全符合“爆款短剧”的实际需求？有时字数达标不代表内容丰富。
        *   对于一些难以量化的“引人入胜”或“剧情流畅”等主观质量，纯规则 QA 难以覆盖。例如，“模板句重复较多”虽然有警告，但并未设置为 `high severity` 阻断。

2.  **`assertDraftQualityBeforePersist` 方法**：
    *   **优点**：在写入数据库前设置了硬门槛，能拦截字数过短、第三人称、终局违规等严重问题。
    *   **潜在问题**：
        *   虽然 `diagnoseEpisode` 能识别 `severeWeakHook` 和 `questionHookOnly` 等 `high severity` 问题，但 `assertDraftQualityBeforePersist` 中对这些问题的拦截逻辑（仅对 `episodeNumber < 59` 生效）可能不够全面，导致非终局集的弱钩子仍有机会落库。
        *   `overallScore < 60` 的判断标准可能需要结合更细致的权重和规则，以更准确地反映综合质量。

### 2.3 数据投喂的精准度与上下文管理

1.  **`MaterialSiftingService`**：
    *   **优点**：已实现按集筛选 `global_context`, `temporal_context`, `character_context`, `plotline_context` 等，并能从 `novel_source_segments` 中提取相关文本片段，显著优于“数据漫灌”模式。
    *   **潜在问题**：
        *   `source_material_context` 的提取依赖于关键词和 `outline_content`，如果 `outline_content` 本身不够详细，或关键词匹配不精准，可能导致召回的源材料不够“戏剧化”或与当前集情节关联度不高。
        *   `relevant_source_segments` 的数量和长度限制（`SOURCE_SEGMENTS_MAX`, `SOURCE_EXCERPT_MAX_CHARS`）是否能充分提供 LLM 所需的细节，尤其是在需要丰富历史背景或人物细节时。

## 3. 改进建议

基于上述分析，我们提出以下改进建议，旨在进一步提升 AI 短剧文本的生成质量：

### 3.1 Prompt 优化与强化执行力

1.  **细化 Beat Planner 的 `execution_blocks` 填充逻辑**：
    *   **建议**：在 `MaterialSiftingService` 或 `runBeatPlanner` 内部，增加逻辑，根据 `pacing_structure` 中每个节拍（`hook_3s`, `conflict_15s`, `mid_reversal`, `climax`, `tail_hook`）的 `description`，自动生成更具体、更“可拍”的 `must_show` 列表，并明确 `forbidden` 项。例如，如果 `hook_3s.description` 是“一支带血的箭射在宫门上”，`must_show` 可以自动生成“画面：带血的箭特写”、“箭射中宫门的声音”、“宫门震动”。
    *   **目的**：为 Writer 代理提供更明确的“导演指令”，减少其自由发挥空间，确保节拍的“像素级”还原。

2.  **Writer Prompt 增加“Show, Don't Tell”的量化约束**：
    *   **建议**：在 `P2_WRITER_SYSTEM_PROMPT` 中，除了文字描述，可以尝试引入一些量化指标或负面示例，进一步强调“Show, Don't Tell”。例如，明确禁止使用“主角感到”、“局势紧张”等抽象词汇，并提供更多“具体动作描写”的正面示例。
    *   **目的**：引导 Writer 代理生成更具画面感和动作性的文本，避免摘要化。

3.  **优化批次间衔接的上下文传递**：
    *   **建议**：除了 `prevTail`（上一集结尾 200 字）和 `prevSummary`，可以考虑传递上一集的**关键人物状态、未解决的悬念、或核心冲突的最新进展**等结构化信息。这可以通过扩展 `StoryBeatJson` 或 `DramaticEvidencePack` 来实现，并在 `runBeatPlanner` 和 `runP2WriterBatch` 中作为额外的上下文输入。
    *   **目的**：确保剧情衔接更自然，避免重复或逻辑断裂。

### 3.2 强化 QA 规则与质量门禁

1.  **提升 `diagnoseEpisode` 的智能性**：
    *   **建议**：
        *   **引入 LLM-based QA**：对于难以通过正则表达式或字数统计量化的质量维度（如“引人入胜”、“剧情流畅”、“情感张力”），可以引入一个轻量级的 LLM-based QA 代理。该代理接收 `storyText` 和 `StoryBeatJson`，评估其是否符合“爆款短剧”的叙事要求，并给出评分或结构化反馈。这个 LLM-based QA 可以作为 `diagnoseEpisode` 的补充，其结果可以影响 `overallScore` 或生成额外的 `high severity` 问题。
        *   **动态调整阈值**：根据不同剧本类型或用户偏好，允许配置 `MIN_NARRATION_CHARS_STRONG` 等阈值。
    *   **目的**：覆盖更广泛的质量维度，提高 QA 的准确性和灵活性。

2.  **严格化 `assertDraftQualityBeforePersist` 的拦截逻辑**：
    *   **建议**：
        *   **统一弱钩子拦截**：将 `severeWeakHook` 和 `questionHookOnly` 的拦截逻辑扩展到所有非终局集，确保所有集数的结尾都具有强事件型钩子。
        *   **整合 `overallScore` 与 `high severity` 拦截**：确保 `overallScore < 60` 或存在任何 `high severity` 问题时，都严格禁止写入，强制进行修复。
        *   **增加“模板句重复”的拦截**：当 `templateRepeatCount` 达到一定阈值时，将其升级为 `high severity` 问题并拦截。
    *   **目的**：从源头控制低质量文本的流入，确保数据库中的内容均符合高标准。

### 3.3 优化数据投喂与上下文管理

1.  **增强 `source_material_context` 的召回策略**：
    *   **建议**：
        *   **语义搜索优化**：如果当前 `novel_source_segments` 的向量搜索效果不佳，可以考虑优化向量模型的选择、分段策略或查询扩展技术，确保召回的文本片段与当前集情节的语义关联度更高。
        *   **多源融合**：除了 `drama_source_text`，可以考虑将 `novel_timelines`, `novel_key_nodes` 等结构化数据也通过某种方式（如转换为文本片段）融入 `source_material_context`，为 LLM 提供更丰富的历史细节和关键事件。
    *   **目的**：为 Beat Planner 提供更精准、更丰富的原始素材，使其能规划出更具深度和细节的节拍。

2.  **引入“世界观一致性检查”**：
    *   **建议**：在 `MaterialSiftingService` 或 Beat Planner 阶段，增加对生成内容与 `set_core`, `set_power_ladder`, `set_story_phases` 等世界观设定一致性的检查。例如，如果主角当前权力等级为 Lv.1，则其 `single_goal` 或 `protagonist_action` 不应超出其能力边界。
    *   **目的**：确保生成的故事文本在宏观设定上不跑偏，保持世界观的严谨性。

## 4. 实施路线图建议

考虑到系统已具备 P2/P3 架构，建议按照以下优先级逐步实施改进：

1.  **短期（立即实施）**：
    *   **Prompt 优化**：细化 `execution_blocks` 的自动生成逻辑，并对 Writer Prompt 增加更具体的“Show, Don't Tell”量化约束。
    *   **QA 强化**：严格化 `assertDraftQualityBeforePersist` 中的弱钩子和模板句重复拦截逻辑。
    *   **衔接优化**：扩展批次间上下文传递，包含上一集的关键人物状态或未解决悬念。

2.  **中期（迭代实施）**：
    *   **LLM-based QA**：引入轻量级 LLM-based QA 代理，评估主观质量维度。
    *   **数据召回优化**：持续优化 `source_material_context` 的语义召回策略。
    *   **世界观一致性检查**：在 Beat Planner 阶段引入初步的世界观一致性检查。

3.  **长期（持续探索）**：
    *   **多模态融合**：探索将视觉元素（如角色视觉设定 `character_visual_profiles`）融入生成流程，提升文本的可拍性。
    *   **用户反馈闭环**：建立用户对生成文本的反馈机制，并将其融入模型训练或强化学习过程，实现持续优化。

## 5. 总结

`shortdrama` 项目在 AI 短剧文本生成方面已构建了坚实的基础架构。当前面临的“质量不达标”问题并非架构缺陷，而是 Prompt 精细度、QA 严格性及数据利用效率的优化空间。通过本报告提出的具体改进建议，特别是对 Prompt 的精细化调整和 QA 门槛的强化，我们有信心能够显著提升 AI 生成短剧文本的质量，使其更具“爆款”潜力。

---
