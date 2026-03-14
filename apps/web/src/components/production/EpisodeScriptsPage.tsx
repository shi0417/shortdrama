'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import {
  episodeScriptVersionApi,
  narratorScriptApi,
} from '@/lib/episode-script-api'
import type {
  EpisodeScriptVersion,
  NarratorScriptDraftPayload,
  NarratorScriptPersistResponse,
} from '@/types/episode-script'

const pageStyle: React.CSSProperties = {
  padding: 24,
  maxWidth: 1000,
  margin: '0 auto',
}

/** API 错误里的业务错误码（apiClient 将响应体放在 error.payload） */
function getErrorCode(e: unknown): string | undefined {
  const err = e as { payload?: { code?: string }; response?: { data?: { code?: string } }; data?: { code?: string } }
  return err?.payload?.code ?? err?.response?.data?.code ?? err?.data?.code
}

export default function EpisodeScriptsPage({
  novelId,
}: {
  novelId: number
}) {
  const router = useRouter()
  const [novelName, setNovelName] = useState('')
  const [versions, setVersions] = useState<EpisodeScriptVersion[]>([])
  const [summaryRows, setSummaryRows] = useState<Array<{ episode_number: number; id: number; version_no: number; title: string; script_type: string; scene_count?: number; shot_count?: number; prompt_count?: number }>>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [persisting, setPersisting] = useState(false)
  const [draftId, setDraftId] = useState<string | null>(null)
  const [lastDraft, setLastDraft] = useState<NarratorScriptDraftPayload | null>(null)
  const [draftPreview, setDraftPreview] = useState<{ scripts: { episodeNumber: number; title: string }[]; batchCount?: number } | null>(null)
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false)
  const [generateParams, setGenerateParams] = useState({ batchSize: 5, modelKey: '', startEpisode: '', endEpisode: '' })

  const load = async () => {
    try {
      setLoading(true)
      const [novel, list, summary] = await Promise.all([
        api.getNovel(novelId),
        episodeScriptVersionApi.listByNovel(novelId),
        episodeScriptVersionApi.listSummaryByNovel(novelId).catch(() => []),
      ])
      setNovelName(novel?.novelsName || '')
      setVersions(list || [])
      setSummaryRows(Array.isArray(summary) ? summary : [])
    } catch (e: unknown) {
      alert((e as Error)?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [novelId])

  const activeByEpisode = new Map<number, EpisodeScriptVersion>()
  for (const v of versions) {
    if (v.is_active === 1) {
      activeByEpisode.set(v.episode_number, v)
    }
  }
  const summaryByEpisode = new Map(summaryRows.map((r) => [r.episode_number, r]))
  const episodeNumbers = Array.from(
    new Set(versions.map((v) => v.episode_number))
  ).sort((a, b) => a - b)

  const handleOpenGenerateDialog = () => {
    setGenerateParams({ batchSize: 5, modelKey: '', startEpisode: '', endEpisode: '' })
    setGenerateDialogOpen(true)
  }

  const handleGenerate = async () => {
    const params: {
      batchSize?: number
      modelKey?: string
      startEpisode?: number
      endEpisode?: number
    } = { batchSize: generateParams.batchSize }
    if (generateParams.modelKey.trim()) params.modelKey = generateParams.modelKey.trim()
    const start = parseInt(generateParams.startEpisode, 10)
    const end = parseInt(generateParams.endEpisode, 10)
    if (!Number.isNaN(start) && start >= 1) params.startEpisode = start
    if (!Number.isNaN(end) && end >= 1) params.endEpisode = end
    setGenerateDialogOpen(false)
    try {
      setGenerating(true)
      setDraftId(null)
      setLastDraft(null)
      setDraftPreview(null)
      const res = await narratorScriptApi.generateDraft(novelId, params)
      setDraftId(res.draftId)
      setLastDraft(res.draft ?? null)
      setDraftPreview(
        res.draft?.scripts
          ? {
              scripts: res.draft.scripts.map((s) => ({
                episodeNumber: s.episodeNumber,
                title: s.title,
              })),
              batchCount: res.draft?.meta?.batchCount,
            }
          : null
      )
    } catch (e: unknown) {
      alert((e as Error)?.message || '生成草稿失败')
    } finally {
      setGenerating(false)
    }
  }

  const handlePersist = async () => {
    if (!draftId && !lastDraft) {
      alert('请先生成草稿后再保存（或草稿已过期，请重新生成）')
      return
    }
    try {
      setPersisting(true)
      const payload = draftId ? { draftId, draft: lastDraft ?? undefined } : { draft: lastDraft! }
      let res: NarratorScriptPersistResponse | undefined
      try {
        res = await narratorScriptApi.persistDraft(novelId, payload)
      } catch (firstErr: unknown) {
        const code = getErrorCode(firstErr)
        if (code === 'NARRATOR_SCRIPT_DRAFT_CACHE_MISS' && lastDraft) {
          res = await narratorScriptApi.persistDraft(novelId, { draft: lastDraft })
        } else {
          throw firstErr
        }
      }
      if (res?.ok && res.summary) {
        setDraftId(null)
        setLastDraft(null)
        setDraftPreview(null)
        await load()
        const s = res.summary
        const msg = `保存成功：${s.scriptVersions} 版本，${s.scenes} 场，${s.shots} 镜，${s.prompts} 条提示词${s.episodeCoverage != null ? `，覆盖 ${s.episodeCoverage} 集` : ''}${s.batchCount != null ? `，${s.batchCount} 批` : ''}`
        alert(msg)
      }
    } catch (e: unknown) {
      const code = getErrorCode(e)
      if (code === 'NARRATOR_SCRIPT_DRAFT_CACHE_MISS' && lastDraft) {
        try {
          const res = await narratorScriptApi.persistDraft(novelId, { draft: lastDraft })
          if (res?.ok) {
            setDraftId(null)
            setLastDraft(null)
            setDraftPreview(null)
            await load()
            alert('保存成功（已使用本地草稿重试）')
          }
        } catch (retryErr) {
          alert((retryErr as Error)?.message || '保存失败')
        }
      } else {
        alert((e as Error)?.message || '保存失败')
      }
    } finally {
      setPersisting(false)
    }
  }

  return (
    <div style={pageStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>
          Episode Script - {novelName || `Novel ${novelId}`}
        </h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => router.push(`/projects/${novelId}/pipeline/episode-compare`)}
            style={{ padding: '6px 12px', cursor: 'pointer' }}
          >
            Compare
          </button>
          <button
            type="button"
            onClick={() => router.push(`/projects/${novelId}/pipeline`)}
            style={{ padding: '6px 12px', cursor: 'pointer' }}
          >
            返回 Pipeline
          </button>
        </div>
      </div>

      <div style={{ marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          disabled={generating}
          onClick={handleOpenGenerateDialog}
          style={{ padding: '8px 16px', cursor: generating ? 'not-allowed' : 'pointer', background: '#1890ff', color: '#fff', border: 'none', borderRadius: 6 }}
        >
          {generating ? '生成中…' : '生成旁白主导脚本初稿'}
        </button>
        {draftId && (
          <button
            type="button"
            disabled={persisting}
            onClick={() => void handlePersist()}
            style={{ padding: '8px 16px', cursor: persisting ? 'not-allowed' : 'pointer', background: '#52c41a', color: '#fff', border: 'none', borderRadius: 6 }}
          >
            {persisting ? '保存中…' : '保存草稿'}
          </button>
        )}
      </div>

      {generateDialogOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', padding: 24, borderRadius: 8, minWidth: 360 }}>
            <h3 style={{ margin: '0 0 16px' }}>生成旁白主导脚本初稿</h3>
            <div style={{ marginBottom: 12 }}>
              <label>每批集数 (batch size)</label>
              <input
                type="number"
                min={1}
                value={generateParams.batchSize}
                onChange={(e) => setGenerateParams((p) => ({ ...p, batchSize: parseInt(e.target.value, 10) || 5 }))}
                style={{ width: '100%', padding: 6, marginTop: 4 }}
              />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label>模型 (可选，不填用后端默认)</label>
              <input
                value={generateParams.modelKey}
                onChange={(e) => setGenerateParams((p) => ({ ...p, modelKey: e.target.value }))}
                placeholder="如 claude-3-5-sonnet-20241022"
                style={{ width: '100%', padding: 6, marginTop: 4 }}
              />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label>起始集 (可选)</label>
              <input
                type="number"
                min={1}
                value={generateParams.startEpisode}
                onChange={(e) => setGenerateParams((p) => ({ ...p, startEpisode: e.target.value }))}
                placeholder="留空从第 1 集"
                style={{ width: '100%', padding: 6, marginTop: 4 }}
              />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label>结束集 (可选)</label>
              <input
                type="number"
                min={1}
                value={generateParams.endEpisode}
                onChange={(e) => setGenerateParams((p) => ({ ...p, endEpisode: e.target.value }))}
                placeholder="留空到全部"
                style={{ width: '100%', padding: 6, marginTop: 4 }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setGenerateDialogOpen(false)} style={{ padding: '6px 12px', cursor: 'pointer' }}>取消</button>
              <button type="button" disabled={generating} onClick={() => void handleGenerate()} style={{ padding: '6px 12px', cursor: 'pointer', background: '#1890ff', color: '#fff', border: 'none', borderRadius: 6 }}>开始生成</button>
            </div>
          </div>
        </div>
      )}
      {draftPreview?.scripts?.length ? (
        <div style={{ marginBottom: 16, padding: 12, background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 8 }}>
          <strong>已生成未保存：</strong> 共 {draftPreview.scripts.length} 集草稿{draftPreview.batchCount != null ? `（${draftPreview.batchCount} 批）` : ''}。请点击「保存草稿」写入脚本版本 / 场景 / 镜头 / 提示词。
        </div>
      ) : null}

      {loading ? (
        <div>加载中…</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #eee', textAlign: 'left' }}>
              <th style={{ padding: 8 }}>集数</th>
              <th style={{ padding: 8 }}>当前启用版本</th>
              <th style={{ padding: 8 }}>场/镜/提示词</th>
              <th style={{ padding: 8 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {episodeNumbers.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ padding: 16, color: '#999' }}>
                  暂无脚本版本，可点击「一键生成旁白主导脚本初稿」生成。
                </td>
              </tr>
            ) : (
              episodeNumbers.map((ep) => {
                const active = activeByEpisode.get(ep)
                const sum = summaryByEpisode.get(ep)
                return (
                  <tr key={ep} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: 8 }}>第 {ep} 集</td>
                    <td style={{ padding: 8 }}>
                      {active ? (
                        <span>
                          v{active.version_no} {active.title} ({active.script_type})
                        </span>
                      ) : (
                        <span style={{ color: '#999' }}>无</span>
                      )}
                    </td>
                    <td style={{ padding: 8 }}>
                      {sum != null ? (
                        <span style={{ fontSize: 13, color: '#666' }}>
                          {sum.scene_count ?? 0} 场 / {sum.shot_count ?? 0} 镜 / {sum.prompt_count ?? 0} 提示词
                        </span>
                      ) : (
                        <span style={{ color: '#999' }}>-</span>
                      )}
                    </td>
                    <td style={{ padding: 8 }}>
                      <button
                        type="button"
                        onClick={() => router.push(`/projects/${novelId}/pipeline/episode-scripts/${ep}`)}
                        style={{ marginRight: 8, padding: '4px 8px', cursor: 'pointer' }}
                      >
                        查看
                      </button>
                      <button
                        type="button"
                        onClick={() => router.push(`/projects/${novelId}/pipeline/episode-scripts/${ep}/scenes`)}
                        style={{ marginRight: 8, padding: '4px 8px', cursor: 'pointer' }}
                      >
                        Scene Board
                      </button>
                      <button
                        type="button"
                        onClick={() => router.push(`/projects/${novelId}/pipeline/episode-scripts/${ep}/shots`)}
                        style={{ padding: '4px 8px', cursor: 'pointer' }}
                      >
                        Shot Board
                      </button>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      )}
    </div>
  )
}
