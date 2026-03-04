import { apiClient } from './api'
import {
  CreateSkeletonTopicPayload,
  SkeletonTopicDto,
  SkeletonTopicItemDto,
  UpdateSkeletonTopicPayload,
} from '@/types/pipeline'

export const skeletonTopicsApi = {
  listSkeletonTopics: (novelId: number) =>
    apiClient(`/novels/${novelId}/skeleton-topics`) as Promise<SkeletonTopicDto[]>,

  createSkeletonTopic: (novelId: number, payload: CreateSkeletonTopicPayload) =>
    apiClient(`/novels/${novelId}/skeleton-topics`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }) as Promise<SkeletonTopicDto>,

  updateSkeletonTopic: (id: number, payload: UpdateSkeletonTopicPayload) =>
    apiClient(`/skeleton-topics/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }) as Promise<SkeletonTopicDto>,

  deleteSkeletonTopic: (id: number) =>
    apiClient(`/skeleton-topics/${id}`, {
      method: 'DELETE',
    }) as Promise<{ ok: true }>,

  listSkeletonTopicItems: (topicId: number) =>
    apiClient(`/skeleton-topics/${topicId}/items`) as Promise<SkeletonTopicItemDto[]>,
}
