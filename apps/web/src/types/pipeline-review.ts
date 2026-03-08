export type PipelineSecondReviewTargetTable =
  | 'novel_timelines'
  | 'novel_characters'
  | 'novel_key_nodes'
  | 'novel_skeleton_topic_items'
  | 'novel_explosions'

export type PipelineSecondReviewReferenceTable =
  | 'drama_novels'
  | 'drama_source_text'
  | 'novel_adaptation_strategy'
  | 'adaptation_modes'
  | 'set_core'

export interface PipelineSecondReviewNote {
  table: string
  issue: string
  fix: string
}

export interface PipelineSecondReviewRequest {
  modelKey?: string
  targetTables: PipelineSecondReviewTargetTable[]
  referenceTables: PipelineSecondReviewReferenceTable[]
  userInstruction?: string
  allowPromptEdit?: boolean
  promptOverride?: string
}

export interface PipelineSecondReviewPromptPreviewResponse {
  promptPreview: string
  usedModelKey: string
  targetTables: PipelineSecondReviewTargetTable[]
  referenceTables: PipelineSecondReviewReferenceTable[]
}

export interface PipelineSecondReviewResponse {
  ok: true
  summary: {
    timelines: number
    characters: number
    keyNodes: number
    skeletonTopicItems: number
    explosions: number
  }
  reviewNotes: PipelineSecondReviewNote[]
  warnings?: string[]
  details?: {
    reviewNotes: {
      rawCount: number
      normalizedCount: number
      droppedCount: number
      reviewNotesByTable: Record<string, number>
    }
    tables: Record<
      PipelineSecondReviewTargetTable,
      {
        usedAiNotes: number
        usedFallback: boolean
        mergedWithHistory: number
        insertedRows: number
      }
    >
  }
}
