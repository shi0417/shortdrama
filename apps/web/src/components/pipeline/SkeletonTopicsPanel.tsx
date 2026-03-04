'use client'

import { useEffect, useMemo, useState } from 'react'
import { skeletonTopicsApi } from '@/lib/skeleton-topics-api'
import {
  CreateSkeletonTopicPayload,
  SkeletonTopicDto,
  SkeletonTopicItemDto,
  UpdateSkeletonTopicPayload,
} from '@/types/pipeline'

interface SkeletonTopicsPanelProps {
  novelId: number
}

interface TopicFormState {
  topicName: string
  topicType: 'text' | 'list' | 'json'
  description: string
  sortOrder: number
  isEnabled: number
  topicKeyManual: string
  manualKeyMode: boolean
}

const DEFAULT_FORM: TopicFormState = {
  topicName: '',
  topicType: 'text',
  description: '',
  sortOrder: 0,
  isEnabled: 1,
  topicKeyManual: '',
  manualKeyMode: false,
}

function slugifyTopicKey(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
  return (slug || 'topic').slice(0, 64)
}

function trimPayload(payload: UpdateSkeletonTopicPayload): UpdateSkeletonTopicPayload {
  const next = { ...payload }
  if (typeof next.topicName === 'string') next.topicName = next.topicName.trim()
  if (typeof next.topicKey === 'string') next.topicKey = next.topicKey.trim()
  if (typeof next.description === 'string') next.description = next.description.trim()
  return next
}

