'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  getPipelineResourceConfig,
  PipelineResourceName,
} from '@/types/pipeline-resource'
import {
  getEpisodeCompareColumnStorageKey,
  readColumns,
  writeColumns,
} from './episode-compare-storage'

export const COMPARE_RESOURCES: PipelineResourceName[] = [
  'episodes',
  'structure-templates',
  'hook-rhythms',
]

type Scope = 'panel' | 'page'

export function useEpisodeCompareColumns(novelId: number, scope: Scope) {
  const defaults = useMemo(() => {
    return Object.fromEntries(
      COMPARE_RESOURCES.map((resource) => {
        const cfg = getPipelineResourceConfig(resource)
        return [resource, cfg.defaultSectionColumns]
      })
    ) as Record<PipelineResourceName, string[]>
  }, [])

  const [visibleColumns, setVisibleColumns] = useState<Record<PipelineResourceName, string[]>>({
    episodes: defaults.episodes || [],
    'structure-templates': defaults['structure-templates'] || [],
    'hook-rhythms': defaults['hook-rhythms'] || [],
  })

  useEffect(() => {
    const next = { ...visibleColumns }
    COMPARE_RESOURCES.forEach((resource) => {
      const key = getEpisodeCompareColumnStorageKey(novelId, resource, scope)
      next[resource] = readColumns(key, defaults[resource])
    })
    setVisibleColumns(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [novelId, scope])

  useEffect(() => {
    COMPARE_RESOURCES.forEach((resource) => {
      const key = getEpisodeCompareColumnStorageKey(novelId, resource, scope)
      writeColumns(key, visibleColumns[resource] || defaults[resource])
    })
  }, [novelId, scope, visibleColumns, defaults])

  const setColumnsFor = (resource: PipelineResourceName, keys: string[]) => {
    setVisibleColumns((prev) => ({ ...prev, [resource]: keys }))
  }

  const selectAllFor = (resource: PipelineResourceName) => {
    const cfg = getPipelineResourceConfig(resource)
    setColumnsFor(
      resource,
      cfg.fields
        .filter((f) => f.key !== 'revision_notes_json')
        .map((f) => f.key)
    )
  }

  const clearFor = (resource: PipelineResourceName) => setColumnsFor(resource, [])

  const resetFor = (resource: PipelineResourceName) => setColumnsFor(resource, defaults[resource])

  return {
    visibleColumns,
    setColumnsFor,
    selectAllFor,
    clearFor,
    resetFor,
    defaults,
  }
}
