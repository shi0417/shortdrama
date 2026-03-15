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

/**
 * 戏剧证据包 — 单集维度的可拍短剧输入。
 * 由 MaterialSiftingService.buildEvidencePack(novelId, episodeNumber) 产出。
 */
export interface DramaticEvidencePack {
  novelId: number;
  episodeNumber: number;

  /** 本集分集信息 */
  episode: EvidenceEpisode | null;

  /** 核心设定（改写目标、主角、约束等） */
  core: EvidenceCore | null;

  /** 人物列表 */
  characters: EvidenceCharacter[];

  /** 对手列表（可与本集阶段过滤） */
  opponents: EvidenceOpponent[];

  /** 覆盖本集的爽点线 */
  payoffLines: EvidencePayoffLine[];

  /** 覆盖本集的故事阶段 */
  storyPhases: EvidenceStoryPhase[];

  /** 本集钩子要求 */
  hookRhythm: EvidenceHookRhythm | null;

  /** 本集相关关键节点（可选） */
  keyNodes: EvidenceKeyNode[];

  /** 时间线事件（可选，可为空） */
  timelineEvents: EvidenceTimelineEvent[];

  /** 本集相关史料/原文摘要（可选，来自 drama_source_text 或 novel_source_segments 的节选） */
  sourceSummary?: string;
}
