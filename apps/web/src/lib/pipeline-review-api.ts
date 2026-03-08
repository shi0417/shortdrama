import { apiClient } from './api'
import {
  PipelineSecondReviewPromptPreviewResponse,
  PipelineSecondReviewRequest,
  PipelineSecondReviewResponse,
} from '@/types/pipeline-review'

export const pipelineReviewApi = {
  previewPipelineSecondReviewPrompt: (
    novelId: number,
    payload: PipelineSecondReviewRequest
  ) =>
    apiClient(`/pipeline/${novelId}/review-preview-prompt`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }) as Promise<PipelineSecondReviewPromptPreviewResponse>,

  runPipelineSecondReview: (novelId: number, payload: PipelineSecondReviewRequest) =>
    apiClient(`/pipeline/${novelId}/review-and-correct`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }) as Promise<PipelineSecondReviewResponse>,
}
