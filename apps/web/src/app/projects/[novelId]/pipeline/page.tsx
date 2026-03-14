'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import PipelinePanel from '@/components/PipelinePanel'

export default function PipelineRoutePage() {
  const params = useParams<{ novelId: string }>()
  const router = useRouter()
  const novelId = Number(params?.novelId)
  const [novelName, setNovelName] = useState<string>('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!Number.isInteger(novelId) || novelId <= 0) {
      setLoading(false)
      return
    }
    let cancelled = false
    api
      .getNovel(novelId)
      .then((novel) => {
        if (!cancelled && novel) setNovelName(novel.novelsName || '')
      })
      .catch(() => {
        if (!cancelled) setNovelName('')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [novelId])

  if (!Number.isInteger(novelId) || novelId <= 0) {
    return (
      <div style={{ padding: 24, color: '#ff4d4f' }}>
        Invalid novel id
      </div>
    )
  }

  if (loading) {
    return (
      <div style={{ padding: 24, color: '#666' }}>
        Loading...
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '100vh', background: '#f5f5f5' }}>
      <div style={{ padding: '16px 24px', background: 'white', borderBottom: '1px solid #e8e8e8', display: 'flex', alignItems: 'center', gap: 16 }}>
        <button
          type="button"
          onClick={() => router.push('/projects')}
          style={{ padding: '6px 12px', cursor: 'pointer' }}
        >
          ← 返回项目
        </button>
        <span style={{ fontSize: 18, fontWeight: 500 }}>Pipeline · {novelName || `Novel ${novelId}`}</span>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        <PipelinePanel novelId={novelId} novelName={novelName || `Novel ${novelId}`} />
      </div>
    </div>
  )
}
