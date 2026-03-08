import { apiClient } from './api'
import {
  AiModelOptionDto,
  PipelineExtractCommitResponse,
  PipelineExtractPromptPreviewResponse,
  PipelineExtractRequest,
} from '@/types/pipeline'

export const pipelineAiApi = {
  listAiModelOptions: () =>
    apiClient('/ai-model-catalog/options') as Promise<AiModelOptionDto[]>,

  previewExtractPrompt: (novelId: number, payload: PipelineExtractRequest) =>
    apiClient(`/pipeline/${novelId}/extract-preview-prompt`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }) as Promise<PipelineExtractPromptPreviewResponse>,

  extractAndGenerate: (novelId: number, payload: PipelineExtractRequest) =>
    apiClient(`/pipeline/${novelId}/extract-and-generate`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }) as Promise<PipelineExtractCommitResponse>,
}
