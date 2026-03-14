'use client'

import { useState } from 'react'
import { getPipelineResourceConfig, PipelineResourceName } from '@/types/pipeline-resource'
import { COMPARE_RESOURCES } from './useEpisodeCompareColumns'

interface EpisodeCompareToolbarProps {
  visibleColumns: Record<PipelineResourceName, string[]>
  onSetColumns: (resource: PipelineResourceName, keys: string[]) => void
  onSelectAll: (resource: PipelineResourceName) => void
  onClear: (resource: PipelineResourceName) => void
  onReset: (resource: PipelineResourceName) => void
  onOpenFullPage?: () => void
}

export default function EpisodeCompareToolbar({
  visibleColumns,
  onSetColumns,
  onSelectAll,
  onClear,
  onReset,
  onOpenFullPage,
}: EpisodeCompareToolbarProps) {
  const [openPicker, setOpenPicker] = useState<PipelineResourceName | null>(null)

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {COMPARE_RESOURCES.map((resource) => {
        const cfg = getPipelineResourceConfig(resource)
        const selected = visibleColumns[resource] || []
        const fields = cfg.fields.filter((f) => f.key !== 'revision_notes_json')
        return (
          <div key={resource} style={{ position: 'relative' }}>
            <button
              onClick={() => setOpenPicker((prev) => (prev === resource ? null : resource))}
              style={{
                padding: '6px 10px',
                border: '1px solid #d9d9d9',
                borderRadius: 6,
                background: '#fff',
                cursor: 'pointer',
              }}
            >
              {cfg.title} 字段 ({selected.length})
            </button>
            {openPicker === resource ? (
              <div
                style={{
                  position: 'absolute',
                  top: '110%',
                  left: 0,
                  zIndex: 30,
                  width: 260,
                  maxHeight: 360,
                  overflowY: 'auto',
                  background: '#fff',
                  border: '1px solid #e8e8e8',
                  borderRadius: 8,
                  boxShadow: '0 8px 18px rgba(0,0,0,0.12)',
                  padding: 10,
                }}
              >
                <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                  <button onClick={() => onSelectAll(resource)}>全选</button>
                  <button onClick={() => onClear(resource)}>清空</button>
                  <button onClick={() => onReset(resource)}>恢复默认</button>
                </div>
                {fields.map((field) => (
                  <label key={field.key} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={selected.includes(field.key)}
                      onChange={() => {
                        onSetColumns(
                          resource,
                          selected.includes(field.key)
                            ? selected.filter((k) => k !== field.key)
                            : [...selected, field.key]
                        )
                      }}
                    />
                    {field.label}
                  </label>
                ))}
              </div>
            ) : null}
          </div>
        )
      })}
      {onOpenFullPage ? (
        <button
          onClick={onOpenFullPage}
          style={{
            marginLeft: 'auto',
            padding: '6px 10px',
            border: 'none',
            borderRadius: 6,
            background: '#1890ff',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          Open Full Compare Page
        </button>
      ) : null}
    </div>
  )
}
