import { apiClient } from './api'
import type {
  EpisodeStoryPreviewRequest,
  EpisodeStoryPreviewResponse,
  EpisodeStoryGenerateDraftResponse,
  EpisodeStoryPersistPayload,
  EpisodeStoryPersistResponse,
  EpisodeStoryCheckRequest,
  StoryCheckReportDto,
} from '@/types/episode-story'

export const episodeStoryApi = {
  previewPrompt: (novelId: number, payload: EpisodeStoryPreviewRequest) =>
    apiClient(`/pipeline/${novelId}/episode-story-preview-prompt`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }) as Promise<EpisodeStoryPreviewResponse>,

  generateDraft: (novelId: number, payload: EpisodeStoryPreviewRequest) =>
    apiClient(`/pipeline/${novelId}/episode-story-generate-draft`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }) as Promise<EpisodeStoryGenerateDraftResponse>,

  persistDraft: (novelId: number, payload: EpisodeStoryPersistPayload) =>
    apiClient(`/pipeline/${novelId}/episode-story-persist`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }) as Promise<EpisodeStoryPersistResponse>,

  check: (novelId: number, payload: EpisodeStoryCheckRequest) =>
    apiClient(`/pipeline/${novelId}/episode-story-check`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }) as Promise<StoryCheckReportDto>,

  listStoryVersions: (novelId: number) =>
    apiClient(`/novels/${novelId}/episode-story-versions`) as Promise<
      Array<{
        id: number
        novel_id: number
        episode_number: number
        version_no: number
        story_type: string
        title: string
        summary: string | null
        word_count: number
        status: string
        is_active: number
        created_at: string
        updated_at: string
      }>
    >,
}
