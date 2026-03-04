'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Novel, Theme } from '@/types'
import { api } from '@/lib/api'
import ProjectList from '@/components/ProjectList'
import ProjectDetail from '@/components/ProjectDetail'

export default function ProjectsPage() {
  const router = useRouter()
  const [username, setUsername] = useState<string>('')
  const [selectedNovel, setSelectedNovel] = useState<Novel | null>(null)
  const [themes, setThemes] = useState<Theme[]>([])
  const [refreshTrigger, setRefreshTrigger] = useState(0)

  useEffect(() => {
    const token = localStorage.getItem('accessToken')
    if (!token) {
      router.push('/login')
      return
    }

    try {
      const payload = JSON.parse(atob(token.split('.')[1]))
      setUsername(payload.username || 'User')
    } catch (error) {
      console.error('Failed to parse token:', error)
      setUsername('User')
    }

    loadThemes()
  }, [router])

  const loadThemes = async () => {
    try {
      const data = await api.getThemes()
      setThemes(data)
    } catch (error: any) {
      console.error('Failed to load themes:', error)
    }
  }

  const handleLogout = () => {
    localStorage.removeItem('accessToken')
    router.push('/login')
  }

  const handleSelectNovel = (novel: Novel) => {
    setSelectedNovel(novel)
  }

  const handleUpdate = async () => {
    if (selectedNovel) {
      try {
        const updated = await api.getNovel(selectedNovel.id)
        setSelectedNovel(updated)
        setRefreshTrigger(prev => prev + 1)
      } catch (error: any) {
        console.error('Failed to refresh novel:', error)
      }
    }
  }

  const handleDelete = () => {
    setSelectedNovel(null)
    setRefreshTrigger(prev => prev + 1)
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f5', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <header style={{
        background: 'white',
        padding: '16px 24px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <h1 style={{ margin: 0, fontSize: '20px', color: '#333' }}>
          Short Drama Management System
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{ color: '#666', fontSize: '14px' }}>Welcome, {username}</span>
          <button
            onClick={handleLogout}
            style={{
              padding: '6px 16px',
              background: '#667eea',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            Logout
          </button>
        </div>
      </header>

      {/* Main Content: Two Columns */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left Column: Project List */}
        <div style={{ width: '320px', height: 'calc(100vh - 64px)' }}>
          <ProjectList
            onSelectNovel={handleSelectNovel}
            selectedNovelId={selectedNovel?.id || null}
            refreshTrigger={refreshTrigger}
          />
        </div>

        {/* Right Column: Project Detail */}
        <div style={{ flex: 1, height: 'calc(100vh - 64px)', overflowY: 'auto' }}>
          {selectedNovel ? (
            <ProjectDetail
              novel={selectedNovel}
              themes={themes}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
            />
          ) : (
            <div style={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#999',
              fontSize: '16px',
            }}>
              Select a project to view details
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
