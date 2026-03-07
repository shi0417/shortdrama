import { apiClient } from './api'
import {
  AiModelOptionDto,
  EnhanceSetCorePayload,
  EnhanceSetCorePromptPreviewPayload,
  EnhanceSetCorePromptPreviewResponseDto,
  EnhanceSetCoreResponseDto,
  SetCoreDto,
  SetCoreVersionDto,
  UpsertSetCorePayload,
} from '@/types/pipeline'

export const setCoreApi = {
  getActiveSetCore: (novelId: number) =>
    apiClient(`/novels/${novelId}/set-core`) as Promise<SetCoreDto | null>,

  upsertSetCore: (novelId: number, payload: UpsertSetCorePayload) =>
    apiClient(`/novels/${novelId}/set-core:upsert`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }) as Promise<SetCoreDto>,

  listSetCoreVersions: (novelId: number) =>
    apiClient(`/novels/${novelId}/set-core/versions`) as Promise<SetCoreVersionDto[]>,

  activateSetCoreVersion: (id: number) =>
    apiClient(`/set-core/${id}/activate`, {
      method: 'POST',
    }) as Promise<SetCoreDto>,

  deleteSetCore: (id: number) =>
    apiClient(`/set-core/${id}`, {
      method: 'DELETE',
    }) as Promise<{ ok: true }>,

  listAiModelCatalogOptions: () =>
    apiClient('/ai-model-catalog/options') as Promise<AiModelOptionDto[]>,

  previewSetCoreEnhancePrompt: (
    novelId: number,
    payload: EnhanceSetCorePromptPreviewPayload
  ) =>
    apiClient(`/novels/${novelId}/set-core:enhance-preview-prompt`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }) as Promise<EnhanceSetCorePromptPreviewResponseDto>,

  enhanceSetCore: (novelId: number, payload: EnhanceSetCorePayload) =>
    apiClient(`/novels/${novelId}/set-core:enhance`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }) as Promise<EnhanceSetCoreResponseDto>,
}
