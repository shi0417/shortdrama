/**
 * 戏剧证据包 DTO — 按集筛证后的可拍短剧输入结构。
 * 对应审计/方案中的「素材筛证代理」输出：本集相关史料摘要、人物、对手、爽点线、阶段、钩子要求等。
 * 若存在 dramatic_evidence_pack_proposal.md，可与其 Schema 对齐后微调字段。
 */

/** 本集分集信息（来自 novel_episodes） */
export interface EvidenceEpisode {
  episodeNumber: number;
  episodeTitle?: string;
  arc?: string;
  opening?: string;
  coreConflict?: string;
  hooks?: string;
  cliffhanger?: string;
  outlineContent?: string;
  historyOutline?: string;
  rewriteDiff?: string;
}

/** 核心设定（来自 set_core，单条） */
export interface EvidenceCore {
  title?: string;
  coreText?: string;
  protagonistName?: string;
  protagonistIdentity?: string;
  targetStory?: string;
  rewriteGoal?: string;
  constraintText?: string;
}

/** 人物（来自 novel_characters） */
export interface EvidenceCharacter {
  name: string;
  faction?: string;
  description?: string;
  personality?: string;
}

/** 对手（来自 set_opponents，可与本集阶段/权力阶梯关联） */
export interface EvidenceOpponent {
  levelName?: string;
  opponentName: string;
  threatType?: string;
  detailedDesc?: string;
  sortOrder?: number;
}

/** 爽点线（来自 set_payoff_lines，仅含覆盖本集 start_ep~end_ep 的条目） */
export interface EvidencePayoffLine {
  lineKey?: string;
  lineName?: string;
  lineContent?: string;
  startEp?: number;
  endEp?: number;
  stageText?: string;
  sortOrder?: number;
}

/** 故事阶段（来自 set_story_phases，仅含覆盖本集的阶段） */
export interface EvidenceStoryPhase {
  phaseName?: string;
  startEp?: number;
  endEp?: number;
  historicalPath?: string;
  rewritePath?: string;
  sortOrder?: number;
}

/** 本集钩子节奏（来自 novel_hook_rhythm，单集） */
export interface EvidenceHookRhythm {
  episodeNumber: number;
  emotionLevel?: string | number;
  hookType?: string;
  description?: string;
  cliffhanger?: string;
}

/** 关键节点（来自 novel_key_nodes，可选按时间线/集数关联） */
export interface EvidenceKeyNode {
  category?: string;
  title?: string;
  description?: string;
  timelineId?: number;
  sortOrder?: number;
}

/** 时间线事件（来自 novel_timelines，可选） */
export interface EvidenceTimelineEvent {
  timeNode?: string;
  event?: string;
  sortOrder?: number;
}

/** 权力阶梯（来自 set_power_ladder，覆盖本集的档位） */
export interface EvidencePowerLevel {
  levelNo?: number;
  levelTitle?: string;
  identityDesc?: string;
  abilityBoundary?: string;
  startEp?: number;
  endEp?: number;
  sortOrder?: number;
}

// ---------- 五类上下文（buildEvidencePack 分步查询结果） ----------

/** 1. global_context：来自 set_core */
export interface GlobalContext {
  rewriteGoal?: string;
  protagonistName?: string;
  /** 对应 DB constraint_text，指令中的 core_constraint */
  coreConstraint?: string;
}

/** 2. temporal_context：本集所处阶段、权力档位、时间线事件 */
export interface TemporalContext {
  /** 本集所在故事阶段（set_story_phases WHERE episode BETWEEN start_ep AND end_ep） */
  currentStoryPhase: EvidenceStoryPhase | null;
  /** 本集所在权力档位（set_power_ladder WHERE episode BETWEEN start_ep AND end_ep，取首条） */
  currentPowerLevel: EvidencePowerLevel | null;
  /** 与当前阶段关联的时间线事件（初期可空；最终可与 current_story_phase 关联） */
  currentTimelineEvents: EvidenceTimelineEvent[];
}

/** 3. character_context：主角状态与活跃对手 */
export interface CharacterContext {
  /** 主角信息 + 本集 immediate_goal（由 novel_episodes.outline_content 提炼） */
  protagonistStatus: (EvidenceCharacter & { immediateGoal?: string }) | null;
  /** 活跃对手（set_opponents，可按 opponent_matrix_id 或 set_story_phases 过滤） */
  activeOpponents: EvidenceOpponent[];
}

/** 4. plotline_context：爽点线与钩子节奏 */
export interface PlotlineContext {
  /** 覆盖本集的爽点线 */
  activePayoffLines: EvidencePayoffLine[];
  /** 本集钩子节奏要求 */
  requiredHookRhythm: EvidenceHookRhythm | null;
}

/** 5. source_material_context：史料原文（初期截取前 N 字；最终可做 Top-K 语义检索） */
export interface SourceMaterialContext {
  /** 初期简化：drama_source_text 前 10000 字；最终目标：按 outline 向量 Top-K 检索结果 */
  excerpt?: string;
}

/**
 * 戏剧证据包 — 单集维度的可拍短剧输入。
 * 由 MaterialSiftingService.buildEvidencePack(novelId, episodeNumber) 产出。
 * 同时提供「五类上下文」结构与原有平铺字段，便于下游按需使用。
 */
export interface DramaticEvidencePack {
  novelId: number;
  episodeNumber: number;

  /** 1. 全局设定（rewrite_goal, protagonist_name, core_constraint） */
  globalContext: GlobalContext;

  /** 2. 时间/阶段语境（当前故事阶段、权力档位、时间线事件） */
  temporalContext: TemporalContext;

  /** 3. 人物语境（主角状态 + 本集目标，活跃对手） */
  characterContext: CharacterContext;

  /** 4. 情节线语境（活跃爽点线、本集钩子要求） */
  plotlineContext: PlotlineContext;

  /** 5. 史料语境（原文摘录，初期前 10000 字） */
  sourceMaterialContext: SourceMaterialContext;

  // ---------- 以下保留原有平铺结构，便于兼容 ----------
  /** 本集分集信息 */
  episode: EvidenceEpisode | null;
  /** 核心设定（改写目标、主角、约束等） */
  core: EvidenceCore | null;
  /** 人物列表 */
  characters: EvidenceCharacter[];
  /** 对手列表 */
  opponents: EvidenceOpponent[];
  /** 覆盖本集的爽点线 */
  payoffLines: EvidencePayoffLine[];
  /** 覆盖本集的故事阶段 */
  storyPhases: EvidenceStoryPhase[];
  /** 本集钩子要求 */
  hookRhythm: EvidenceHookRhythm | null;
  /** 本集相关关键节点（可选） */
  keyNodes: EvidenceKeyNode[];
  /** 时间线事件（可选） */
  timelineEvents: EvidenceTimelineEvent[];
  /** 本集相关史料/原文摘要（与 sourceMaterialContext.excerpt 一致或衍生） */
  sourceSummary?: string;
}
