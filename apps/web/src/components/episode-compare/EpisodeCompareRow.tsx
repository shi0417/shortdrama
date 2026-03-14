'use client'

import { EpisodeCompareRow as EpisodeCompareRowType } from '@/types/episode-compare'
import { PipelineResourceName } from '@/types/pipeline-resource'
import EpisodeCompareColumnCard from './EpisodeCompareColumnCard'

interface EpisodeCompareRowProps {
  row: EpisodeCompareRowType
  visibleColumns: Record<PipelineResourceName, string[]>
  onOpenDetail: (row: EpisodeCompareRowType) => void
}

function getFlexGrow(fieldCount: number) {
  if (fieldCount <= 2) return 1
  if (fieldCount <= 5) return 1.4
  if (fieldCount <= 9) return 1.8
  return 2.2
}

export default function EpisodeCompareRow({ row, visibleColumns, onOpenDetail }: EpisodeCompareRowProps) {
  const epFlex = getFlexGrow((visibleColumns.episodes || []).length)
  const stFlex = getFlexGrow((visibleColumns['structure-templates'] || []).length)
  const hrFlex = getFlexGrow((visibleColumns['hook-rhythms'] || []).length)

  return (
    <div
      style={{
        border: '1px solid #f0f0f0',
        borderRadius: 10,
        padding: 10,
        background: '#fff',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Episode #{row.episodeKey}</div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>
        <div style={{ flex: epFlex, minWidth: 0 }}>
          <EpisodeCompareColumnCard
            resource="episodes"
            row={row.episode}
            visibleKeys={visibleColumns.episodes || []}
            onClick={() => onOpenDetail(row)}
          />
        </div>
        <div style={{ flex: stFlex, minWidth: 0 }}>
          <EpisodeCompareColumnCard
            resource="structure-templates"
            row={row.structureTemplate}
            visibleKeys={visibleColumns['structure-templates'] || []}
            onClick={() => onOpenDetail(row)}
          />
        </div>
        <div style={{ flex: hrFlex, minWidth: 0 }}>
          <EpisodeCompareColumnCard
            resource="hook-rhythms"
            row={row.hookRhythm}
            visibleKeys={visibleColumns['hook-rhythms'] || []}
            onClick={() => onOpenDetail(row)}
          />
        </div>
      </div>
    </div>
  )
}
