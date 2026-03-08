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
