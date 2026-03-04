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
