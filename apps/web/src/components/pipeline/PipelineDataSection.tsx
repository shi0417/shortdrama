'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  getPipelineColumnStorageKey,
  getPipelineResourceConfig,
  PipelineFieldConfig,
  PipelineResourceName,
  PipelineResourceRow,
} from '@/types/pipeline-resource'
import { pipelineResourceApi } from '@/lib/pipeline-resource-api'
import PipelineDataTable from './PipelineDataTable'
import PipelineRowEditDialog from './PipelineRowEditDialog'

interface PipelineDataSectionProps {
  novelId: number
  resource: PipelineResourceName
  rows: PipelineResourceRow[]
  onRefresh: () => Promise<void>
}

function safeReadColumns(key: string, fallback: string[]): string[] {
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

export default function PipelineDataSection({
  novelId,
  resource,
  rows,
  onRefresh,
}: PipelineDataSectionProps) {
  const router = useRouter()
  const config = getPipelineResourceConfig(resource)
  const storageKey = getPipelineColumnStorageKey(resource, novelId, 'section')
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<string[]>(config.defaultSectionColumns)
  const [showColumnPicker, setShowColumnPicker] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogMode, setDialogMode] = useState<'create' | 'edit'>('edit')
  const [activeRow, setActiveRow] = useState<PipelineResourceRow | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    setVisibleColumnKeys(safeReadColumns(storageKey, config.defaultSectionColumns))
  }, [storageKey, config.defaultSectionColumns])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(storageKey, JSON.stringify(visibleColumnKeys))
    }
  }, [storageKey, visibleColumnKeys])

  const visibleColumns = useMemo<PipelineFieldConfig[]>(
    () =>
      config.fields.filter(
        (field) => visibleColumnKeys.includes(field.key) && field.key !== 'revision_notes_json'
      ),
    [config.fields, visibleColumnKeys]
  )

  const openRow = async (row: PipelineResourceRow) => {
    if (!row.id) return
    try {
      const detail = await pipelineResourceApi.getOne(resource, Number(row.id))
      setActiveRow(detail)
      setDialogMode('edit')
      setDialogOpen(true)
    } catch (err: any) {
      alert(err?.message || '加载数据详情失败')
    }
  }

  return (
    <div style={{ marginTop: '10px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          marginBottom: '6px',
          flexWrap: 'wrap',
        }}
      >
        <button
          onClick={() => router.push(`/projects/${novelId}/pipeline/${config.routeSegment}`)}
          style={{
            border: 'none',
            background: 'transparent',
            padding: 0,
            fontWeight: 600,
            color: '#1890ff',
            cursor: 'pointer',
          }}
        >
          {config.currentPageTitle}
        </button>
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowColumnPicker((prev) => !prev)}
            style={{
              padding: '4px 10px',
              border: '1px solid #d9d9d9',
              borderRadius: '4px',
              background: '#fff',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            字段显示
          </button>
          {showColumnPicker && (
            <div
              style={{
                position: 'absolute',
                right: 0,
                top: '110%',
                zIndex: 20,
                minWidth: '220px',
                background: '#fff',
                border: '1px solid #e8e8e8',
                borderRadius: '6px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                padding: '10px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              {config.fields
                .filter((field) => field.key !== 'revision_notes_json')
                .map((field) => (
                  <label
                    key={field.key}
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}
                  >
                    <input
                      type="checkbox"
                      checked={visibleColumnKeys.includes(field.key)}
                      onChange={() =>
                        setVisibleColumnKeys((prev) =>
                          prev.includes(field.key)
                            ? prev.filter((item) => item !== field.key)
                            : [...prev, field.key]
                        )
                      }
                    />
                    {field.label}
                  </label>
                ))}
            </div>
          )}
        </div>
      </div>

      <PipelineDataTable
        rows={rows}
        columns={visibleColumns.length ? visibleColumns : config.fields.filter((field) => config.defaultSectionColumns.includes(field.key))}
        onRowClick={(row) => void openRow(row)}
      />

      <PipelineRowEditDialog
        open={dialogOpen}
        mode={dialogMode}
        config={config}
        row={activeRow}
        submitting={submitting}
        deleting={deleting}
        onClose={() => {
          setDialogOpen(false)
          setActiveRow(null)
        }}
        onSubmit={async (payload) => {
          if (!activeRow?.id) return
          try {
            setSubmitting(true)
            await pipelineResourceApi.update(resource, Number(activeRow.id), payload)
            setDialogOpen(false)
            setActiveRow(null)
            await onRefresh()
            alert(`${config.title}保存成功`)
          } catch (err: any) {
            alert(err?.message || `${config.title}保存失败`)
          } finally {
            setSubmitting(false)
          }
        }}
        onDelete={
          activeRow?.id
            ? async () => {
                if (!confirm(`确定删除该${config.title}记录吗？`)) return
                try {
                  setDeleting(true)
                  await pipelineResourceApi.remove(resource, Number(activeRow.id))
                  setDialogOpen(false)
                  setActiveRow(null)
                  await onRefresh()
                  alert(`${config.title}删除成功`)
                } catch (err: any) {
                  alert(err?.message || `${config.title}删除失败`)
                } finally {
                  setDeleting(false)
                }
              }
            : undefined
        }
      />
    </div>
  )
}
