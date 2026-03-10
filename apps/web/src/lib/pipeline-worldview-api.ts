import { apiClient } from './api'
import {
  PipelineWorldviewGenerateDraftResponse,
  PipelineWorldviewPersistPayload,
  PipelineWorldviewPersistResponse,
  PipelineWorldviewPreviewResponse,
  PipelineWorldviewRequest,
} from '@/types/pipeline'

export const pipelineWorldviewApi = {
  previewWorldviewPrompt: (novelId: number, payload: PipelineWorldviewRequest) =>
    apiClient(`/pipeline/${novelId}/worldview-preview-prompt`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }) as Promise<PipelineWorldviewPreviewResponse>,

  generateWorldviewDraft: (novelId: number, payload: PipelineWorldviewRequest) =>
    apiClient(`/pipeline/${novelId}/worldview-generate-draft`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }) as Promise<PipelineWorldviewGenerateDraftResponse>,

  persistWorldviewDraft: (
    novelId: number,
    payload: PipelineWorldviewPersistPayload
  ) =>
    apiClient(`/pipeline/${novelId}/worldview-persist`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }) as Promise<PipelineWorldviewPersistResponse>,
}
