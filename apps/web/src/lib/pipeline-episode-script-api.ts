import { apiClient } from './api'
import {
  PipelineEpisodeScriptGenerateDraftResponse,
  PipelineEpisodeScriptPersistPayload,
  PipelineEpisodeScriptPersistResponse,
  PipelineEpisodeScriptPreviewResponse,
  PipelineEpisodeScriptRequest,
} from '@/types/pipeline'

export const pipelineEpisodeScriptApi = {
  previewEpisodeScriptPrompt: (novelId: number, payload: PipelineEpisodeScriptRequest) =>
    apiClient(`/pipeline/${novelId}/episode-script-preview-prompt`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }) as Promise<PipelineEpisodeScriptPreviewResponse>,

  generateEpisodeScriptDraft: (novelId: number, payload: PipelineEpisodeScriptRequest) =>
    apiClient(`/pipeline/${novelId}/episode-script-generate-draft`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }) as Promise<PipelineEpisodeScriptGenerateDraftResponse>,

  persistEpisodeScriptDraft: (
    novelId: number,
    payload: PipelineEpisodeScriptPersistPayload
  ) =>
    apiClient(`/pipeline/${novelId}/episode-script-persist`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }) as Promise<PipelineEpisodeScriptPersistResponse>,
}

