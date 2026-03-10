import { apiClient } from './api'
import { PipelineResourceName, PipelineResourceRow } from '@/types/pipeline-resource'

function buildQuery(params: Record<string, string | number | undefined>) {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value))
    }
  })
  const text = query.toString()
  return text ? `?${text}` : ''
}

export const pipelineResourceApi = {
  list: (novelId: number, resource: PipelineResourceName, params?: { topicId?: number }) =>
    apiClient(
      `/novels/${novelId}/pipeline-resources/${resource}${buildQuery({
        topicId: params?.topicId,
      })}`
    ) as Promise<PipelineResourceRow[]>,

  getOne: (resource: PipelineResourceName, id: number) =>
    apiClient(`/pipeline-resources/${resource}/${id}`) as Promise<PipelineResourceRow>,

  create: (novelId: number, resource: PipelineResourceName, data: Record<string, unknown>) =>
    apiClient(`/novels/${novelId}/pipeline-resources/${resource}`, {
      method: 'POST',
      body: JSON.stringify(data),
    }) as Promise<PipelineResourceRow>,

  update: (resource: PipelineResourceName, id: number, data: Record<string, unknown>) =>
    apiClient(`/pipeline-resources/${resource}/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }) as Promise<PipelineResourceRow>,

  remove: (resource: PipelineResourceName, id: number) =>
    apiClient(`/pipeline-resources/${resource}/${id}`, {
      method: 'DELETE',
    }) as Promise<{ ok: true }>,
}
