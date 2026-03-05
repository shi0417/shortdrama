import { apiClient } from './api'
import {
  AdaptationModeDto,
  AdaptationStrategyDto,
  CreateAdaptationStrategyPayload,
  UpdateAdaptationStrategyPayload,
} from '@/types/adaptation'

export const adaptationApi = {
  listAdaptationModes: () =>
    apiClient('/adaptation-modes') as Promise<AdaptationModeDto[]>,

  listNovelAdaptationStrategies: (novelId: number) =>
    apiClient(`/novels/${novelId}/adaptation-strategies`) as Promise<AdaptationStrategyDto[]>,

  createNovelAdaptationStrategy: (novelId: number, payload: CreateAdaptationStrategyPayload) =>
    apiClient(`/novels/${novelId}/adaptation-strategies`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }) as Promise<AdaptationStrategyDto>,

  updateAdaptationStrategy: (id: number, payload: UpdateAdaptationStrategyPayload) =>
    apiClient(`/adaptation-strategies/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }) as Promise<AdaptationStrategyDto>,

  deleteAdaptationStrategy: (id: number) =>
    apiClient(`/adaptation-strategies/${id}`, {
      method: 'DELETE',
    }) as Promise<{ ok: true }>,
}
