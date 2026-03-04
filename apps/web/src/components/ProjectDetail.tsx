'use client'

import { useState, useEffect } from 'react'
import { Novel, Theme } from '@/types'
import { api } from '@/lib/api'
import SourceTextManager from './SourceTextManager'
import PipelinePanel from './PipelinePanel'

interface ProjectDetailProps {
  novel: Novel
  themes: Theme[]
  onUpdate: () => void
  onDelete: () => void
}

export default function ProjectDetail({ novel, themes, onUpdate, onDelete }: ProjectDetailProps) {
  const [activeTab, setActiveTab] = useState<'basic' | 'source' | 'pipeline'>('basic')
  const [formData, setFormData] = useState({
    novelsName: novel.novelsName,
    description: novel.description || '',
    totalChapters: novel.totalChapters,
    powerUpInterval: novel.powerUpInterval,
    author: novel.author || '',
    status: novel.status,
    themeId: novel.themeId,
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setFormData({
      novelsName: novel.novelsName,
      description: novel.description || '',
      totalChapters: novel.totalChapters,
      powerUpInterval: novel.powerUpInterval,
      author: novel.author || '',
      status: novel.status,
      themeId: novel.themeId,
    })
  }, [novel])

  const handleSave = async () => {
    try {
      setSaving(true)
      await api.updateNovel(novel.id, formData)
      alert('Project saved successfully')
      onUpdate()
    } catch (error: any) {
      alert('Failed to save: ' + error.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to delete "${novel.novelsName}"?`)) {
      return
    }

    try {
      await api.deleteNovel(novel.id)
      alert('Project deleted successfully')
      onDelete()
    } catch (error: any) {
      alert('Failed to delete: ' + error.message)
    }
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'white' }}>
      <div style={{ borderBottom: '1px solid #e8e8e8', display: 'flex' }}>
        <button
          onClick={() => setActiveTab('basic')}
          style={{
            padding: '12px 24px',
            border: 'none',
            background: activeTab === 'basic' ? 'white' : '#fafafa',
            borderBottom: activeTab === 'basic' ? '2px solid #1890ff' : '2px solid transparent',
            cursor: 'pointer',
            fontWeight: activeTab === 'basic' ? 500 : 400,
          }}
        >
          Basic Info
        </button>
        <button
          onClick={() => setActiveTab('source')}
          style={{
            padding: '12px 24px',
            border: 'none',
            background: activeTab === 'source' ? 'white' : '#fafafa',
            borderBottom: activeTab === 'source' ? '2px solid #1890ff' : '2px solid transparent',
            cursor: 'pointer',
            fontWeight: activeTab === 'source' ? 500 : 400,
          }}
        >
          Reference Materials
        </button>
        <button
          onClick={() => setActiveTab('pipeline')}
          style={{
            padding: '12px 24px',
            border: 'none',
            background: activeTab === 'pipeline' ? 'white' : '#fafafa',
            borderBottom: activeTab === 'pipeline' ? '2px solid #1890ff' : '2px solid transparent',
            cursor: 'pointer',
            fontWeight: activeTab === 'pipeline' ? 500 : 400,
          }}
        >
          Pipeline
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
        {activeTab === 'basic' ? (
          <div>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', color: '#666' }}>
                ID (Read-only)
              </label>
              <input
                type="text"
                value={novel.id}
                disabled
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #d9d9d9',
                  borderRadius: '4px',
                  background: '#f5f5f5',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', color: '#666' }}>
                Project Name *
              </label>
              <input
                type="text"
                value={formData.novelsName}
                onChange={(e) => setFormData({ ...formData, novelsName: e.target.value })}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #d9d9d9',
                  borderRadius: '4px',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', color: '#666' }}>
                Description
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={8}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #d9d9d9',
                  borderRadius: '4px',
                  boxSizing: 'border-box',
                  fontFamily: 'inherit',
                  fontSize: '14px',
                  resize: 'vertical',
                }}
                placeholder="Enter project description..."
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', color: '#666' }}>
                Total Chapters
              </label>
              <input
                type="number"
                value={formData.totalChapters}
                onChange={(e) => setFormData({ ...formData, totalChapters: Number(e.target.value) })}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #d9d9d9',
                  borderRadius: '4px',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', color: '#666' }}>
                Power Up Interval
              </label>
              <input
                type="number"
                value={formData.powerUpInterval}
                onChange={(e) => setFormData({ ...formData, powerUpInterval: Number(e.target.value) })}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #d9d9d9',
                  borderRadius: '4px',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', color: '#666' }}>
                Author
              </label>
              <input
                type="text"
                value={formData.author}
                onChange={(e) => setFormData({ ...formData, author: e.target.value })}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #d9d9d9',
                  borderRadius: '4px',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', color: '#666' }}>
                Status
              </label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: Number(e.target.value) })}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #d9d9d9',
                  borderRadius: '4px',
                }}
              >
                <option value={0}>Draft</option>
                <option value={1}>Active</option>
                <option value={2}>Archived</option>
              </select>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', color: '#666' }}>
                Theme
              </label>
              <select
                value={formData.themeId ?? ''}
                onChange={(e) => setFormData({ ...formData, themeId: e.target.value ? Number(e.target.value) : null })}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #d9d9d9',
                  borderRadius: '4px',
                }}
              >
                <option value="">No theme</option>
                {themes.map((theme) => (
                  <option key={theme.id} value={theme.id}>
                    {theme.categoryMain} / {theme.categorySub}
                    {theme.hotLevel > 0 && ` (Hot: ${theme.hotLevel})`}
                    {theme.isHotTrack === 1 && ' [Hot Track]'}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', color: '#666' }}>
                Created At (Read-only)
              </label>
              <input
                type="text"
                value={new Date(novel.createTime).toLocaleString()}
                disabled
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #d9d9d9',
                  borderRadius: '4px',
                  background: '#f5f5f5',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{
                  padding: '10px 24px',
                  background: saving ? '#ccc' : '#1890ff',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: saving ? 'not-allowed' : 'pointer',
                  fontSize: '14px',
                }}
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={handleDelete}
                style={{
                  padding: '10px 24px',
                  background: '#ff4d4f',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px',
                }}
              >
                Delete
              </button>
            </div>
          </div>
        ) : activeTab === 'source' ? (
          <SourceTextManager novelId={novel.id} />
        ) : (
          <PipelinePanel novelId={novel.id} novelName={novel.novelsName} />
        )}
      </div>
    </div>
  )
}
