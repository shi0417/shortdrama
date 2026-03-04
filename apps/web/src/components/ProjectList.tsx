'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Novel, Theme } from '@/types'
import { api } from '@/lib/api'

interface ProjectListProps {
  onSelectNovel: (novel: Novel) => void
  selectedNovelId: number | null
  refreshTrigger: number
}

export default function ProjectList({ onSelectNovel, selectedNovelId, refreshTrigger }: ProjectListProps) {
  const router = useRouter()
  const [novels, setNovels] = useState<Novel[]>([])
  const [themes, setThemes] = useState<Theme[]>([])
  const [loading, setLoading] = useState(true)
  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState<number | undefined>()
  const [themeFilter, setThemeFilter] = useState<number | undefined>()
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createForm, setCreateForm] = useState({
    novelsName: '',
    themeId: undefined as number | undefined,
    status: 0,
    author: '',
  })

  useEffect(() => {
    const token = localStorage.getItem('accessToken')
    if (!token) {
      router.push('/login')
      return
    }
    loadData()
  }, [router, refreshTrigger])

  const loadData = async () => {
    try {
      setLoading(true)
      const [novelsData, themesData] = await Promise.all([
        api.getNovels({ keyword, status: statusFilter, themeId: themeFilter }),
        api.getThemes(),
      ])
      setNovels(novelsData)
      setThemes(themesData)
    } catch (error: any) {
      if (error.message.includes('Unauthorized')) {
        router.push('/login')
      } else {
        alert('Failed to load data: ' + error.message)
      }
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = () => {
    loadData()
  }

  const handleCreate = async () => {
    if (!createForm.novelsName.trim()) {
      alert('Project name is required')
      return
    }

    try {
      const newNovel = await api.createNovel(createForm)
      setShowCreateModal(false)
      setCreateForm({ novelsName: '', themeId: undefined, status: 0, author: '' })
      await loadData()
      onSelectNovel(newNovel)
    } catch (error: any) {
      alert('Failed to create project: ' + error.message)
    }
  }

  const getStatusBadge = (status: number) => {
    const styles = {
      0: { bg: '#f0f0f0', color: '#666', text: 'Draft' },
      1: { bg: '#e6f7ff', color: '#1890ff', text: 'Active' },
      2: { bg: '#fff7e6', color: '#fa8c16', text: 'Archived' },
    }
    const style = styles[status as keyof typeof styles] || styles[0]
    return (
      <span style={{
        padding: '2px 8px',
        borderRadius: '4px',
        fontSize: '12px',
        background: style.bg,
        color: style.color,
      }}>
        {style.text}
      </span>
    )
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'white', borderRight: '1px solid #e8e8e8' }}>
      <div style={{ padding: '16px', borderBottom: '1px solid #e8e8e8' }}>
        <input
          type="text"
          placeholder="Search projects..."
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          style={{
            width: '100%',
            padding: '8px 12px',
            border: '1px solid #d9d9d9',
            borderRadius: '4px',
            marginBottom: '8px',
          }}
        />
        <select
          value={statusFilter ?? ''}
          onChange={(e) => setStatusFilter(e.target.value ? Number(e.target.value) : undefined)}
          style={{
            width: '100%',
            padding: '8px 12px',
            border: '1px solid #d9d9d9',
            borderRadius: '4px',
            marginBottom: '8px',
          }}
        >
          <option value="">All Status</option>
          <option value="0">Draft</option>
          <option value="1">Active</option>
          <option value="2">Archived</option>
        </select>
        <select
          value={themeFilter ?? ''}
          onChange={(e) => setThemeFilter(e.target.value ? Number(e.target.value) : undefined)}
          style={{
            width: '100%',
            padding: '8px 12px',
            border: '1px solid #d9d9d9',
            borderRadius: '4px',
            marginBottom: '8px',
          }}
        >
          <option value="">All Themes</option>
          {themes.map((theme) => (
            <option key={theme.id} value={theme.id}>
              {theme.categoryMain} / {theme.categorySub}
            </option>
          ))}
        </select>
        <button
          onClick={handleSearch}
          style={{
            width: '100%',
            padding: '8px 12px',
            background: '#1890ff',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            marginBottom: '8px',
          }}
        >
          Search
        </button>
        <button
          onClick={() => setShowCreateModal(true)}
          style={{
            width: '100%',
            padding: '8px 12px',
            background: '#52c41a',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          + Create Project
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ padding: '20px', textAlign: 'center', color: '#999' }}>Loading...</div>
        ) : novels.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', color: '#999' }}>No projects found</div>
        ) : (
          novels.map((novel) => (
            <div
              key={novel.id}
              onClick={() => onSelectNovel(novel)}
              style={{
                padding: '12px 16px',
                borderBottom: '1px solid #f0f0f0',
                cursor: 'pointer',
                background: selectedNovelId === novel.id ? '#e6f7ff' : 'white',
              }}
            >
              <div style={{ fontWeight: 500, marginBottom: '4px' }}>{novel.novelsName}</div>
              <div style={{ fontSize: '12px', color: '#999', marginBottom: '4px' }}>
                Chapters: {novel.totalChapters} | {novel.theme?.categorySub || 'No theme'}
              </div>
              <div>{getStatusBadge(novel.status)}</div>
            </div>
          ))
        )}
      </div>

      {showCreateModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div style={{
            background: 'white',
            padding: '24px',
            borderRadius: '8px',
            width: '90%',
            maxWidth: '500px',
          }}>
            <h3 style={{ marginTop: 0 }}>Create New Project</h3>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px' }}>
                Project Name *
              </label>
              <input
                type="text"
                value={createForm.novelsName}
                onChange={(e) => setCreateForm({ ...createForm, novelsName: e.target.value })}
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
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px' }}>Theme</label>
              <select
                value={createForm.themeId ?? ''}
                onChange={(e) => setCreateForm({ ...createForm, themeId: e.target.value ? Number(e.target.value) : undefined })}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #d9d9d9',
                  borderRadius: '4px',
                }}
              >
                <option value="">Select theme</option>
                {themes.map((theme) => (
                  <option key={theme.id} value={theme.id}>
                    {theme.categoryMain} / {theme.categorySub}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px' }}>Author</label>
              <input
                type="text"
                value={createForm.author}
                onChange={(e) => setCreateForm({ ...createForm, author: e.target.value })}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #d9d9d9',
                  borderRadius: '4px',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowCreateModal(false)}
                style={{
                  padding: '8px 16px',
                  border: '1px solid #d9d9d9',
                  borderRadius: '4px',
                  background: 'white',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                style={{
                  padding: '8px 16px',
                  background: '#1890ff',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
