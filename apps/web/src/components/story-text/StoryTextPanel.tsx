'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AiModelOptionDto } from '@/types/pipeline'
import StoryGenerateDialog from './StoryGenerateDialog'
import type {
  EpisodeStoryDraft,
  EpisodeStoryReferenceSummaryItem,
  EpisodeStoryReferenceTable,
  EpisodeStoryBatchInfo,
  StoryCheckReportDto,
} from '@/types/episode-story'
import { pipelineAiApi } from '@/lib/pipeline-ai-api'
import { episodeStoryApi } from '@/lib/episode-story-api'

const DEFAULT_REFERENCE_TABLES: EpisodeStoryReferenceTable[] = [
  'set_core',
  'novel_characters',
  'novel_key_nodes',
  'novel_timelines',
  'set_payoff_arch',
  'set_payoff_lines',
  'set_story_phases',
]

function isSafeTextModel(m: AiModelOptionDto): boolean {
  const key = (m.modelKey || '').toLowerCase()
  const modality = (m.modality || '').toLowerCase()
  if (modality && modality !== 'text') return false
  return (
    key.includes('claude') ||
    key.includes('gpt') ||
    key.includes('deepseek')
  )
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error == null) return fallback
  const e = error as { message?: string; payload?: { message?: string | string[] }; response?: { data?: { message?: string | string[] } } }
  const fromPayload = e.payload?.message ?? e.response?.data?.message
  if (fromPayload != null) {
    return Array.isArray(fromPayload) ? fromPayload.join('; ') : String(fromPayload)
  }
  if (typeof e.message === 'string' && e.message.trim()) return e.message.trim()
  return fallback
}

interface StoryTextPanelProps {
  novelId: number
  novelName?: string
  /** 若传入则用作生成目标集数（如分集数） */
  totalChapters?: number
}

