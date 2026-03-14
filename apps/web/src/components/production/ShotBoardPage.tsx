'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  episodeScriptVersionApi,
  episodeSceneApi,
  episodeShotApi,
  episodeShotPromptApi,
} from '@/lib/episode-script-api'
import type {
  EpisodeScriptVersion,
  EpisodeScene,
  EpisodeShot,
  EpisodeShotPrompt,
} from '@/types/episode-script'

const pageStyle: React.CSSProperties = {
  padding: 24,
  maxWidth: 1000,
  margin: '0 auto',
}

export default function ShotBoardPage({
  novelId,
  episodeNumber,
}: {
  novelId: number
  episodeNumber: number
}) {
  const router = useRouter()
  const [activeVersion, setActiveVersion] = useState<EpisodeScriptVersion | null>(null)
  const [scenes, setScenes] = useState<EpisodeScene[]>([])
  const [shotsByScene, setShotsByScene] = useState<Record<number, EpisodeShot[]>>({})
  const [promptsByShot, setPromptsByShot] = useState<Record<number, EpisodeShotPrompt[]>>({})
  const [loading, setLoading] = useState(true)
  const [editingShot, setEditingShot] = useState<EpisodeShot | null>(null)
  const [saving, setSaving] = useState(false)
  const [promptsOpenShotId, setPromptsOpenShotId] = useState<number | null>(null)
  const [editingPrompt, setEditingPrompt] = useState<EpisodeShotPrompt | null>(null)
  const [addingPromptShotId, setAddingPromptShotId] = useState<number | null>(null)
  const [newPromptForm, setNewPromptForm] = useState({ promptType: 'video_cn', promptText: '', negativePrompt: '', modelName: '', stylePreset: '' })
  const [savingPrompt, setSavingPrompt] = useState(false)

  const load = async () => {
    try {
      setLoading(true)
      const list = await episodeScriptVersionApi.getByEpisode(novelId, episodeNumber)
      const active = (list || []).find((v) => v.is_active === 1) ?? null
      setActiveVersion(active)
      if (!active) {
        setScenes([])
        setShotsByScene({})
        setPromptsByShot({})
        return
      }
      const sceneList = await episodeSceneApi.listByScriptVersion(active.id)
      setScenes(sceneList || [])
      const shots: Record<number, EpisodeShot[]> = {}
      const prompts: Record<number, EpisodeShotPrompt[]> = {}
      for (const scene of sceneList || []) {
        const shotList = await episodeShotApi.listByScene(scene.id)
        shots[scene.id] = shotList || []
        for (const shot of shotList || []) {
          const promptList = await episodeShotPromptApi.listByShot(shot.id)
          prompts[shot.id] = promptList || []
        }
      }
      setShotsByScene(shots)
      setPromptsByShot(prompts)
    } catch {
      setScenes([])
      setShotsByScene({})
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [novelId, episodeNumber])

  const handleSaveShot = async () => {
    if (!editingShot) return
    try {
      setSaving(true)
      await episodeShotApi.update(editingShot.id, {
        visual_desc: editingShot.visual_desc,
        narrator_text: editingShot.narrator_text ?? '',
        dialogue_text: editingShot.dialogue_text ?? '',
        subtitle_text: editingShot.subtitle_text ?? '',
        duration_sec: editingShot.duration_sec,
        camera_movement: editingShot.camera_movement ?? '',
        emotion_tag: editingShot.emotion_tag ?? '',
      })
      setEditingShot(null)
      await load()
    } catch (e: unknown) {
      alert((e as Error)?.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleAddShot = async (sceneId: number) => {
    const list = shotsByScene[sceneId] || []
    const nextNo = list.length + 1
    try {
      await episodeShotApi.create(sceneId, {
        shotNo: nextNo,
        visualDesc: '画面说明',
        sortOrder: nextNo,
      })
      await load()
    } catch (e: unknown) {
      alert((e as Error)?.message || '新增失败')
    }
  }

  const handleDeleteShot = async (id: number) => {
    if (!confirm('确定删除该镜头？')) return
    try {
      await episodeShotApi.remove(id)
      setEditingShot(null)
      setPromptsOpenShotId(null)
      setEditingPrompt(null)
      setAddingPromptShotId(null)
      await load()
    } catch (e: unknown) {
      alert((e as Error)?.message || '删除失败')
    }
  }

  const handleSavePrompt = async () => {
    if (!editingPrompt) return
    try {
      setSavingPrompt(true)
      await episodeShotPromptApi.update(editingPrompt.id, {
        promptType: editingPrompt.prompt_type,
        promptText: editingPrompt.prompt_text,
        negativePrompt: editingPrompt.negative_prompt ?? undefined,
        modelName: editingPrompt.model_name ?? undefined,
        stylePreset: editingPrompt.style_preset ?? undefined,
      })
      setEditingPrompt(null)
      await load()
    } catch (e: unknown) {
      alert((e as Error)?.message || '保存提示词失败')
    } finally {
      setSavingPrompt(false)
    }
  }

  const handleAddPrompt = async () => {
    if (addingPromptShotId == null || !newPromptForm.promptText.trim()) {
      alert('请填写提示词内容')
      return
    }
    try {
      setSavingPrompt(true)
      await episodeShotPromptApi.create(addingPromptShotId, {
        promptType: newPromptForm.promptType,
        promptText: newPromptForm.promptText.trim(),
        negativePrompt: newPromptForm.negativePrompt.trim() || undefined,
        modelName: newPromptForm.modelName.trim() || undefined,
        stylePreset: newPromptForm.stylePreset.trim() || undefined,
      })
      setAddingPromptShotId(null)
      setNewPromptForm({ promptType: 'video_cn', promptText: '', negativePrompt: '', modelName: '', stylePreset: '' })
      await load()
    } catch (e: unknown) {
      alert((e as Error)?.message || '新增提示词失败')
    } finally {
      setSavingPrompt(false)
    }
  }

  const handleDeletePrompt = async (id: number) => {
    if (!confirm('确定删除该提示词？')) return
    try {
      await episodeShotPromptApi.remove(id)
      setEditingPrompt(null)
      await load()
    } catch (e: unknown) {
      alert((e as Error)?.message || '删除失败')
    }
  }

  return (
    <div style={pageStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>第 {episodeNumber} 集 - Shot Board</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => router.push(`/projects/${novelId}/pipeline/episode-scripts/${episodeNumber}`)} style={{ padding: '6px 12px', cursor: 'pointer' }}>返回 Script</button>
          <button type="button" onClick={() => router.push(`/projects/${novelId}/pipeline/episode-scripts/${episodeNumber}/scenes`)} style={{ padding: '6px 12px', cursor: 'pointer' }}>Scene Board</button>
        </div>
      </div>
      {loading ? (
        <div>加载中…</div>
      ) : !activeVersion ? (
        <p style={{ color: '#999' }}>该集暂无启用的脚本版本。</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {scenes.map((scene) => {
            const shots = shotsByScene[scene.id] || []
            return (
              <div key={scene.id} style={{ border: '1px solid #eee', borderRadius: 8, padding: 16 }}>
                <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>
                  {scene.scene_no}. {scene.scene_title}
                </h3>
                <div style={{ marginBottom: 8 }}>
                  <button type="button" onClick={() => handleAddShot(scene.id)} style={{ padding: '4px 8px', cursor: 'pointer' }}>+ 新增镜头</button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {shots.map((shot) =>
                    editingShot?.id === shot.id ? (
                      <div key={shot.id} style={{ border: '1px solid #1890ff', borderRadius: 6, padding: 12, background: '#fafafa' }}>
                        <div style={{ marginBottom: 8 }}>
                          <label>画面说明</label>
                          <textarea value={editingShot.visual_desc} onChange={(e) => setEditingShot({ ...editingShot, visual_desc: e.target.value })} rows={3} style={{ width: '100%', padding: 6, marginTop: 4 }} />
                        </div>
                        <div style={{ marginBottom: 8 }}>
                          <label>旁白</label>
                          <textarea value={editingShot.narrator_text ?? ''} onChange={(e) => setEditingShot({ ...editingShot, narrator_text: e.target.value || null })} rows={2} style={{ width: '100%', padding: 6, marginTop: 4 }} />
                        </div>
                        <div style={{ marginBottom: 8 }}>
                          <label>对白</label>
                          <input value={editingShot.dialogue_text ?? ''} onChange={(e) => setEditingShot({ ...editingShot, dialogue_text: e.target.value || null })} style={{ width: '100%', padding: 6, marginTop: 4 }} />
                        </div>
                        <div style={{ marginBottom: 8 }}>
                          <label>时长(秒)</label>
                          <input type="number" value={editingShot.duration_sec} onChange={(e) => setEditingShot({ ...editingShot, duration_sec: Number(e.target.value) || 0 })} style={{ width: 80, padding: 6, marginTop: 4 }} />
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button type="button" disabled={saving} onClick={() => void handleSaveShot()} style={{ padding: '6px 12px', cursor: 'pointer' }}>{saving ? '保存中…' : '保存'}</button>
                          <button type="button" onClick={() => setEditingShot(null)} style={{ padding: '6px 12px', cursor: 'pointer' }}>取消</button>
                        </div>
                      </div>
                    ) : (
                      <div key={shot.id} style={{ border: '1px solid #eee', borderRadius: 6, padding: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div style={{ flex: 1 }}>
                            <strong>镜头 {shot.shot_no}</strong>
                            {shot.shot_type && <span style={{ marginLeft: 8, color: '#666' }}>{shot.shot_type}</span>}
                            <p style={{ margin: '6px 0 0', fontSize: 13, color: '#666' }}>{shot.visual_desc?.slice(0, 150)}{(shot.visual_desc?.length ?? 0) > 150 ? '…' : ''}</p>
                            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#999' }}>旁白/字幕: {(shot.narrator_text || shot.subtitle_text || '-').toString().slice(0, 60)}… · 时长 {shot.duration_sec}s</p>
                            <p style={{ margin: '4px 0 0', fontSize: 11 }}>
                              <button
                                type="button"
                                onClick={() => setPromptsOpenShotId(promptsOpenShotId === shot.id ? null : shot.id)}
                                style={{ padding: '2px 6px', cursor: 'pointer', fontSize: 12 }}
                              >
                                {(promptsByShot[shot.id] || []).length > 0
                                  ? `提示词 (${(promptsByShot[shot.id] || []).length}) ▼`
                                  : '提示词 (0) ▼'}
                              </button>
                            </p>
                            {promptsOpenShotId === shot.id && (() => {
                              const shotPrompts = promptsByShot[shot.id] || []
                              const hasVideoCn = shotPrompts.some((p) => p.prompt_type === 'video_cn')
                              const hasVideoEn = shotPrompts.some((p) => p.prompt_type === 'video_en')
                              const defaultPromptText = shot.visual_desc?.trim() || '画面描述（请根据镜头画面说明填写）'
                              return (
                              <div style={{ marginTop: 8, padding: 8, background: '#f9f9f9', borderRadius: 4, border: '1px solid #eee' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                                  <strong style={{ fontSize: 13 }}>提示词列表</strong>
                                  <button type="button" onClick={() => { setAddingPromptShotId(shot.id); setNewPromptForm({ promptType: 'video_cn', promptText: '', negativePrompt: '', modelName: '', stylePreset: '' }); }} style={{ padding: '2px 8px', cursor: 'pointer', fontSize: 12 }}>+ 新增</button>
                                </div>
                                <div style={{ marginBottom: 8, fontSize: 12, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                                  <span><strong>video_cn</strong>: {hasVideoCn ? '✓ 已有' : <><span style={{ color: '#999' }}>缺</span> <button type="button" onClick={() => { setAddingPromptShotId(shot.id); setNewPromptForm({ promptType: 'video_cn', promptText: defaultPromptText, negativePrompt: '', modelName: '', stylePreset: '' }); }} style={{ padding: '2px 6px', cursor: 'pointer', marginLeft: 4 }}>快速补齐</button></>}</span>
                                  <span><strong>video_en</strong>: {hasVideoEn ? '✓ 已有' : <><span style={{ color: '#999' }}>缺</span> <button type="button" onClick={() => { setAddingPromptShotId(shot.id); setNewPromptForm({ promptType: 'video_en', promptText: defaultPromptText, negativePrompt: '', modelName: '', stylePreset: '' }); }} style={{ padding: '2px 6px', cursor: 'pointer', marginLeft: 4 }}>快速补齐</button></>}</span>
                                </div>
                                {addingPromptShotId === shot.id && (
                                  <div style={{ marginBottom: 8, padding: 8, background: '#fff', border: '1px solid #ddd', borderRadius: 4 }}>
                                    <input placeholder="类型 video_cn / video_en / image_cn" value={newPromptForm.promptType} onChange={(e) => setNewPromptForm((f) => ({ ...f, promptType: e.target.value }))} style={{ width: '100%', padding: 4, marginBottom: 4 }} />
                                    <textarea placeholder="提示词正文" value={newPromptForm.promptText} onChange={(e) => setNewPromptForm((f) => ({ ...f, promptText: e.target.value }))} rows={2} style={{ width: '100%', padding: 4, marginBottom: 4 }} />
                                    <input placeholder="负向提示词" value={newPromptForm.negativePrompt} onChange={(e) => setNewPromptForm((f) => ({ ...f, negativePrompt: e.target.value }))} style={{ width: '100%', padding: 4, marginBottom: 4 }} />
                                    <input placeholder="模型名" value={newPromptForm.modelName} onChange={(e) => setNewPromptForm((f) => ({ ...f, modelName: e.target.value }))} style={{ width: '100%', padding: 4, marginBottom: 4 }} />
                                    <input placeholder="风格预设" value={newPromptForm.stylePreset} onChange={(e) => setNewPromptForm((f) => ({ ...f, stylePreset: e.target.value }))} style={{ width: '100%', padding: 4, marginBottom: 4 }} />
                                    <div style={{ display: 'flex', gap: 8 }}>
                                      <button type="button" disabled={savingPrompt} onClick={() => void handleAddPrompt()} style={{ padding: '4px 8px', cursor: 'pointer' }}>{savingPrompt ? '保存中…' : '保存'}</button>
                                      <button type="button" onClick={() => { setAddingPromptShotId(null); setNewPromptForm({ promptType: 'video_cn', promptText: '', negativePrompt: '', modelName: '', stylePreset: '' }); }} style={{ padding: '4px 8px', cursor: 'pointer' }}>取消</button>
                                    </div>
                                  </div>
                                )}
                                {(promptsByShot[shot.id] || []).map((p) =>
                                  editingPrompt?.id === p.id ? (
                                    <div key={p.id} style={{ marginBottom: 8, padding: 8, background: '#fff', border: '1px solid #1890ff', borderRadius: 4 }}>
                                      <input value={editingPrompt.prompt_type} onChange={(e) => setEditingPrompt({ ...editingPrompt, prompt_type: e.target.value })} style={{ width: '100%', padding: 4, marginBottom: 4 }} />
                                      <textarea value={editingPrompt.prompt_text} onChange={(e) => setEditingPrompt({ ...editingPrompt, prompt_text: e.target.value })} rows={2} style={{ width: '100%', padding: 4, marginBottom: 4 }} />
                                      <input value={editingPrompt.negative_prompt ?? ''} onChange={(e) => setEditingPrompt({ ...editingPrompt, negative_prompt: e.target.value || null })} placeholder="负向提示词" style={{ width: '100%', padding: 4, marginBottom: 4 }} />
                                      <input value={editingPrompt.model_name ?? ''} onChange={(e) => setEditingPrompt({ ...editingPrompt, model_name: e.target.value || null })} placeholder="模型名" style={{ width: '100%', padding: 4, marginBottom: 4 }} />
                                      <input value={editingPrompt.style_preset ?? ''} onChange={(e) => setEditingPrompt({ ...editingPrompt, style_preset: e.target.value || null })} placeholder="风格预设" style={{ width: '100%', padding: 4, marginBottom: 4 }} />
                                      <div style={{ display: 'flex', gap: 8 }}>
                                        <button type="button" disabled={savingPrompt} onClick={() => void handleSavePrompt()} style={{ padding: '4px 8px', cursor: 'pointer' }}>{savingPrompt ? '保存中…' : '保存'}</button>
                                        <button type="button" onClick={() => setEditingPrompt(null)} style={{ padding: '4px 8px', cursor: 'pointer' }}>取消</button>
                                      </div>
                                    </div>
                                  ) : (
                                    <div key={p.id} style={{ marginBottom: 6, padding: 6, background: '#fff', border: '1px solid #eee', borderRadius: 4, fontSize: 12 }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                        <div>
                                          <span style={{ fontWeight: 600 }}>{p.prompt_type}</span>
                                          {p.model_name && <span style={{ marginLeft: 8, color: '#666' }}>{p.model_name}</span>}
                                          <p style={{ margin: '4px 0 0', color: '#555', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{p.prompt_text?.slice(0, 200)}{(p.prompt_text?.length ?? 0) > 200 ? '…' : ''}</p>
                                        </div>
                                        <div style={{ display: 'flex', gap: 4 }}>
                                          <button type="button" onClick={() => setEditingPrompt(p)} style={{ padding: '2px 6px', cursor: 'pointer' }}>编辑</button>
                                          <button type="button" onClick={() => void handleDeletePrompt(p.id)} style={{ padding: '2px 6px', cursor: 'pointer', color: '#ff4d4f' }}>删除</button>
                                        </div>
                                      </div>
                                    </div>
                                  )
                                )}
                              </div>
                            );
                            })()}
                          </div>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button type="button" onClick={() => setEditingShot(shot)} style={{ padding: '4px 8px', cursor: 'pointer' }}>编辑镜头</button>
                            <button type="button" onClick={() => void handleDeleteShot(shot.id)} style={{ padding: '4px 8px', cursor: 'pointer', color: '#ff4d4f' }}>删除</button>
                          </div>
                        </div>
                      </div>
                    )
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
