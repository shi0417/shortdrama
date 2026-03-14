'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  episodeScriptVersionApi,
  episodeSceneApi,
} from '@/lib/episode-script-api'
import type { EpisodeScriptVersion, EpisodeScene } from '@/types/episode-script'

const pageStyle: React.CSSProperties = {
  padding: 24,
  maxWidth: 1000,
  margin: '0 auto',
}

export default function SceneBoardPage({
  novelId,
  episodeNumber,
}: {
  novelId: number
  episodeNumber: number
}) {
  const router = useRouter()
  const [activeVersion, setActiveVersion] = useState<EpisodeScriptVersion | null>(null)
  const [scenes, setScenes] = useState<EpisodeScene[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<EpisodeScene | null>(null)
  const [saving, setSaving] = useState(false)

  const load = async () => {
    try {
      setLoading(true)
      const list = await episodeScriptVersionApi.getByEpisode(
        novelId,
        episodeNumber
      )
      const active = (list || []).find((v) => v.is_active === 1) ?? null
      setActiveVersion(active)
      if (active) {
        const sceneList = await episodeSceneApi.listByScriptVersion(active.id)
        setScenes(sceneList || [])
      } else {
        setScenes([])
      }
    } catch {
      setScenes([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [novelId, episodeNumber])

  const handleSave = async () => {
    if (!editing) return
    try {
      setSaving(true)
      await episodeSceneApi.update(editing.id, {
        scene_title: editing.scene_title,
        location_name: editing.location_name ?? '',
        scene_summary: editing.scene_summary ?? '',
        main_conflict: editing.main_conflict ?? '',
        narrator_text: editing.narrator_text ?? '',
        screen_subtitle: editing.screen_subtitle ?? '',
        estimated_seconds: editing.estimated_seconds,
      })
      setEditing(null)
      await load()
    } catch (e: any) {
      alert(e?.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleAdd = async () => {
    if (!activeVersion) {
      alert('请先在该集下创建并启用一个脚本版本')
      return
    }
    try {
      const nextNo = scenes.length + 1
      await episodeSceneApi.create(activeVersion.id, {
        sceneNo: nextNo,
        sceneTitle: `场景 ${nextNo}`,
        sortOrder: nextNo,
      })
      await load()
    } catch (e: any) {
      alert(e?.message || '新增失败')
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('确定删除该场景？')) return
    try {
      await episodeSceneApi.remove(id)
      await load()
      setEditing(null)
    } catch (e: any) {
      alert(e?.message || '删除失败')
    }
  }

  return (
    <div style={pageStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>
          第 {episodeNumber} 集 - Scene Board
        </h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => router.push(`/projects/${novelId}/pipeline/episode-scripts/${episodeNumber}`)}
            style={{ padding: '6px 12px', cursor: 'pointer' }}
          >
            返回 Script
          </button>
          <button
            type="button"
            onClick={() => router.push(`/projects/${novelId}/pipeline/episode-scripts/${episodeNumber}/shots`)}
            style={{ padding: '6px 12px', cursor: 'pointer' }}
          >
            Shot Board
          </button>
        </div>
      </div>

      {loading ? (
        <div>加载中…</div>
      ) : !activeVersion ? (
        <p style={{ color: '#999' }}>
          该集暂无启用的脚本版本，请先在 Episode Script 页生成或创建版本。
        </p>
      ) : (
        <>
          <div style={{ marginBottom: 16 }}>
            <button
              type="button"
              onClick={() => void handleAdd()}
              style={{ padding: '6px 12px', cursor: 'pointer' }}
            >
              + 新增场景
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {scenes.map((s) =>
              editing?.id === s.id ? (
                <div
                  key={s.id}
                  style={{
                    border: '1px solid #1890ff',
                    borderRadius: 8,
                    padding: 16,
                    background: '#fafafa',
                  }}
                >
                  <div style={{ marginBottom: 8 }}>
                    <label>场景标题</label>
                    <input
                      value={editing.scene_title}
                      onChange={(e) =>
                        setEditing({ ...editing, scene_title: e.target.value })
                      }
                      style={{ width: '100%', padding: 6, marginTop: 4 }}
                    />
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <label>地点</label>
                    <input
                      value={editing.location_name ?? ''}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          location_name: e.target.value || null,
                        })
                      }
                      style={{ width: '100%', padding: 6, marginTop: 4 }}
                    />
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <label>旁白</label>
                    <textarea
                      value={editing.narrator_text ?? ''}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          narrator_text: e.target.value || null,
                        })
                      }
                      rows={4}
                      style={{ width: '100%', padding: 6, marginTop: 4 }}
                    />
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <label>屏幕字幕</label>
                    <input
                      value={editing.screen_subtitle ?? ''}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          screen_subtitle: e.target.value || null,
                        })
                      }
                      style={{ width: '100%', padding: 6, marginTop: 4 }}
                    />
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <label>预计时长（秒）</label>
                    <input
                      type="number"
                      value={editing.estimated_seconds}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          estimated_seconds: Number(e.target.value) || 0,
                        })
                      }
                      style={{ width: 120, padding: 6, marginTop: 4 }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void handleSave()}
                      style={{ padding: '6px 12px', cursor: 'pointer' }}
                    >
                      {saving ? '保存中…' : '保存'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(null)}
                      style={{ padding: '6px 12px', cursor: 'pointer' }}
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  key={s.id}
                  style={{
                    border: '1px solid #eee',
                    borderRadius: 8,
                    padding: 16,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <strong>
                        {s.scene_no}. {s.scene_title}
                      </strong>
                      {s.location_name && (
                        <span style={{ marginLeft: 8, color: '#666' }}>
                          {s.location_name}
                        </span>
                      )}
                      <p style={{ margin: '8px 0 0', color: '#666', fontSize: 13 }}>
                        {s.narrator_text?.slice(0, 200)}
                        {(s.narrator_text?.length ?? 0) > 200 ? '…' : ''}
                      </p>
                      <p style={{ margin: '4px 0 0', fontSize: 12, color: '#999' }}>
                        时长约 {s.estimated_seconds}s
                      </p>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        type="button"
                        onClick={() => setEditing(s)}
                        style={{ padding: '4px 8px', cursor: 'pointer' }}
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(s.id)}
                        style={{ padding: '4px 8px', cursor: 'pointer', color: '#ff4d4f' }}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                </div>
              )
            )}
          </div>
        </>
      )}
    </div>
  )
}
