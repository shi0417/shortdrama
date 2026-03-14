'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { episodeScriptVersionApi, episodeSceneApi } from '@/lib/episode-script-api'
import type { EpisodeScriptVersion, EpisodeScene } from '@/types/episode-script'

export default function EpisodeScriptDetailPage({
  novelId,
  episodeNumber,
}: {
  novelId: number
  episodeNumber: number
}) {
  const router = useRouter()
  const [versions, setVersions] = useState<EpisodeScriptVersion[]>([])
  const [activeVersion, setActiveVersion] = useState<EpisodeScriptVersion | null>(null)
  const [scenes, setScenes] = useState<EpisodeScene[]>([])
  const [summaryRow, setSummaryRow] = useState<{ scene_count?: number; shot_count?: number; prompt_count?: number } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [list, summaryList] = await Promise.all([
          episodeScriptVersionApi.getByEpisode(novelId, episodeNumber),
          episodeScriptVersionApi.listSummaryByNovel(novelId).catch(() => []),
        ])
        if (cancelled) return
        setVersions(list || [])
        const active = (list || []).find((v) => v.is_active === 1) ?? null
        setActiveVersion(active)
        const sum = (summaryList || []).find((r: { episode_number: number }) => r.episode_number === episodeNumber)
        setSummaryRow(sum ?? null)
        if (active) {
          const sceneList = await episodeSceneApi.listByScriptVersion(active.id)
          if (!cancelled) setScenes(sceneList || [])
        } else {
          setScenes([])
        }
      } catch {
        if (!cancelled) setScenes([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [novelId, episodeNumber])

  async function setActive(id: number) {
    try {
      await episodeScriptVersionApi.setActive(id)
      const list = await episodeScriptVersionApi.getByEpisode(novelId, episodeNumber)
      setVersions(list || [])
      const active = (list || []).find((v) => v.is_active === 1) ?? null
      setActiveVersion(active)
      if (active) {
        const sceneList = await episodeSceneApi.listByScriptVersion(active.id)
        setScenes(sceneList || [])
      } else {
        setScenes([])
      }
    } catch (e: unknown) {
      alert((e as Error)?.message || '设置失败')
    }
  }

  if (loading) return <div style={{ padding: 24 }}>加载中…</div>

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>第 {episodeNumber} 集 - Script</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => router.push(`/projects/${novelId}/pipeline/episode-scripts`)} style={{ padding: '6px 12px', cursor: 'pointer' }}>返回列表</button>
          <button type="button" onClick={() => router.push(`/projects/${novelId}/pipeline/episode-scripts/${episodeNumber}/scenes`)} style={{ padding: '6px 12px', cursor: 'pointer' }}>Scene Board</button>
          <button type="button" onClick={() => router.push(`/projects/${novelId}/pipeline/episode-scripts/${episodeNumber}/shots`)} style={{ padding: '6px 12px', cursor: 'pointer' }}>Shot Board</button>
        </div>
      </div>
      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, marginBottom: 8 }}>版本</h2>
        {versions.length === 0 ? (
          <p style={{ color: '#999' }}>暂无版本</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {versions.map((v) => (
              <li key={v.id} style={{ padding: '8px 0', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>v{v.version_no} {v.title} ({v.script_type}){v.is_active === 1 ? ' [当前]' : ''}</span>
                {v.is_active !== 1 && <button type="button" onClick={() => setActive(v.id)} style={{ padding: '4px 8px', cursor: 'pointer' }}>设为当前</button>}
              </li>
            ))}
          </ul>
        )}
      </section>
      {activeVersion && (
        <section>
          <h2 style={{ fontSize: 16, marginBottom: 8 }}>当前版本概述</h2>
          <p style={{ whiteSpace: 'pre-wrap', color: '#666' }}>{activeVersion.summary || '（无）'}</p>
          {summaryRow && (
            <p style={{ fontSize: 13, color: '#666', marginTop: 8 }}>
              共 {summaryRow.scene_count ?? 0} 场 · {summaryRow.shot_count ?? 0} 镜 · {summaryRow.prompt_count ?? 0} 条提示词
            </p>
          )}
          <h3 style={{ fontSize: 14, marginTop: 16 }}>场景列表（{scenes.length}）</h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {scenes.map((s) => (
              <li key={s.id} style={{ padding: '8px 0', borderBottom: '1px solid #eee' }}>{s.scene_no}. {s.scene_title}{s.location_name ? ` · ${s.location_name}` : ''}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
