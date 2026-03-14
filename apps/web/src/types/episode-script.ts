/** Production layer: episode script versions, scenes, shots, shot prompts */

export interface EpisodeScriptVersion {
  id: number
  novel_id: number
  episode_number: number
  source_episode_id: number | null
  version_no: number
  script_type: string
  title: string
  summary: string | null
  status: string
  is_active: number
  created_at: string
  updated_at: string
}

export interface EpisodeScene {
  id: number
  novel_id: number
  script_version_id: number
  episode_number: number
  scene_no: number
  scene_title: string
  location_name: string | null
  scene_summary: string | null
  main_conflict: string | null
  narrator_text: string | null
  screen_subtitle: string | null
  estimated_seconds: number
  sort_order: number
  created_at: string
  updated_at: string
}

export interface EpisodeShot {
  id: number
  novel_id: number
  script_version_id: number
  scene_id: number
  episode_number: number
  shot_no: number
  shot_type: string | null
  visual_desc: string
  narrator_text: string | null
  dialogue_text: string | null
  subtitle_text: string | null
  duration_sec: number
  camera_movement: string | null
  emotion_tag: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

export interface EpisodeShotPrompt {
  id: number
  novel_id: number
  shot_id: number
  prompt_type: string
  prompt_text: string
  negative_prompt: string | null
  model_name: string | null
  style_preset: string | null
  created_at: string
  updated_at: string
}

/** Narrator script draft (generate/persist) */
export interface NarratorScriptShotPromptDraft {
  promptType: string
  promptText: string
  negativePrompt?: string
  modelName?: string
  stylePreset?: string
}

export interface NarratorScriptShotDraft {
  shotNo: number
  shotType?: string
  visualDesc: string
  narratorText?: string
  dialogueText?: string
  subtitleText?: string
  durationSec?: number
  cameraMovement?: string
  emotionTag?: string
  prompts?: NarratorScriptShotPromptDraft[]
}

export interface NarratorScriptSceneDraft {
  sceneNo: number
  sceneTitle: string
  locationName?: string
  sceneSummary?: string
  mainConflict?: string
  narratorText?: string
  screenSubtitle?: string
  estimatedSeconds?: number
  shots: NarratorScriptShotDraft[]
}

export interface NarratorScriptVersionDraft {
  episodeNumber: number
  title: string
  summary: string
  scriptType: string
  scenes: NarratorScriptSceneDraft[]
}

export interface NarratorScriptDraftMeta {
  batchCount?: number
}

export interface NarratorScriptDraftPayload {
  scripts: NarratorScriptVersionDraft[]
  meta?: NarratorScriptDraftMeta
}

/** 核心参考表（后端 getContext 始终读取，不通过 referenceTables 传；仅用于 UI 展示“始终包含”） */
export const NARRATOR_CORE_REFERENCE_TABLES: Array<{ value: string; label: string }> = [
  { value: 'novel_episodes', label: '分集信息（novel_episodes）' },
  { value: 'drama_structure_template', label: '结构模板（drama_structure_template）' },
  { value: 'novel_hook_rhythm', label: '钩子节奏（novel_hook_rhythm）' },
]

/** 默认勾选的扩展参考表（与后端 NARRATOR_DEFAULT_EXTENSION 对齐）；请求体 referenceTables 只传扩展表 */
export const defaultNarratorOptionalReferenceTables: string[] = [
  'set_core',
  'set_payoff_arch',
  'set_payoff_lines',
  'set_opponents',
  'set_power_ladder',
  'set_story_phases',
  'novel_characters',
  'novel_key_nodes',
  'novel_timelines',
]

/** @deprecated 请使用 defaultNarratorOptionalReferenceTables */
export const defaultNarratorReferenceTables = defaultNarratorOptionalReferenceTables

export interface NarratorScriptReferenceSummaryItem {
  table: string
  label: string
  rowCount: number
  fields: string[]
  usedChars?: number
}

export interface NarratorScriptPreviewRequest {
  modelKey?: string
  referenceTables?: string[]
  startEpisode?: number
  endEpisode?: number
  sourceTextCharBudget?: number
  userInstruction?: string
  allowPromptEdit?: boolean
  promptOverride?: string
}

export interface NarratorScriptPreviewResponse {
  promptPreview: string
  usedModelKey: string
  referenceTables: string[]
  referenceSummary: NarratorScriptReferenceSummaryItem[]
  warnings: string[]
}

export interface NarratorScriptGenerateDraftParams {
  targetEpisodeCount?: number
  startEpisode?: number
  endEpisode?: number
  batchSize?: number
  modelKey?: string
  referenceTables?: string[]
  sourceTextCharBudget?: number
  userInstruction?: string
  allowPromptEdit?: boolean
  promptOverride?: string
}

export interface NarratorScriptGenerateDraftResponse {
  draftId: string
  draft: NarratorScriptDraftPayload
  usedModelKey?: string
  promptPreview?: string
  referenceSummary?: NarratorScriptReferenceSummaryItem[]
  warnings?: string[]
  validationWarnings?: string[]
}

export interface NarratorScriptPersistPayload {
  draftId?: string
  draft?: NarratorScriptDraftPayload
}

export interface NarratorScriptPersistResponse {
  ok: true
  summary: {
    scriptVersions: number
    scenes: number
    shots: number
    prompts: number
    episodeCoverage?: number
    batchCount?: number
  }
}
