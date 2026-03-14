'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { episodeCompareApi } from '@/lib/episode-compare-api'
import { EpisodeCompareRow as EpisodeCompareRowType } from '@/types/episode-compare'
import { PipelineResourceName } from '@/types/pipeline-resource'
import EpisodeCompareToolbar from './EpisodeCompareToolbar'
import EpisodeCompareRow from './EpisodeCompareRow'
import EpisodeCompareDetailDialog from './EpisodeCompareDetailDialog'
import { useEpisodeCompareColumns } from './useEpisodeCompareColumns'

interface EpisodeCompareWorkbenchProps {
  novelId: number
  novelName?: string
  scope: 'panel' | 'page'
  compact?: boolean
}

export default function EpisodeCompareWorkbench({
  novelId,
  novelName,
  scope,
  compact = false,
}: EpisodeCompareWorkbenchProps) {
  const router = useRouter()
  const [rows, setRows] = useState<EpisodeCompareRowType[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedRow, setSelectedRow] = useState<EpisodeCompareRowType | null>(null)

  const { visibleColumns, setColumnsFor, selectAllFor, clearFor, resetFor } = useEpisodeCompareColumns(
    novelId,
    scope
  )

  const loadData = async () => {
    try {
      setLoading(true)
      const result = await episodeCompareApi.getByNovel(novelId)
      setRows(result.rows || [])
    } catch (err: any) {
      alert(err?.message || '加载 Episode Compare 数据失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [novelId])

  const maxRows = compact ? 20 : rows.length
  const displayRows = rows.slice(0, maxRows)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontWeight: 600 }}>
          Episode Compare {novelName ? `- ${novelName}` : ''} (novelId={novelId})
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => void loadData()}>刷新</button>
          <button
            onClick={() => router.push(`/projects/${novelId}/pipeline/episode-scripts`)}
            style={{ background: '#1890ff', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', cursor: 'pointer' }}
          >
            Open Episode Script Workspace
          </button>
          {compact ? (
            <button onClick={() => router.push(`/projects/${novelId}/pipeline/episode-compare`)}>
              Open Full Compare Page
            </button>
          ) : null}
        </div>
      </div>

      <EpisodeCompareToolbar
        visibleColumns={visibleColumns as Record<PipelineResourceName, string[]>}
        onSetColumns={setColumnsFor}
        onSelectAll={selectAllFor}
        onClear={clearFor}
        onReset={resetFor}
        onOpenFullPage={
          compact ? () => router.push(`/projects/${novelId}/pipeline/episode-compare`) : undefined
        }
      />

      {loading ? <div>Loading...</div> : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {displayRows.map((row) => (
          <EpisodeCompareRow
            key={row.episodeKey}
            row={row}
            visibleColumns={visibleColumns as Record<PipelineResourceName, string[]>}
            onOpenDetail={setSelectedRow}
          />
        ))}
      </div>

      {compact && rows.length > maxRows ? (
        <div style={{ fontSize: 12, color: '#999' }}>
          已展示前 {maxRows} 行，点击 \"Open Full Compare Page\" 查看全部 {rows.length} 行。
        </div>
      ) : null}

      <EpisodeCompareDetailDialog
        open={!!selectedRow}
        novelId={novelId}
        row={selectedRow}
        onClose={() => setSelectedRow(null)}
        onChanged={loadData}
      />
    </div>
  )
}