export default function SkeletonTopicsPanel({ novelId }: SkeletonTopicsPanelProps) {
  const [topics, setTopics] = useState<SkeletonTopicDto[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createForm, setCreateForm] = useState<TopicFormState>(DEFAULT_FORM)

  const [editingId, setEditingId] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState<UpdateSkeletonTopicPayload>({})
  const [savingId, setSavingId] = useState<number | null>(null)

  const [expandedTopics, setExpandedTopics] = useState<Record<number, boolean>>({})
  const [itemsByTopic, setItemsByTopic] = useState<Record<number, SkeletonTopicItemDto[]>>({})
  const [itemsLoadingByTopic, setItemsLoadingByTopic] = useState<Record<number, boolean>>({})
  const [expandedItemContent, setExpandedItemContent] = useState<Record<string, boolean>>({})

  const sortedTopics = useMemo(
    () => [...topics].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id),
    [topics]
  )

  const loadTopics = async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await skeletonTopicsApi.listSkeletonTopics(novelId)
      setTopics(data || [])
    } catch (err: any) {
      const message = err?.message || 'Failed to load skeleton topics'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTopics()
  }, [novelId])

  const loadItems = async (topicId: number) => {
    try {
      setItemsLoadingByTopic((prev) => ({ ...prev, [topicId]: true }))
      const data = await skeletonTopicsApi.listSkeletonTopicItems(topicId)
      setItemsByTopic((prev) => ({ ...prev, [topicId]: data || [] }))
    } catch (err: any) {
      alert(`Failed to load items: ${err?.message || 'unknown error'}`)
    } finally {
      setItemsLoadingByTopic((prev) => ({ ...prev, [topicId]: false }))
    }
  }

  const handleCreate = async () => {
    const topicName = createForm.topicName.trim()
    if (!topicName) {
      alert('Topic Name is required')
      return
    }

    if (createForm.manualKeyMode && !createForm.topicKeyManual.trim()) {
      alert('Topic Key is required in manual mode')
      return
    }

    setCreating(true)
    try {
      const baseKey = createForm.manualKeyMode
        ? slugifyTopicKey(createForm.topicKeyManual)
        : slugifyTopicKey(topicName)

      let created = false
      let retry = 0
      let lastError: any = null
      const maxRetry = createForm.manualKeyMode ? 1 : 3

      while (!created && retry < maxRetry) {
        const keyCandidate = createForm.manualKeyMode
          ? baseKey
          : retry === 0
          ? baseKey
          : `${baseKey}_${retry + 1}`.slice(0, 64)

        const payload: CreateSkeletonTopicPayload = {
          topicKey: keyCandidate,
          topicName: topicName,
          topicType: createForm.topicType,
          description: createForm.description.trim() || undefined,
          sortOrder: Number(createForm.sortOrder || 0),
          isEnabled: Number(createForm.isEnabled ?? 1),
        }

        try {
          await skeletonTopicsApi.createSkeletonTopic(novelId, payload)
          created = true
        } catch (err: any) {
          lastError = err
          const msg = String(err?.message || '')
          const isConflict = msg.includes('already exists') || msg.includes('Conflict')
          if (!isConflict || createForm.manualKeyMode) {
            throw err
          }
          retry += 1
        }
      }

      if (!created && lastError) {
        throw lastError
      }

      setCreateForm(DEFAULT_FORM)
      setShowCreate(false)
      await loadTopics()
    } catch (err: any) {
      const msg = String(err?.message || 'Failed to create topic')
      if (msg.includes('already exists') || msg.includes('Conflict')) {
        alert('Topic key conflict (409). Please change topic key or topic name.')
      } else {
        alert(`Failed to create topic: ${msg}`)
      }
    } finally {
      setCreating(false)
    }
  }

  const startEdit = (topic: SkeletonTopicDto) => {
    setEditingId(topic.id)
    setEditDraft({
      topicKey: topic.topicKey,
      topicName: topic.topicName,
      topicType: topic.topicType,
      description: topic.description || '',
      sortOrder: topic.sortOrder,
      isEnabled: topic.isEnabled,
    })
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditDraft({})
  }

  const saveEdit = async (topicId: number) => {
    try {
      setSavingId(topicId)
      const payload = trimPayload(editDraft)
      await skeletonTopicsApi.updateSkeletonTopic(topicId, payload)
      setEditingId(null)
      setEditDraft({})
      await loadTopics()
    } catch (err: any) {
      const msg = String(err?.message || 'Failed to update topic')
      if (msg.includes('already exists') || msg.includes('Conflict')) {
        alert('Topic key conflict (409). Please change topic key.')
      } else {
        alert(`Failed to update topic: ${msg}`)
      }
    } finally {
      setSavingId(null)
    }
  }

  const deleteTopic = async (topicId: number, topicName: string) => {
    if (!confirm(`Delete topic "${topicName}"? This will cascade-delete its items.`)) return
    try {
      await skeletonTopicsApi.deleteSkeletonTopic(topicId)
      await loadTopics()
      setExpandedTopics((prev) => ({ ...prev, [topicId]: false }))
      setItemsByTopic((prev) => {
        const next = { ...prev }
        delete next[topicId]
        return next
      })
    } catch (err: any) {
      alert(`Failed to delete topic: ${err?.message || 'unknown error'}`)
    }
  }

  const toggleEnabled = async (topic: SkeletonTopicDto) => {
    try {
      await skeletonTopicsApi.updateSkeletonTopic(topic.id, {
        isEnabled: topic.isEnabled ? 0 : 1,
      })
      await loadTopics()
    } catch (err: any) {
      alert(`Failed to toggle enabled: ${err?.message || 'unknown error'}`)
    }
  }

  const toggleExpandItems = async (topicId: number) => {
    const nextExpanded = !expandedTopics[topicId]
    setExpandedTopics((prev) => ({ ...prev, [topicId]: nextExpanded }))
    if (nextExpanded && !itemsByTopic[topicId]) {
      await loadItems(topicId)
    }
  }

  const renderContent = (content: string | null, rowKey: string) => {
    const text = content || ''
    const limit = 180
    if (text.length <= limit) return text || '-'
    const expanded = expandedItemContent[rowKey]
    return (
      <>
        {expanded ? text : `${text.slice(0, limit)}...`}
        <button
          onClick={() =>
            setExpandedItemContent((prev) => ({ ...prev, [rowKey]: !prev[rowKey] }))
          }
          style={{
            marginLeft: '8px',
            border: 'none',
            background: 'transparent',
            color: '#1890ff',
            cursor: 'pointer',
            padding: 0,
            fontSize: '12px',
          }}
        >
          {expanded ? 'show less' : 'show more'}
        </button>
      </>
    )
  }

  return (
    <div style={{ border: '1px solid #e8e8e8', borderRadius: '6px', padding: '12px', marginTop: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <div style={{ fontWeight: 600 }}>骨架分析主题管理</div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setShowCreate((prev) => !prev)}
            style={{
              padding: '6px 12px',
              border: '1px solid #1890ff',
              background: 'white',
              color: '#1890ff',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            {showCreate ? '取消新增' : '新增主题'}
          </button>
          <button
            onClick={loadTopics}
            style={{
              padding: '6px 12px',
              border: '1px solid #d9d9d9',
              background: 'white',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            刷新列表
          </button>
        </div>
      </div>

      {showCreate && (
        <div style={{ border: '1px solid #f0f0f0', borderRadius: '6px', padding: '10px', marginBottom: '10px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '8px', marginBottom: '8px' }}>
            <input
              value={createForm.topicName}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, topicName: e.target.value }))}
              placeholder="topicName *"
              style={{ padding: '8px', border: '1px solid #d9d9d9', borderRadius: '4px' }}
            />
            <select
              value={createForm.topicType}
              onChange={(e) =>
                setCreateForm((prev) => ({ ...prev, topicType: e.target.value as 'text' | 'list' | 'json' }))
              }
              style={{ padding: '8px', border: '1px solid #d9d9d9', borderRadius: '4px' }}
            >
              <option value="text">text</option>
              <option value="list">list</option>
              <option value="json">json</option>
            </select>
            <input
              type="number"
              value={createForm.sortOrder}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, sortOrder: Number(e.target.value || 0) }))}
              placeholder="sortOrder"
              style={{ padding: '8px', border: '1px solid #d9d9d9', borderRadius: '4px' }}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '8px', marginBottom: '8px' }}>
            <input
              value={createForm.description}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="description"
              style={{ padding: '8px', border: '1px solid #d9d9d9', borderRadius: '4px' }}
            />
            <select
              value={createForm.isEnabled}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, isEnabled: Number(e.target.value) }))}
              style={{ padding: '8px', border: '1px solid #d9d9d9', borderRadius: '4px' }}
            >
              <option value={1}>enabled</option>
              <option value={0}>disabled</option>
            </select>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', marginBottom: '8px' }}>
            <input
              type="checkbox"
              checked={createForm.manualKeyMode}
              onChange={(e) =>
                setCreateForm((prev) => ({ ...prev, manualKeyMode: e.target.checked }))
              }
            />
            手动填写 topicKey（高级）
          </label>
          {createForm.manualKeyMode ? (
            <input
              value={createForm.topicKeyManual}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, topicKeyManual: e.target.value }))}
              placeholder="topicKey (a-z0-9_)"
              style={{
                width: '100%',
                marginBottom: '8px',
                padding: '8px',
                border: '1px solid #d9d9d9',
                borderRadius: '4px',
              }}
            />
          ) : (
            <div style={{ fontSize: '12px', color: '#666', marginBottom: '8px' }}>
              topicKey will auto-generate from topicName. On conflict it retries with `_2/_3`.
            </div>
          )}
          <button
            onClick={handleCreate}
            disabled={creating}
            style={{
              padding: '8px 14px',
              background: creating ? '#ccc' : '#1890ff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: creating ? 'not-allowed' : 'pointer',
            }}
          >
            {creating ? '创建中...' : '提交新增'}
          </button>
        </div>
      )}

      {error && (
        <div style={{ color: '#ff4d4f', fontSize: '12px', marginBottom: '8px' }}>
          Load error: {error}
        </div>
      )}
      {loading ? (
        <div style={{ color: '#999' }}>Loading topics...</div>
      ) : sortedTopics.length === 0 ? (
        <div style={{ color: '#999' }}>暂无 topics</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {sortedTopics.map((topic) => {
            const isEditing = editingId === topic.id
            const items = itemsByTopic[topic.id] || []
            const itemsExpanded = !!expandedTopics[topic.id]
            const itemsLoading = !!itemsLoadingByTopic[topic.id]
            return (
              <div key={topic.id} style={{ border: '1px solid #f0f0f0', borderRadius: '6px', padding: '10px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr 1fr 1fr auto', gap: '8px', alignItems: 'center' }}>
                  {isEditing ? (
                    <>
                      <input
                        value={String(editDraft.topicName ?? '')}
                        onChange={(e) => setEditDraft((prev) => ({ ...prev, topicName: e.target.value }))}
                        style={{ padding: '6px', border: '1px solid #d9d9d9', borderRadius: '4px' }}
                      />
                      <input
                        value={String(editDraft.topicKey ?? '')}
                        onChange={(e) => setEditDraft((prev) => ({ ...prev, topicKey: slugifyTopicKey(e.target.value) }))}
                        style={{ padding: '6px', border: '1px solid #d9d9d9', borderRadius: '4px' }}
                      />
                      <select
                        value={String(editDraft.topicType ?? 'text')}
                        onChange={(e) => setEditDraft((prev) => ({ ...prev, topicType: e.target.value as 'text' | 'list' | 'json' }))}
                        style={{ padding: '6px', border: '1px solid #d9d9d9', borderRadius: '4px' }}
                      >
                        <option value="text">text</option>
                        <option value="list">list</option>
                        <option value="json">json</option>
                      </select>
                      <input
                        type="number"
                        value={Number(editDraft.sortOrder ?? topic.sortOrder)}
                        onChange={(e) => setEditDraft((prev) => ({ ...prev, sortOrder: Number(e.target.value || 0) }))}
                        style={{ padding: '6px', border: '1px solid #d9d9d9', borderRadius: '4px' }}
                      />
                      <select
                        value={Number(editDraft.isEnabled ?? topic.isEnabled)}
                        onChange={(e) => setEditDraft((prev) => ({ ...prev, isEnabled: Number(e.target.value) }))}
                        style={{ padding: '6px', border: '1px solid #d9d9d9', borderRadius: '4px' }}
                      >
                        <option value={1}>enabled</option>
                        <option value={0}>disabled</option>
                      </select>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          onClick={() => saveEdit(topic.id)}
                          disabled={savingId === topic.id}
                          style={{ padding: '6px 10px', border: 'none', background: '#1890ff', color: 'white', borderRadius: '4px', cursor: 'pointer' }}
                        >
                          {savingId === topic.id ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          onClick={cancelEdit}
                          style={{ padding: '6px 10px', border: '1px solid #d9d9d9', background: 'white', borderRadius: '4px', cursor: 'pointer' }}
                        >
                          Cancel
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <div style={{ fontWeight: 600 }}>{topic.topicName}</div>
                        <div style={{ fontSize: '12px', color: '#999' }}>{topic.description || '-'}</div>
                      </div>
                      <div style={{ fontSize: '12px', color: '#555' }}>{topic.topicKey}</div>
                      <div style={{ fontSize: '12px' }}>{topic.topicType}</div>
                      <div style={{ fontSize: '12px' }}>{topic.sortOrder}</div>
                      <div style={{ fontSize: '12px' }}>{topic.isEnabled ? 'enabled' : 'disabled'}</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', justifyContent: 'flex-end' }}>
                        <button onClick={() => startEdit(topic)} style={{ padding: '5px 8px', border: '1px solid #d9d9d9', background: 'white', borderRadius: '4px', cursor: 'pointer' }}>Edit</button>
                        <button onClick={() => toggleEnabled(topic)} style={{ padding: '5px 8px', border: '1px solid #d9d9d9', background: 'white', borderRadius: '4px', cursor: 'pointer' }}>
                          Toggle Enabled
                        </button>
                        <button onClick={() => loadItems(topic.id)} style={{ padding: '5px 8px', border: '1px solid #d9d9d9', background: 'white', borderRadius: '4px', cursor: 'pointer' }}>
                          Refresh Items
                        </button>
                        <button onClick={() => toggleExpandItems(topic.id)} style={{ padding: '5px 8px', border: '1px solid #d9d9d9', background: 'white', borderRadius: '4px', cursor: 'pointer' }}>
                          {itemsExpanded ? 'Collapse Items' : 'Expand Items'}
                        </button>
                        <button
                          onClick={() => deleteTopic(topic.id, topic.topicName)}
                          style={{ padding: '5px 8px', border: 'none', background: '#ff4d4f', color: 'white', borderRadius: '4px', cursor: 'pointer' }}
                        >
                          Delete
                        </button>
                      </div>
                    </>
                  )}
                </div>

                {isEditing && (
                  <textarea
                    value={String(editDraft.description ?? '')}
                    onChange={(e) => setEditDraft((prev) => ({ ...prev, description: e.target.value }))}
                    placeholder="description"
                    rows={2}
                    style={{
                      width: '100%',
                      marginTop: '8px',
                      padding: '6px',
                      border: '1px solid #d9d9d9',
                      borderRadius: '4px',
                      boxSizing: 'border-box',
                      fontFamily: 'inherit',
                    }}
                  />
                )}

                {itemsExpanded && (
                  <div style={{ marginTop: '10px', borderTop: '1px dashed #eee', paddingTop: '10px' }}>
                    <div style={{ fontWeight: 600, marginBottom: '6px' }}>Items (read-only)</div>
                    {itemsLoading ? (
                      <div style={{ color: '#999' }}>Loading items...</div>
                    ) : items.length === 0 ? (
                      <div style={{ color: '#999' }}>暂无 items</div>
                    ) : (
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                        <thead>
                          <tr>
                            <th style={{ textAlign: 'left', borderBottom: '1px solid #f0f0f0', padding: '6px' }}>itemTitle</th>
                            <th style={{ textAlign: 'left', borderBottom: '1px solid #f0f0f0', padding: '6px' }}>content</th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((it) => (
                            <tr key={it.id}>
                              <td style={{ borderBottom: '1px solid #f7f7f7', padding: '6px', verticalAlign: 'top' }}>{it.itemTitle || '-'}</td>
                              <td style={{ borderBottom: '1px solid #f7f7f7', padding: '6px', color: '#555' }}>
                                {renderContent(it.content, `${topic.id}_${it.id}`)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
