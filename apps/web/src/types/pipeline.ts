export interface SkeletonTopicDto {
  id: number
  novelId: number
  topicKey: string
  topicName: string
  topicType: 'text' | 'list' | 'json'
  description: string | null
  sortOrder: number
  isEnabled: number
  createdAt: string
  updatedAt: string
}

export interface SkeletonTopicItemDto {
  id: number
  novelId: number
  topicId: number
  itemTitle: string | null
  content: string | null
  contentJson: unknown
  sortOrder: number
  sourceRef: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateSkeletonTopicPayload {
  topicKey: string
  topicName: string
  topicType: 'text' | 'list' | 'json'
  description?: string
  sortOrder?: number
  isEnabled?: number
}

export interface UpdateSkeletonTopicPayload {
  topicKey?: string
  topicName?: string
  topicType?: 'text' | 'list' | 'json'
  description?: string
  sortOrder?: number
  isEnabled?: number
}

export interface SetCoreDto {
  id: number
  novelId: number
  title: string | null
  coreText: string | null
  protagonistName: string | null
  protagonistIdentity: string | null
  targetStory: string | null
  rewriteGoal: string | null
  constraintText: string | null
  version: number
  isActive: number
  createdAt: string
  updatedAt: string
}

export interface SetCoreVersionDto {
  id: number
  novelId: number
  title: string | null
  version: number
  isActive: number
  createdAt: string
  updatedAt: string
}

export interface AiModelOptionDto {
  id: number
  modelKey: string
  displayName: string
  provider: string
  family: string
  modality: string
}

export interface EnhanceSetCoreCurrentFields {
  title?: string
  protagonistName?: string
  protagonistIdentity?: string
  targetStory?: string
  rewriteGoal?: string
  constraintText?: string
}

export interface EnhanceSetCorePayload {
  modelKey: string
  referenceTables: string[]
  currentCoreText?: string
  currentFields?: EnhanceSetCoreCurrentFields
  userInstruction?: string
  allowPromptEdit?: boolean
  promptOverride?: string
}

export interface EnhanceSetCorePromptPreviewPayload {
  modelKey?: string
  referenceTables: string[]
  currentCoreText?: string
  currentFields?: EnhanceSetCoreCurrentFields
  userInstruction?: string
}

export interface EnhanceSetCorePromptPreviewResponseDto {
  promptPreview: string
  usedModelKey: string
  referenceTables: string[]
}

export interface EnhanceSetCoreResponseDto {
  title: string
  coreText: string
  protagonistName: string
  protagonistIdentity: string
  targetStory: string
  rewriteGoal: string
  constraintText: string
  usedModelKey: string
  promptPreview: string
}

export interface UpsertSetCorePayload {
  title?: string
  coreText?: string
  protagonistName?: string
  protagonistIdentity?: string
  targetStory?: string
  rewriteGoal?: string
  constraintText?: string
  mode?: 'update_active' | 'new_version'
}

export type PipelineExtractReferenceTable =
  | 'drama_novels'
  | 'drama_source_text'
  | 'novel_adaptation_strategy'
  | 'adaptation_modes'
  | 'set_core'

export interface PipelineExtractRequest {
  modelKey: string
  referenceTables: PipelineExtractReferenceTable[]
  userInstruction?: string
  allowPromptEdit?: boolean
  promptOverride?: string
}

export interface PipelineExtractPromptPreviewResponse {
  promptPreview: string
  usedModelKey: string
  referenceTables: PipelineExtractReferenceTable[]
}

export interface PipelineExtractCommitResponse {
  ok: true
  summary: {
    timelines: number
    characters: number
    keyNodes: number
    skeletonTopicItems: number
    explosions: number
  }
  warnings?: string[]
  details?: {
    enabledTopicCount: number
    enabledTopicKeys: string[]
    normalizedCounts: {
      timelines: number
      characters: number
      keyNodes: number
      skeletonTopicItems: number
      explosions: number
    }
    skeletonTopicItemsRequestedGroups: number
    skeletonTopicItemsRequestedItems: number
    skeletonTopicItemsInserted: number
    skeletonTopicItemsDropped: number
  }
}

export type PipelineWorldviewReferenceTable =
  | 'drama_novels'
  | 'drama_source_text'
  | 'novel_adaptation_strategy'
  | 'adaptation_modes'
  | 'set_core'
  | 'novel_timelines'
  | 'novel_characters'
  | 'novel_key_nodes'
  | 'novel_skeleton_topics'
  | 'novel_skeleton_topic_items'
  | 'novel_explosions'

export interface PipelineWorldviewReferenceSummaryItem {
  table: PipelineWorldviewReferenceTable
  label: string
  rowCount: number
  fields: string[]
  usedChars?: number
  originalChars?: number
  note?: string
  segmentCount?: number
  chapterCount?: number
  usedFallback?: boolean
  moduleEvidenceCount?: Record<string, number>
}

export interface PipelineWorldviewEvidenceSummary {
  evidenceSegments: number
  coverageChapters: number
  evidenceChars: number
  fallbackUsed: boolean
  moduleEvidenceCount: Record<string, number>
}

export type PipelineWorldviewQualityModuleKey =
  | 'payoff'
  | 'opponents'
  | 'power'
  | 'traitor'
  | 'story_phase'

export type PipelineWorldviewClosureModuleKey =
  | PipelineWorldviewQualityModuleKey
  | 'evidence'

export type PipelineWorldviewQualitySeverity = 'bad' | 'weak'

export interface PipelineWorldviewQualityWarning {
  moduleKey: PipelineWorldviewQualityModuleKey
  path: string
  severity: PipelineWorldviewQualitySeverity
  reason: string
}

export interface PipelineWorldviewQualitySummary {
  totalIssues: number
  badCount: number
  weakCount: number
  byModule: Record<PipelineWorldviewQualityModuleKey, { bad: number; weak: number }>
}

export interface PipelineWorldviewInferenceSummary {
  storyPhase: {
    storyPhaseIntervalsInferred: number
    storyPhaseIntervalsAdjusted: number
    notes: string[]
  }
  payoff: {
    payoffIntervalsInferred: number
    payoffIntervalsAdjusted: number
    notes: string[]
  }
  power: {
    powerIntervalsInferred: number
    powerIntervalsAdjusted: number
    notes: string[]
  }
  traitorStage: {
    traitorStageIntervalsInferred: number
    traitorStageIntervalsAdjusted: number
    notes: string[]
  }
}

export interface PipelineWorldviewAlignmentSummary {
  totalIssues: number
  byModule: Record<PipelineWorldviewQualityModuleKey, number>
}

export interface PipelineWorldviewAlignmentWarning {
  moduleKey: PipelineWorldviewQualityModuleKey
  path: string
  severity: PipelineWorldviewQualitySeverity
  reason: string
}

export interface PipelineWorldviewLineDraft {
  line_key: string
  line_name: string
  line_content: string
  start_ep: number | null
  end_ep: number | null
  stage_text: string | null
  sort_order: number
}

export interface PipelineWorldviewOpponentDraft {
  level_name: string
  opponent_name: string
  threat_type: string | null
  detailed_desc: string | null
  sort_order: number
}

export interface PipelineWorldviewPowerLadderDraft {
  level_no: number
  level_title: string
  identity_desc: string
  ability_boundary: string
  start_ep: number | null
  end_ep: number | null
  sort_order: number
}

export interface PipelineWorldviewTraitorDraft {
  name: string
  public_identity: string | null
  real_identity: string | null
  mission: string | null
  threat_desc: string | null
  sort_order: number
}

export interface PipelineWorldviewTraitorStageDraft {
  stage_title: string
  stage_desc: string
  start_ep: number | null
  end_ep: number | null
  sort_order: number
}

export interface PipelineWorldviewStoryPhaseDraft {
  phase_name: string
  start_ep: number | null
  end_ep: number | null
  historical_path: string | null
  rewrite_path: string | null
  sort_order: number
}

export interface PipelineWorldviewDraft {
  setPayoffArch: {
    name: string
    notes: string
    lines: PipelineWorldviewLineDraft[]
  }
  setOpponentMatrix: {
    name: string
    description: string
    opponents: PipelineWorldviewOpponentDraft[]
  }
  setPowerLadder: PipelineWorldviewPowerLadderDraft[]
  setTraitorSystem: {
    name: string
    description: string
    traitors: PipelineWorldviewTraitorDraft[]
    stages: PipelineWorldviewTraitorStageDraft[]
  }
  setStoryPhases: PipelineWorldviewStoryPhaseDraft[]
}

export interface PipelineWorldviewRequest {
  modelKey?: string
  referenceTables: PipelineWorldviewReferenceTable[]
  userInstruction?: string
  allowPromptEdit?: boolean
  promptOverride?: string
  sourceTextCharBudget?: number
}

export interface PipelineWorldviewPreviewResponse {
  promptPreview: string
  usedModelKey: string
  referenceTables: PipelineWorldviewReferenceTable[]
  referenceSummary: PipelineWorldviewReferenceSummaryItem[]
  evidenceSummary?: PipelineWorldviewEvidenceSummary
  qualitySummary?: PipelineWorldviewQualitySummary
  qualityWarnings?: PipelineWorldviewQualityWarning[]
  inferenceSummary?: PipelineWorldviewInferenceSummary
  alignmentSummary?: PipelineWorldviewAlignmentSummary
  alignmentWarnings?: PipelineWorldviewAlignmentWarning[]
  validationReportPreview?: PipelineWorldviewValidationReport
  warnings?: string[]
}

export interface PipelineWorldviewGenerateDraftResponse {
  usedModelKey: string
  promptPreview: string
  referenceTables: PipelineWorldviewReferenceTable[]
  referenceSummary: PipelineWorldviewReferenceSummaryItem[]
  evidenceSummary?: PipelineWorldviewEvidenceSummary
  qualitySummary?: PipelineWorldviewQualitySummary
  qualityWarnings?: PipelineWorldviewQualityWarning[]
  inferenceSummary?: PipelineWorldviewInferenceSummary
  alignmentSummary?: PipelineWorldviewAlignmentSummary
  alignmentWarnings?: PipelineWorldviewAlignmentWarning[]
  validationReport?: PipelineWorldviewValidationReport
  initialValidationReport?: PipelineWorldviewValidationReport
  finalValidationReport?: PipelineWorldviewValidationReport
  repairSummary?: PipelineWorldviewRepairSummary
  closureStatus?: PipelineWorldviewClosureStatus
  repairApplied?: boolean
  evidenceReselected?: boolean
  draft: PipelineWorldviewDraft
  warnings?: string[]
  normalizationWarnings?: string[]
  validationWarnings?: string[]
}

export interface PipelineWorldviewPersistPayload {
  draft: PipelineWorldviewDraft
}

export interface PipelineWorldviewPersistResponse {
  ok: true
  summary: {
    payoffArch: number
    payoffLines: number
    opponentMatrix: number
    opponents: number
    powerLadder: number
    traitorSystem: number
    traitors: number
    traitorStages: number
    storyPhases: number
  }
  qualitySummary?: PipelineWorldviewQualitySummary
  qualityWarnings?: PipelineWorldviewQualityWarning[]
  inferenceSummary?: PipelineWorldviewInferenceSummary
  alignmentSummary?: PipelineWorldviewAlignmentSummary
  alignmentWarnings?: PipelineWorldviewAlignmentWarning[]
  normalizationWarnings?: string[]
  validationWarnings?: string[]
  validationReport?: PipelineWorldviewValidationReport
  closureStatus?: PipelineWorldviewClosureStatus
  repairApplied?: boolean
  evidenceReselected?: boolean
}

export type PipelineEpisodeScriptReferenceTable =
  | 'drama_novels'
  | 'drama_source_text'
  | 'novel_source_segments'
  | 'novel_adaptation_strategy'
  | 'adaptation_modes'
  | 'set_core'
  | 'novel_timelines'
  | 'novel_characters'
  | 'novel_key_nodes'
  | 'novel_explosions'
  | 'novel_skeleton_topics'
  | 'novel_skeleton_topic_items'
  | 'set_payoff_arch'
  | 'set_payoff_lines'
  | 'set_opponent_matrix'
  | 'set_opponents'
  | 'set_power_ladder'
  | 'set_traitor_system'
  | 'set_traitors'
  | 'set_traitor_stages'
  | 'set_story_phases'

export type PipelineEpisodeDurationMode = '60s' | '90s'
export type PipelineEpisodeGenerationMode =
  | 'outline_only'
  | 'outline_and_script'
  | 'overwrite_existing'

export interface PipelineEpisodeScriptReferenceSummaryItem {
  table: PipelineEpisodeScriptReferenceTable
  label: string
  rowCount: number
  fields: string[]
  note?: string
  usedChars?: number
}

export interface PipelineEpisodeScriptEpisodeItem {
  episodeNumber: number
  episodeTitle: string
  sortOrder: number
  outline: {
    arc: string
    opening: string
    coreConflict: string
    historyOutline: string
    rewriteDiff: string
    outlineContent: string
  }
  script: {
    hooks: string
    cliffhanger: string
    fullContent: string
  }
  structureTemplate: {
    chapterId: number
    themeType: string
    structureName: string
    powerLevel: number
    isPowerUpChapter: number
    powerUpContent: string
    identityGap: string
    pressureSource: string
    firstReverse: string
    continuousUpgrade: string
    suspenseHook: string
    typicalOpening: string
    suitableTheme: string
    hotLevel: number
    remarks: string
  }
  hookRhythm: {
    episodeNumber: number
    emotionLevel: number
    hookType: string
    description: string
    cliffhanger: string
  }
}

export interface PipelineEpisodeScriptDraft {
  episodePackage: {
    version: string
    novelId: number
    durationMode: PipelineEpisodeDurationMode
    episodes: PipelineEpisodeScriptEpisodeItem[]
  }
}

export interface PipelineEpisodeScriptRequest {
  modelKey?: string
  referenceTables: PipelineEpisodeScriptReferenceTable[]
  userInstruction?: string
  allowPromptEdit?: boolean
  promptOverride?: string
  sourceTextCharBudget?: number
  durationMode?: PipelineEpisodeDurationMode
  generationMode?: PipelineEpisodeGenerationMode
  targetEpisodeCount?: number
}

export interface PipelineEpisodeScriptPreviewResponse {
  promptPreview: string
  usedModelKey: string
  referenceTables: PipelineEpisodeScriptReferenceTable[]
  referenceSummary: PipelineEpisodeScriptReferenceSummaryItem[]
  warnings?: string[]
}

export interface PipelineEpisodeScriptGenerateDraftResponse {
  usedModelKey: string
  generationMode: string
  promptPreview: string
  referenceTables: PipelineEpisodeScriptReferenceTable[]
  referenceSummary: PipelineEpisodeScriptReferenceSummaryItem[]
  draft: PipelineEpisodeScriptDraft
  targetEpisodeCount?: number
  actualEpisodeCount?: number
  missingEpisodeNumbers?: number[]
  countMismatchWarning?: string
  warnings?: string[]
  normalizationWarnings?: string[]
  validationWarnings?: string[]
}

export interface PipelineEpisodeScriptPersistPayload {
  draft: PipelineEpisodeScriptDraft
  generationMode?: PipelineEpisodeGenerationMode
}

export interface PipelineEpisodeScriptPersistResponse {
  ok: true
  summary: {
    episodes: number
    structureTemplates: number
    hookRhythm: number
    generationMode: string
    episodeNumbers: number[]
    affectedTables: string[]
    skippedTables: string[]
    overwriteScopeDescription: string
  }
  warnings?: string[]
  normalizationWarnings?: string[]
  validationWarnings?: string[]
}

export type PipelineWorldviewValidationSeverity = 'fatal' | 'major' | 'minor'
export type PipelineWorldviewValidationSource = 'structure' | 'semantic' | 'relevance' | 'alignment'
export type PipelineWorldviewRepairStrategy = 'fix_in_place' | 'regenerate_module' | 'reselect_evidence'
export type PipelineWorldviewClosureStatus = 'accepted' | 'repaired' | 'low_confidence'
export type PipelineWorldviewRepairActionType = 'accept' | 'repair' | 'regenerate_modules'

export interface PipelineWorldviewValidationIssue {
  moduleKey: PipelineWorldviewClosureModuleKey
  path: string
  severity: PipelineWorldviewValidationSeverity
  reason: string
  repairStrategy: PipelineWorldviewRepairStrategy
  source: PipelineWorldviewValidationSource
}

export interface PipelineWorldviewValidationReport {
  passed: boolean
  score: number
  fatalCount: number
  majorCount: number
  minorCount: number
  issues: PipelineWorldviewValidationIssue[]
  recommendedAction: 'accept' | 'repair' | 'regenerate_modules' | 'reselect_evidence'
}

export interface PipelineWorldviewRepairSummary {
  actionType: PipelineWorldviewRepairActionType
  targetModules: PipelineWorldviewClosureModuleKey[]
  issueCountBefore: number
  issueCountAfter: number
  scoreBefore: number
  scoreAfter: number
}
