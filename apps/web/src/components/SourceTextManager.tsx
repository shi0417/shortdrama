'use client'

import { useState, useEffect } from 'react'
import { SourceText } from '@/types'
import { api } from '@/lib/api'

interface SourceTextManagerProps {
  novelId: number
}

export default function SourceTextManager({ novelId }: SourceTextManagerProps) {
  const [sourceTexts, setSourceTexts] = useState<SourceText[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [loadedText, setLoadedText] = useState('')
  const [loadedLength, setLoadedLength] = useState(0)
  const [totalLength, setTotalLength] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  const CHUNK_SIZE = 5000

  useEffect(() => {
    loadSourceTexts()
  }, [novelId])

  const loadSourceTexts = async () => {
    try {
      const data = await api.getSourceTexts(novelId)
      setSourceTexts(data)
    } catch (error: any) {
      alert('Failed to load source texts: ' + error.message)
    }
  }

  const handleCreate = async () => {
    try {
      await api.createSourceText(novelId)
      await loadSourceTexts()
      alert('New reference material created')
    } catch (error: any) {
      alert('Failed to create: ' + error.message)
    }
  }

  const handleSelect = async (id: number) => {
    setSelectedId(id)
    setLoadedText('')
    setLoadedLength(0)
    setTotalLength(0)

    try {
      setLoading(true)
      const chunk = await api.getSourceTextChunk(id, 0, CHUNK_SIZE)
      setLoadedText(chunk.text)
      setLoadedLength(chunk.text.length)
      setTotalLength(chunk.totalLength)
    } catch (error: any) {
      alert('Failed to load text: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleLoadMore = async () => {
    if (!selectedId) return

    try {
      setLoadingMore(true)
      const chunk = await api.getSourceTextChunk(selectedId, loadedLength, CHUNK_SIZE)
      setLoadedText(prev => prev + chunk.text)
      setLoadedLength(prev => prev + chunk.text.length)
    } catch (error: any) {
      alert('Failed to load more: ' + error.message)
    } finally {
      setLoadingMore(false)
    }
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(loadedText)
    alert('Text copied to clipboard')
  }

  const handleExport = () => {
    const blob = new Blob([loadedText], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `source_text_${selectedId}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this reference material?')) {
      return
    }

    try {
      await api.deleteSourceText(id)
      await loadSourceTexts()
      if (selectedId === id) {
        setSelectedId(null)
        setLoadedText('')
        setLoadedLength(0)
        setTotalLength(0)
      }
      alert('Reference material deleted')
    } catch (error: any) {
      alert('Failed to delete: ' + error.message)
    }
  }

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 chars'
    return `${bytes.toLocaleString()} chars`
  }

  return (
    <div style={{ display: 'flex', height: '500px', gap: '16px' }}>
      {/* Left: List */}
      <div style={{ width: '300px', display: 'flex', flexDirection: 'column', border: '1px solid #e8e8e8', borderRadius: '4px' }}>
        <div style={{ padding: '12px', borderBottom: '1px solid #e8e8e8' }}>
          <button
            onClick={handleCreate}
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
            + New Material
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {sourceTexts.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: '#999' }}>
              No materials yet
            </div>
          ) : (
            sourceTexts.map((st) => (
              <div
                key={st.id}
                style={{
                  padding: '12px',
                  borderBottom: '1px solid #f0f0f0',
                  cursor: 'pointer',
                  background: selectedId === st.id ? '#e6f7ff' : 'white',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div onClick={() => handleSelect(st.id)} style={{ flex: 1 }}>
                  <div style={{ fontSize: '14px', fontWeight: 500 }}>Material #{st.id}</div>
                  <div style={{ fontSize: '12px', color: '#999', marginTop: '4px' }}>
                    {formatBytes(st.contentLength)}
                  </div>
                  <div style={{ fontSize: '12px', color: '#999' }}>
                    {new Date(st.updateTime).toLocaleString()}
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDelete(st.id)
                  }}
                  style={{
                    padding: '4px 8px',
                    background: '#ff4d4f',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '12px',
                  }}
                >
                  Delete
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right: Reader */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', border: '1px solid #e8e8e8', borderRadius: '4px' }}>
        {!selectedId ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}>
            Select a material to view
          </div>
        ) : (
          <>
            <div style={{ padding: '12px', borderBottom: '1px solid #e8e8e8', display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={{ fontSize: '14px', color: '#666' }}>
                Loaded: {formatBytes(loadedLength)} / {formatBytes(totalLength)}
              </span>
              <div style={{ flex: 1 }} />
              <button
                onClick={handleCopy}
                disabled={!loadedText}
                style={{
                  padding: '6px 12px',
                  background: '#1890ff',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: loadedText ? 'pointer' : 'not-allowed',
                  fontSize: '12px',
                }}
              >
                Copy
              </button>
              <button
                onClick={handleExport}
                disabled={!loadedText}
                style={{
                  padding: '6px 12px',
                  background: '#1890ff',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: loadedText ? 'pointer' : 'not-allowed',
                  fontSize: '12px',
                }}
              >
                Export TXT
              </button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px', background: '#fafafa' }}>
              {loading ? (
                <div style={{ textAlign: 'center', color: '#999' }}>Loading...</div>
              ) : (
                <pre style={{
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontFamily: 'monospace',
                  fontSize: '14px',
                  lineHeight: '1.6',
                  margin: 0,
                }}>
                  {loadedText || 'No content'}
                </pre>
              )}
            </div>
            {loadedLength < totalLength && (
              <div style={{ padding: '12px', borderTop: '1px solid #e8e8e8', textAlign: 'center' }}>
                <button
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  style={{
                    padding: '8px 24px',
                    background: loadingMore ? '#ccc' : '#1890ff',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: loadingMore ? 'not-allowed' : 'pointer',
                  }}
                >
                  {loadingMore ? 'Loading...' : `Load More (${formatBytes(Math.min(CHUNK_SIZE, totalLength - loadedLength))})`}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