export default function StoryTextPanel({ novelId, novelName, totalChapters }: StoryTextPanelProps) {
  const [storyGenerateDialogOpen, setStoryGenerateDialogOpen] = useState(false)
  const [storyModels, setStoryModels] = useState<AiModelOptionDto[]>([])
  const [storyLoading, setStoryLoading] = useState(false)
  const [storyGenerating, setStoryGenerating] = useState(false)
  const [storyPersisting, setStoryPersisting] = useState(false)
  const [storyChecking, setStoryChecking] = useState(false)
  const [storySelectedModelKey, setStorySelectedModelKey] = useState('')
  const [storyReferenceTables, setStoryReferenceTables] = useState<EpisodeStoryReferenceTable[]>(DEFAULT_REFERENCE_TABLES)
  const [storyUserInstruction, setStoryUserInstruction] = useState('')
  const [storyAllowPromptEdit, setStoryAllowPromptEdit] = useState(false)
  const [storyPromptPreview, setStoryPromptPreview] = useState('')
  const [storySourceTextCharBudget, setStorySourceTextCharBudget] = useState(30000)
  const [storyReferenceSummary, setStoryReferenceSummary] = useState<EpisodeStoryReferenceSummaryItem[]>([])
  const [storyDraft, setStoryDraft] = useState<EpisodeStoryDraft | null>(null)
  const [storyDraftId, setStoryDraftId] = useState<string | undefined>(undefined)
  const [storyWarnings, setStoryWarnings] = useState<string[]>([])
  const [storyGeneratingPhase, setStoryGeneratingPhase] = useState('')
  const [storyTargetEpisodeCount, setStoryTargetEpisodeCount] = useState(() => totalChapters ?? 61)
  const [storyActualEpisodeCount, setStoryActualEpisodeCount] = useState<number | undefined>(undefined)
  const [storyBatchInfo, setStoryBatchInfo] = useState<EpisodeStoryBatchInfo[] | undefined>(undefined)
  const [storyFinalCompletenessOk, setStoryFinalCompletenessOk] = useState<boolean | undefined>(undefined)
  const [storyCheckReport, setStoryCheckReport] = useState<StoryCheckReportDto | null>(null)
  const [storyVersionList, setStoryVersionList] = useState<Array<{ id: number; episode_number: number; title: string; version_no: number }>>([])
  const [storyErrorMessage, setStoryErrorMessage] = useState<string | null>(null)
  const [storySuccessMessage, setStorySuccessMessage] = useState<string | null>(null)
  const phaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadStoryVersions = useCallback(async () => {
    try {
      const list = await episodeStoryApi.listStoryVersions(novelId)
      setStoryVersionList(
        (list || []).map((row: { id: number; episode_number: number; title?: string; version_no?: number }) => ({
          id: row.id,
          episode_number: row.episode_number,
          title: row.title ?? '',
          version_no: row.version_no ?? 1,
        }))
      )
    } catch {
      setStoryVersionList([])
    }
  }, [novelId])

  useEffect(() => {
    loadStoryVersions()
  }, [loadStoryVersions])

  const handleOpenGenerateDialog = useCallback(async () => {
    if (totalChapters != null) setStoryTargetEpisodeCount(totalChapters)
    setStoryGenerateDialogOpen(true)
    setStoryErrorMessage(null)
    setStorySuccessMessage(null)
    setStoryDraft(null)
    setStoryDraftId(undefined)
    setStoryWarnings([])
    setStoryReferenceSummary([])
    setStoryCheckReport(null)
    setStoryBatchInfo(undefined)
    setStoryActualEpisodeCount(undefined)
    setStoryFinalCompletenessOk(undefined)
    let models = storyModels
    if (!models.length) {
      const list = await pipelineAiApi.listAiModelOptions()
      const safe = (list || []).filter(isSafeTextModel)
      setStoryModels(safe)
      models = safe
    }
    if (models.length && !storySelectedModelKey) {
      setStorySelectedModelKey(models[0].modelKey)
    }
    if (!storyReferenceTables.length) {
      setStoryReferenceTables(DEFAULT_REFERENCE_TABLES)
    }
    const modelKey = storySelectedModelKey || models[0]?.modelKey
    if (modelKey) {
      setStoryLoading(true)
      try {
        const preview = await episodeStoryApi.previewPrompt(novelId, {
          modelKey,
          referenceTables: storyReferenceTables.length ? storyReferenceTables : DEFAULT_REFERENCE_TABLES,
          userInstruction: storyUserInstruction || undefined,
          allowPromptEdit: storyAllowPromptEdit,
          promptOverride: storyAllowPromptEdit && storyPromptPreview.trim() ? storyPromptPreview : undefined,
          sourceTextCharBudget: storySourceTextCharBudget,
          targetEpisodeCount: storyTargetEpisodeCount,
        })
        setStoryPromptPreview(preview.promptPreview || '')
        setStoryReferenceSummary(preview.referenceSummary || [])
        if (!storySelectedModelKey && preview.usedModelKey) {
          setStorySelectedModelKey(preview.usedModelKey)
        }
      } catch (err: unknown) {
        const msg = getErrorMessage(err, '刷新预览失败')
        setStoryErrorMessage(`Prompt 预览失败：${msg}`)
        setStoryWarnings([msg])
      } finally {
        setStoryLoading(false)
      }
    }
  }, [
    totalChapters,
    storyModels,
    storySelectedModelKey,
    storyReferenceTables,
    storyUserInstruction,
    storyAllowPromptEdit,
    storyPromptPreview,
    storySourceTextCharBudget,
    storyTargetEpisodeCount,
    novelId,
  ])

  const handleRefreshPromptPreview = useCallback(async () => {
    const modelKey = storySelectedModelKey || storyModels[0]?.modelKey
    if (!modelKey) return
    setStoryLoading(true)
    try {
      const preview = await episodeStoryApi.previewPrompt(novelId, {
        modelKey,
        referenceTables: storyReferenceTables,
        userInstruction: storyUserInstruction || undefined,
        allowPromptEdit: storyAllowPromptEdit,
        promptOverride: storyAllowPromptEdit && storyPromptPreview.trim() ? storyPromptPreview : undefined,
        sourceTextCharBudget: storySourceTextCharBudget,
        targetEpisodeCount: storyTargetEpisodeCount,
      })
      setStoryPromptPreview(preview.promptPreview || '')
      setStoryReferenceSummary(preview.referenceSummary || [])
      setStoryWarnings(preview.warnings || [])
      setStoryErrorMessage(null)
    } catch (err: unknown) {
      const msg = getErrorMessage(err, '刷新预览失败')
      setStoryErrorMessage(`Prompt 预览失败：${msg}`)
      setStoryWarnings([msg])
    } finally {
      setStoryLoading(false)
    }
  }, [
    novelId,
    storySelectedModelKey,
    storyModels,
    storyReferenceTables,
    storyUserInstruction,
    storyAllowPromptEdit,
    storyPromptPreview,
    storySourceTextCharBudget,
    storyTargetEpisodeCount,
  ])

  const handleGenerateDraft = useCallback(async () => {
    const modelKey = storySelectedModelKey || storyModels[0]?.modelKey
    if (!modelKey) {
      alert('请选择 AI 模型')
      return
    }
    const clearPhaseTimer = () => {
      if (phaseTimerRef.current) {
        clearTimeout(phaseTimerRef.current)
        phaseTimerRef.current = null
      }
    }
    const targetEp = storyTargetEpisodeCount || 61
    const batchSize = 5
    const estimatedBatches = Math.ceil(targetEp / batchSize)
    setStoryGeneratingPhase('正在生成全集规划…')
    let batchIndex = 0
    const advance = () => {
      batchIndex += 1
      if (batchIndex <= estimatedBatches) {
        setStoryGeneratingPhase(`正在分批生成（Batch ${batchIndex} / ${estimatedBatches}）…`)
        phaseTimerRef.current = setTimeout(advance, 25000)
      } else {
        setStoryGeneratingPhase('正在合并与校验…')
      }
    }
    phaseTimerRef.current = setTimeout(advance, 15000)

    setStoryGenerating(true)
    try {
      const res = await episodeStoryApi.generateDraft(novelId, {
        modelKey,
        referenceTables: storyReferenceTables,
        userInstruction: storyUserInstruction || undefined,
        allowPromptEdit: storyAllowPromptEdit,
        promptOverride: storyAllowPromptEdit && storyPromptPreview.trim() ? storyPromptPreview : undefined,
        sourceTextCharBudget: storySourceTextCharBudget,
        targetEpisodeCount: storyTargetEpisodeCount,
        batchSize: 5,
      })
      setStoryDraft(res.draft)
      setStoryDraftId(res.draftId)
      setStoryActualEpisodeCount(res.actualEpisodeCount)
      setStoryBatchInfo(res.batchInfo)
      setStoryFinalCompletenessOk(res.finalCompletenessOk)
      setStoryWarnings(res.warnings || [])
      if (res.referenceSummary?.length) {
        setStoryReferenceSummary(res.referenceSummary)
      }
      if (res.promptPreview) {
        setStoryPromptPreview(res.promptPreview)
      }
      setStoryErrorMessage(null)
    } catch (err: unknown) {
      const msg = getErrorMessage(err, '生成草稿失败')
      setStoryErrorMessage(`生成草稿失败：${msg}`)
    } finally {
      clearPhaseTimer()
      setStoryGeneratingPhase('')
      setStoryGenerating(false)
    }
  }, [
    novelId,
    storySelectedModelKey,
    storyModels,
    storyReferenceTables,
    storyUserInstruction,
    storyAllowPromptEdit,
    storyPromptPreview,
    storySourceTextCharBudget,
    storyTargetEpisodeCount,
  ])

  const handlePersistDraft = useCallback(async () => {
    if (!storyDraft?.episodes?.length) {
      alert('请先生成草稿')
      return
    }
    setStoryPersisting(true)
    setStoryErrorMessage(null)
    try {
      const payload = storyDraftId
        ? { draftId: storyDraftId, generationMode: 'ai' as const }
        : { draft: storyDraft, generationMode: 'ai' as const }
      await episodeStoryApi.persistDraft(novelId, payload)
      const count = storyDraft.episodes.length
      setStorySuccessMessage(`已成功写入 ${count} 集故事版本，并刷新列表。`)
      setStoryGenerateDialogOpen(false)
      await loadStoryVersions()
      setStoryDraft(null)
      setStoryDraftId(undefined)
    } catch (err: unknown) {
      const msg = getErrorMessage(err, '写入失败')
      setStoryErrorMessage(
        msg.includes('draftId') || msg.includes('过期') || msg.includes('不存在')
          ? `写入数据库失败：${msg}（可尝试不依赖 draftId，直接使用当前草稿再次点击写入）`
          : `写入数据库失败：${msg}`,
      )
    } finally {
      setStoryPersisting(false)
    }
  }, [novelId, storyDraft, storyDraftId, loadStoryVersions])

  const handleCheck = useCallback(async () => {
    if (!storyDraft?.episodes?.length && !storyDraftId) {
      alert('请先生成草稿或提供 draftId')
      return
    }
    setStoryChecking(true)
    try {
      const modelKey = storySelectedModelKey || storyModels[0]?.modelKey
      const payload = storyDraftId
        ? { draftId: storyDraftId, referenceTables: storyReferenceTables, modelKey }
        : { draft: storyDraft!, referenceTables: storyReferenceTables, modelKey }
      const report = await episodeStoryApi.check(novelId, payload)
      setStoryCheckReport(report)
      setStoryErrorMessage(null)
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'AI 检查失败')
      setStoryErrorMessage(`AI 检查失败：${msg}`)
    } finally {
      setStoryChecking(false)
    }
  }, [novelId, storyDraft, storyDraftId, storyReferenceTables, storySelectedModelKey, storyModels])

  const handleToggleReferenceTable = useCallback((table: EpisodeStoryReferenceTable) => {
    setStoryReferenceTables((prev) =>
      prev.includes(table) ? prev.filter((t) => t !== table) : [...prev, table]
    )
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {storySuccessMessage && (
        <div
          style={{
            padding: '10px 14px',
            background: '#f6ffed',
            border: '1px solid #b7eb8f',
            borderRadius: 6,
            color: '#52c41a',
            fontSize: 13,
          }}
        >
          {storySuccessMessage}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => void handleOpenGenerateDialog()}
          style={{
            padding: '10px 20px',
            background: '#1890ff',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          生成完整故事
        </button>
      </div>

      {storyVersionList.length > 0 && (
        <div style={{ border: '1px solid #f0f0f0', borderRadius: 6, padding: 10 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>已保存故事版本</div>
          <div style={{ fontSize: 12, color: '#666' }}>
            共 {storyVersionList.length} 条（按集数/版本）
          </div>
          <ul style={{ marginTop: 8, paddingLeft: 20, maxHeight: 200, overflowY: 'auto' }}>
            {storyVersionList.slice(0, 30).map((row) => (
              <li key={row.id}>
                第{row.episode_number}集 v{row.version_no}：{row.title || '(无标题)'}
              </li>
            ))}
            {storyVersionList.length > 30 && (
              <li style={{ color: '#999' }}>…共 {storyVersionList.length} 条</li>
            )}
          </ul>
        </div>
      )}

      <StoryGenerateDialog
        open={storyGenerateDialogOpen}
        onClose={() => setStoryGenerateDialogOpen(false)}
        novelId={novelId}
        models={storyModels}
        loading={storyLoading}
        generating={storyGenerating}
        persisting={storyPersisting}
        checking={storyChecking}
        selectedModelKey={storySelectedModelKey}
        referenceTables={storyReferenceTables}
        userInstruction={storyUserInstruction}
        allowPromptEdit={storyAllowPromptEdit}
        promptPreview={storyPromptPreview}
        sourceTextCharBudget={storySourceTextCharBudget}
        referenceSummary={storyReferenceSummary}
        draft={storyDraft}
        draftId={storyDraftId}
        warnings={storyWarnings}
        generatingPhase={storyGeneratingPhase}
        targetEpisodeCount={storyTargetEpisodeCount}
        actualEpisodeCount={storyActualEpisodeCount}
        batchInfo={storyBatchInfo}
        finalCompletenessOk={storyFinalCompletenessOk}
        checkReport={storyCheckReport}
        onSelectModelKey={setStorySelectedModelKey}
        onToggleReferenceTable={handleToggleReferenceTable}
        onUserInstructionChange={setStoryUserInstruction}
        onAllowPromptEditChange={setStoryAllowPromptEdit}
        onPromptPreviewChange={setStoryPromptPreview}
        onSourceTextCharBudgetChange={setStorySourceTextCharBudget}
        onRefreshPromptPreview={handleRefreshPromptPreview}
        onGenerateDraft={handleGenerateDraft}
        onCheck={handleCheck}
        onPersistDraft={handlePersistDraft}
        errorMessage={storyErrorMessage}
        successMessage={storySuccessMessage}
      />
    </div>
  )
}
