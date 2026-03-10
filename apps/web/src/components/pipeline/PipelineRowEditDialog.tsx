'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  PipelineFieldConfig,
  PipelineResourceConfig,
  PipelineResourceRow,
} from '@/types/pipeline-resource'

interface PipelineRowEditDialogProps {
  open: boolean
  mode: 'create' | 'edit'
  config: PipelineResourceConfig
  row: PipelineResourceRow | null
  submitting?: boolean
  deleting?: boolean
  onClose: () => void
  onSubmit: (payload: Record<string, unknown>) => void
  onDelete?: () => void
}

function formatJsonValue(value: unknown) {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function coerceFieldValue(field: PipelineFieldConfig, value: string): unknown {
  if (field.type === 'number') {
    return value === '' ? null : Number(value)
  }
  if (field.type === 'boolean') {
    return value === '1' ? 1 : 0
  }
  if (field.type === 'json') {
    return value
  }
  return value
}

export default function PipelineRowEditDialog({
  open,
  mode,
  config,
  row,
  submitting = false,
  deleting = false,
  onClose,
  onSubmit,
  onDelete,
}: PipelineRowEditDialogProps) {
  const [draft, setDraft] = useState<Record<string, string>>({})

  const editableFields = useMemo(
    () => config.fields.filter((field) => field.editable),
    [config.fields]
  )
  const readonlyFields = useMemo(
    () =>
      config.fields.filter(
        (field) =>
          field.readonly ||
          field.key === 'revision_notes_json' ||
          field.key === 'created_at' ||
          field.key === 'updated_at' ||
          field.key === 'id' ||
          field.key === 'novel_id'
      ),
    [config.fields]
  )

  useEffect(() => {
    if (!open) return
    const nextDraft: Record<string, string> = {}
    editableFields.forEach((field) => {
      const value = row?.[field.key]
      nextDraft[field.key] =
        field.type === 'json'
          ? formatJsonValue(value)
          : value === null || value === undefined
          ? ''
          : String(value)
    })
    setDraft(nextDraft)
  }, [open, row, editableFields])

  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1300,
        padding: '16px',
      }}
    >
      <div
        style={{
          width: '920px',
          maxWidth: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          background: '#fff',
          borderRadius: '8px',
          border: '1px solid #f0f0f0',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 600, fontSize: '16px' }}>
            {mode === 'create' ? `新增${config.title}` : `编辑${config.title}`}
          </div>
          <button
            onClick={onClose}
            style={{ border: 'none', background: 'transparent', color: '#1890ff', cursor: 'pointer' }}
          >
            关闭
          </button>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: '12px',
          }}
        >
          {editableFields.map((field) => {
            const value = draft[field.key] ?? ''
            const commonStyle = {
              width: '100%',
              padding: '8px',
              border: '1px solid #d9d9d9',
              borderRadius: '4px',
              boxSizing: 'border-box' as const,
            }

            return (
              <label
                key={field.key}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  gridColumn:
                    field.type === 'textarea' || field.type === 'json' ? '1 / -1' : 'auto',
                }}
              >
                <span style={{ fontSize: '12px', color: '#666' }}>{field.label}</span>
                {field.type === 'textarea' || field.type === 'json' ? (
                  <textarea
                    value={value}
                    rows={field.type === 'json' ? 8 : 5}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, [field.key]: e.target.value }))
                    }
                    style={{ ...commonStyle, resize: 'vertical', fontFamily: field.type === 'json' ? 'monospace' : 'inherit' }}
                  />
                ) : field.type === 'boolean' ? (
                  <select
                    value={value === '' ? '0' : value}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, [field.key]: e.target.value }))
                    }
                    style={commonStyle}
                  >
                    <option value="1">启用</option>
                    <option value="0">禁用</option>
                  </select>
                ) : (
                  <input
                    type={field.type === 'number' ? 'number' : 'text'}
                    value={value}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, [field.key]: e.target.value }))
                    }
                    style={commonStyle}
                  />
                )}
              </label>
            )
          })}
        </div>

        <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: '12px' }}>
          <div style={{ fontWeight: 600, marginBottom: '8px' }}>只读字段</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '12px' }}>
            {readonlyFields.map((field) => {
              const value =
                field.type === 'json'
                  ? formatJsonValue(row?.[field.key])
                  : row?.[field.key] === null || row?.[field.key] === undefined
                  ? ''
                  : String(row[field.key])
              return (
                <label
                  key={field.key}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    gridColumn:
                      field.type === 'textarea' || field.type === 'json' ? '1 / -1' : 'auto',
                  }}
                >
                  <span style={{ fontSize: '12px', color: '#666' }}>{field.label}</span>
                  <textarea
                    readOnly
                    value={value}
                    rows={field.type === 'json' ? 8 : 3}
                    style={{
                      width: '100%',
                      padding: '8px',
                      border: '1px solid #d9d9d9',
                      borderRadius: '4px',
                      background: '#fafafa',
                      resize: 'vertical',
                      boxSizing: 'border-box',
                      fontFamily: field.type === 'json' ? 'monospace' : 'inherit',
                    }}
                  />
                </label>
              )
            })}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
          <div>
            {mode === 'edit' && onDelete && row?.id ? (
              <button
                onClick={onDelete}
                disabled={deleting}
                style={{
                  padding: '8px 12px',
                  border: '1px solid #ff4d4f',
                  borderRadius: '4px',
                  background: '#fff',
                  color: '#ff4d4f',
                  cursor: deleting ? 'not-allowed' : 'pointer',
                }}
              >
                {deleting ? '删除中...' : '删除'}
              </button>
            ) : null}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={onClose}
              style={{
                padding: '8px 12px',
                border: '1px solid #d9d9d9',
                borderRadius: '4px',
                background: '#fff',
                cursor: 'pointer',
              }}
            >
              取消
            </button>
            <button
              onClick={() => {
                const payload: Record<string, unknown> = {}
                editableFields.forEach((field) => {
                  payload[field.key] = coerceFieldValue(field, draft[field.key] ?? '')
                })
                onSubmit(payload)
              }}
              disabled={submitting}
              style={{
                padding: '8px 12px',
                border: 'none',
                borderRadius: '4px',
                background: submitting ? '#91d5ff' : '#1890ff',
                color: '#fff',
                cursor: submitting ? 'not-allowed' : 'pointer',
              }}
            >
              {submitting ? '保存中...' : mode === 'create' ? '创建' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
