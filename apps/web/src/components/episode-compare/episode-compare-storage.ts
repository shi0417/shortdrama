import { PipelineResourceName } from '@/types/pipeline-resource'

type Scope = 'panel' | 'page'

export function getEpisodeCompareColumnStorageKey(
  novelId: number,
  resource: PipelineResourceName,
  scope: Scope
) {
  return `episode-compare-columns:${scope}:${resource}:novel:${novelId}`
}

export function readColumns(key: string, fallback: string[]) {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

export function writeColumns(key: string, columns: string[]) {
  if (typeof window === 'undefined') return
  localStorage.setItem(key, JSON.stringify(columns))
}
