/** 单集草稿 */
export interface EpisodeStoryDraftEpisode {
  episodeNumber: number
  title?: string
  summary?: string
  storyText: string
  /** 规划节拍，来自 planner；persist 时写入 story_beat_json */
  storyBeat?: string
}

/** 故事草稿 */
export interface EpisodeStoryDraft {
  episodes: EpisodeStoryDraftEpisode[]
}

export type EpisodeStoryReferenceTable =
  | 'drama_novels'
  | 'drama_source_text'
  | 'novel_adaptation_strategy'
  | 'adaptation_modes'
  | 'novel_characters'
  | 'novel_key_nodes'
  | 'novel_timelines'
  | 'novel_explosions'
  | 'novel_skeleton_topics'
  | 'novel_skeleton_topic_items'
  | 'novel_source_segments'
  | 'set_core'
  | 'set_payoff_arch'
  | 'set_payoff_lines'
  | 'set_opponent_matrix'
  | 'set_opponents'
  | 'set_power_ladder'
  | 'set_traitor_system'
  | 'set_traitors'
  | 'set_traitor_stages'
  | 'set_story_phases'

export interface EpisodeStoryReferenceSummaryItem {
  table: string
  label: string
  rowCount: number
  fields: string[]
}

export interface EpisodeStoryPreviewRequest {
  modelKey?: string
  referenceTables: EpisodeStoryReferenceTable[]
  userInstruction?: string
  allowPromptEdit?: boolean
  promptOverride?: string
  sourceTextCharBudget?: number
  targetEpisodeCount?: number
  batchSize?: number
}

export interface EpisodeStoryPreviewResponse {
  promptPreview: string
  usedModelKey: string
  referenceTables: EpisodeStoryReferenceTable[]
  referenceSummary: EpisodeStoryReferenceSummaryItem[]
  warnings?: string[]
}

export interface EpisodeStoryBatchInfo {
  batchIndex: number
  range: string
  success: boolean
  episodeCount: number
}

export interface EpisodeStoryGenerateDraftResponse {
  draftId: string
  draft: EpisodeStoryDraft
  usedModelKey: string
  promptPreview?: string
  referenceSummary?: EpisodeStoryReferenceSummaryItem[]
  targetEpisodeCount?: number
  actualEpisodeCount?: number
  countMismatchWarning?: string
  warnings?: string[]
  batchInfo?: EpisodeStoryBatchInfo[]
  finalCompletenessOk?: boolean
}

export interface EpisodeStoryPersistPayload {
  draftId?: string
  draft?: EpisodeStoryDraft
  generationMode?: 'ai' | 'manual'
}

export interface EpisodeStoryPersistResponse {
  ok: true
  summary: { episodeNumbers: number[]; versionCount: number }
  warnings?: string[]
}

export interface EpisodeStoryCheckRequest {
  draftId?: string
  draft?: EpisodeStoryDraft
  versionIds?: number[]
  referenceTables?: string[]
  modelKey?: string
}

export interface StoryCheckReportEpisodeIssue {
  type: string
  message: string
  severity: 'low' | 'medium' | 'high'
}

/** 单集强冲突审计结果（check 返回） */
export interface EpisodeStrongConflictAudit {
  hasAntagonistAction: boolean
  hasProtagonistCounteraction: boolean
  hasReversal: boolean
  hasEndHook: boolean
  conflictIntensityLow: boolean
}

export interface StoryCheckReportEpisodeItem {
  episodeNumber: number
  issues: StoryCheckReportEpisodeIssue[]
  strongConflictAudit?: EpisodeStrongConflictAudit
}

export interface StoryCheckReportSuggestion {
  episodeNumber?: number
  suggestion: string
}

export interface StoryCheckReportDto {
  overallScore: number
  passed: boolean
  episodeIssues: StoryCheckReportEpisodeItem[]
  suggestions: StoryCheckReportSuggestion[]
  warnings?: string[]
}
