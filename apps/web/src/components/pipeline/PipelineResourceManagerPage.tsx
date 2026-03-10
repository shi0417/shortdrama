'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { pipelineResourceApi } from '@/lib/pipeline-resource-api'
import {
  getPipelineColumnStorageKey,
  getPipelineResourceConfig,
  PipelineFieldConfig,
  PipelineResourceName,
  PipelineResourceRow,
} from '@/types/pipeline-resource'
import PipelineDataTable from './PipelineDataTable'
import PipelineRowEditDialog from './PipelineRowEditDialog'

interface PipelineResourceManagerPageProps {
  novelId: number
  resource: PipelineResourceName
}

function readColumns(key: string, fallback: string[]) {
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

export default function PipelineResourceManagerPage({
  novelId,
  resource,
}: PipelineResourceManagerPageProps) {
  const router = useRouter()
  const config = getPipelineResourceConfig(resource)
  const storageKey = getPipelineColumnStorageKey(resource, novelId, 'page')

  const [novelName, setNovelName] = useState('')
  const [rows, setRows] = useState<PipelineResourceRow[]>([])
  const [loading, setLoading] = useState(false)
  const [showColumnPicker, setShowColumnPicker] = useState(false)
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<string[]>(config.defaultPageColumns)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogMode, setDialogMode] = useState<'create' | 'edit'>('create')
  const [activeRow, setActiveRow] = useState<PipelineResourceRow | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    setVisibleColumnKeys(readColumns(storageKey, config.defaultPageColumns))
  }, [storageKey, config.defaultPageColumns])

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

  const loadRows = async () => {
    try {
      setLoading(true)
      const [novel, data] = await Promise.all([
        api.getNovel(novelId),
        pipelineResourceApi.list(novelId, resource),
      ])
      setNovelName(novel?.novelsName || '')
      setRows(data || [])
    } catch (err: any) {
      alert(err?.message || '加载资源管理页失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadRows()
  }, [novelId, resource])

  const openCreate = () => {
    setActiveRow({
      novel_id: novelId,
      sort_order: 0,
    })
    setDialogMode('create')
    setDialogOpen(true)
  }

  const openEdit = async (row: PipelineResourceRow) => {
    if (!row.id) return
    try {
      const detail = await pipelineResourceApi.getOne(resource, Number(row.id))
      setActiveRow(detail)
      setDialogMode('edit')
      setDialogOpen(true)
    } catch (err: any) {
      alert(err?.message || '加载行详情失败')
    }
  }

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '20px', fontWeight: 600, color: '#333' }}>
            {config.pageTitle}
          </div>
          <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
            项目：{novelName || `#${novelId}`} | novelId={novelId}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            onClick={() => router.push('/projects')}
            style={{ padding: '6px 12px', border: '1px solid #d9d9d9', background: '#fff', borderRadius: '4px', cursor: 'pointer' }}
          >
            返回 /projects
          </button>
          <button
            onClick={openCreate}
            style={{ padding: '6px 12px', border: 'none', background: '#1890ff', color: '#fff', borderRadius: '4px', cursor: 'pointer' }}
          >
            新增
          </button>
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowColumnPicker((prev) => !prev)}
              style={{ padding: '6px 12px', border: '1px solid #d9d9d9', background: '#fff', borderRadius: '4px', cursor: 'pointer' }}
            >
              字段显示
            </button>
            {showColumnPicker && (
              <div
                style={{
                  position: 'absolute',
                  right: 0,
                  top: '110%',
                  zIndex: 30,
                  minWidth: '240px',
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
                    <label key={field.key} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
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
          <button
            onClick={() => void loadRows()}
            style={{ padding: '6px 12px', border: '1px solid #d9d9d9', background: '#fff', borderRadius: '4px', cursor: 'pointer' }}
          >
            刷新
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ color: '#1890ff', fontSize: '14px' }}>Loading...</div>
      ) : (
        <PipelineDataTable
          rows={rows}
          columns={visibleColumns.length ? visibleColumns : config.fields.filter((field) => config.defaultPageColumns.includes(field.key))}
          onRowClick={(row) => void openEdit(row)}
        />
      )}

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
          try {
            setSubmitting(true)
            if (dialogMode === 'create') {
              await pipelineResourceApi.create(novelId, resource, payload)
              alert(`${config.title}创建成功`)
            } else if (activeRow?.id) {
              await pipelineResourceApi.update(resource, Number(activeRow.id), payload)
              alert(`${config.title}保存成功`)
            }
            setDialogOpen(false)
            setActiveRow(null)
            await loadRows()
          } catch (err: any) {
            alert(err?.message || `${config.title}保存失败`)
          } finally {
            setSubmitting(false)
          }
        }}
        onDelete={
          dialogMode === 'edit' && activeRow?.id
            ? async () => {
                if (!confirm(`确定删除该${config.title}记录吗？`)) return
                try {
                  setDeleting(true)
                  await pipelineResourceApi.remove(resource, Number(activeRow.id))
                  setDialogOpen(false)
                  setActiveRow(null)
                  await loadRows()
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
