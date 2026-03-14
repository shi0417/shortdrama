'use client'

import { useMemo, useState } from 'react'
import { EpisodeCompareRow } from '@/types/episode-compare'
import {
  getPipelineResourceConfig,
  PipelineResourceName,
  PipelineResourceRow,
} from '@/types/pipeline-resource'
import { pipelineResourceApi } from '@/lib/pipeline-resource-api'
import PipelineRowEditDialog from '@/components/pipeline/PipelineRowEditDialog'

interface EpisodeCompareDetailDialogProps {
  open: boolean
  novelId: number
  row: EpisodeCompareRow | null
  onClose: () => void
  onChanged: () => Promise<void>
}

type EditingTarget = {
  resource: PipelineResourceName
  mode: 'create' | 'edit'
  row: PipelineResourceRow | null
} | null

export default function EpisodeCompareDetailDialog({
  open,
  novelId,
  row,
  onClose,
  onChanged,
}: EpisodeCompareDetailDialogProps) {
  const [editing, setEditing] = useState<EditingTarget>(null)
  const [submitting, setSubmitting] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const episodeKey = row?.episodeKey

  const sections = useMemo(
    () => [
      { resource: 'episodes' as const, label: 'novel_episodes', data: row?.episode },
      {
        resource: 'structure-templates' as const,
        label: 'drama_structure_template',
        data: row?.structureTemplate,
      },
      { resource: 'hook-rhythms' as const, label: 'novel_hook_rhythm', data: row?.hookRhythm },
    ],
    [row]
  )

  const buildCreateSeed = (resource: PipelineResourceName): PipelineResourceRow => {
    if (!episodeKey) return {}
    if (resource === 'episodes') return { novel_id: novelId, episode_number: episodeKey, sort_order: episodeKey }
    if (resource === 'structure-templates') {
      return {
        novels_id: novelId,
        chapter_id: episodeKey,
        power_level: 1,
        is_power_up_chapter: 0,
        hot_level: 3,
        theme_type: '',
        structure_name: '',
      }
    }
    return { novel_id: novelId, episode_number: episodeKey, emotion_level: 3 }
  }

  const emptyBlockCta: Record<'episodes' | 'structure-templates' | 'hook-rhythms', string> = {
    episodes: 'Create episode record',
    'structure-templates': 'Create structure template',
    'hook-rhythms': 'Create hook rhythm',
  }

  if (!open || !row) return null

  return (
    <>
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.35)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1200,
          padding: 16,
        }}
      >
        <div
          style={{
            width: '1100px',
            maxWidth: '100%',
            maxHeight: '90vh',
            overflowY: 'auto',
            background: '#fff',
            borderRadius: 10,
            border: '1px solid #f0f0f0',
            padding: 16,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontWeight: 700 }}>
              Episode Compare — Episode {row.episodeKey}
              {editing ? ` · 正在操作: ${editing.resource}` : ''}
            </div>
            <button onClick={onClose}>关闭</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
            {sections.map((section) => (
              <div key={section.resource} style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 10 }}>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>{section.label}</div>
                {section.data ? (
                  <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, maxHeight: 300, overflowY: 'auto' }}>
                    {JSON.stringify(section.data, null, 2)}
                  </pre>
                ) : (
                  <div style={{ color: '#999', fontSize: 12, marginBottom: 8 }}>No data</div>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  {section.data ? (
                    <button
                      onClick={() =>
                        setEditing({
                          resource: section.resource,
                          mode: 'edit',
                          row: section.data as PipelineResourceRow,
                        })
                      }
                    >
                      编辑
                    </button>
                  ) : (
                    <button
                      onClick={() =>
                        setEditing({
                          resource: section.resource,
                          mode: 'create',
                          row: buildCreateSeed(section.resource),
                        })
                      }
                    >
                      {emptyBlockCta[section.resource] ?? '新建该集记录'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {editing ? (
        <PipelineRowEditDialog
          open
          mode={editing.mode}
          config={getPipelineResourceConfig(editing.resource)}
          row={editing.row}
          submitting={submitting}
          deleting={deleting}
          onClose={() => setEditing(null)}
          onSubmit={async (payload) => {
            try {
              setSubmitting(true)
              if (editing.mode === 'create') {
                await pipelineResourceApi.create(novelId, editing.resource, payload)
              } else if (editing.row?.id) {
                await pipelineResourceApi.update(editing.resource, Number(editing.row.id), payload)
              }
              setEditing(null)
              await onChanged()
            } finally {
              setSubmitting(false)
            }
          }}
          onDelete={
            editing.mode === 'edit' && editing.row?.id
              ? async () => {
                  const msg = `确定删除当前记录吗？\n资源: ${editing.resource}\n集号: Episode ${episodeKey ?? '?'}`
                  if (!confirm(msg)) return
                  try {
                    setDeleting(true)
                    await pipelineResourceApi.remove(editing.resource, Number(editing.row.id))
                    setEditing(null)
                    await onChanged()
                  } finally {
                    setDeleting(false)
                  }
                }
              : undefined
          }
        />
      ) : null}
    </>
  )
}
