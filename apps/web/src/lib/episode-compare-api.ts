import { apiClient } from './api'
import { EpisodeCompareResponse } from '@/types/episode-compare'

export const episodeCompareApi = {
  getByNovel: (novelId: number) =>
    apiClient(`/novels/${novelId}/episode-compare`) as Promise<EpisodeCompareResponse>,
}
