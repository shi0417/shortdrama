'use client'

import { getPipelineResourceConfig, PipelineResourceName } from '@/types/pipeline-resource'

const palette: Record<PipelineResourceName, { head: string; body: string; border: string }> = {
  episodes: { head: '#597ef7', body: '#f0f5ff', border: '#adc6ff' },
  'structure-templates': { head: '#d48806', body: '#fffbe6', border: '#ffd666' },
  'hook-rhythms': { head: '#d4380d', body: '#fff2e8', border: '#ffbb96' },
  timelines: { head: '#597ef7', body: '#f0f5ff', border: '#adc6ff' },
  characters: { head: '#597ef7', body: '#f0f5ff', border: '#adc6ff' },
  'key-nodes': { head: '#597ef7', body: '#f0f5ff', border: '#adc6ff' },
  explosions: { head: '#597ef7', body: '#f0f5ff', border: '#adc6ff' },
  'skeleton-topics': { head: '#597ef7', body: '#f0f5ff', border: '#adc6ff' },
  'skeleton-topic-items': { head: '#597ef7', body: '#f0f5ff', border: '#adc6ff' },
  'payoff-arch': { head: '#597ef7', body: '#f0f5ff', border: '#adc6ff' },
  'payoff-lines': { head: '#597ef7', body: '#f0f5ff', border: '#adc6ff' },
  'opponent-matrix': { head: '#597ef7', body: '#f0f5ff', border: '#adc6ff' },
  opponents: { head: '#597ef7', body: '#f0f5ff', border: '#adc6ff' },
  'power-ladder': { head: '#597ef7', body: '#f0f5ff', border: '#adc6ff' },
  'traitor-system': { head: '#597ef7', body: '#f0f5ff', border: '#adc6ff' },
  traitors: { head: '#597ef7', body: '#f0f5ff', border: '#adc6ff' },
  'traitor-stages': { head: '#597ef7', body: '#f0f5ff', border: '#adc6ff' },
  'story-phases': { head: '#597ef7', body: '#f0f5ff', border: '#adc6ff' },
}

interface EpisodeCompareColumnCardProps {
  resource: PipelineResourceName
  row: Record<string, unknown> | null
  visibleKeys: string[]
  onClick?: () => void
}

function truncate(value: string, n = 120) {
  return value.length <= n ? value : `${value.slice(0, n)}...`
}

export default function EpisodeCompareColumnCard({
  resource,
  row,
  visibleKeys,
  onClick,
}: EpisodeCompareColumnCardProps) {
  const cfg = getPipelineResourceConfig(resource)
  const theme = palette[resource]
  const fields = cfg.fields.filter((f) => visibleKeys.includes(f.key))
  const hasData = !!row

  return (
    <div
      onClick={onClick}
      style={{
        border: `1px solid ${theme.border}`,
        borderRadius: 8,
        background: theme.body,
        cursor: onClick ? 'pointer' : 'default',
        height: '100%',
      }}
    >
      <div
        style={{
          background: theme.head,
          color: '#fff',
          padding: '6px 10px',
          borderTopLeftRadius: 8,
          borderTopRightRadius: 8,
          fontWeight: 600,
          fontSize: 13,
        }}
      >
        {resource}
      </div>
      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
        {!hasData ? <div style={{ color: '#999' }}>No data</div> : null}
        {hasData && fields.length === 0 ? (
          <div style={{ color: '#999', fontSize: 11 }}>No columns selected</div>
        ) : null}
        {hasData &&
          fields.length > 0 &&
          fields.map((field) => {
            const raw = row?.[field.key]
            const text = raw === null || raw === undefined || raw === '' ? '-' : truncate(String(raw))
            return (
              <div key={field.key}>
                <div style={{ color: '#666', fontSize: 11 }}>{field.label}</div>
                <div style={{ color: '#222', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{text}</div>
              </div>
            )
          })}
      </div>
    </div>
  )
}
