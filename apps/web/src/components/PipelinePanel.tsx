'use client'

import { useEffect, useState } from 'react'
import { api, PipelineOverviewDto } from '@/lib/api'
import { setCoreApi } from '@/lib/set-core-api'
import { pipelineAiApi } from '@/lib/pipeline-ai-api'
import { pipelineReviewApi } from '@/lib/pipeline-review-api'
import {
  AiModelOptionDto,
  EnhanceSetCoreCurrentFields,
  PipelineExtractReferenceTable,
  SetCoreVersionDto,
  UpsertSetCorePayload,
} from '@/types/pipeline'
import {
  PipelineSecondReviewReferenceTable,
  PipelineSecondReviewTargetTable,
} from '@/types/pipeline-review'
import SkeletonTopicsPanel from './pipeline/SkeletonTopicsPanel'
import AdaptationStrategyToolbar from './pipeline/AdaptationStrategyToolbar'
import SetCoreEditor from './pipeline/SetCoreEditor'
import SetCoreEnhanceDialog from './pipeline/SetCoreEnhanceDialog'
import PipelineExtractDialog from './pipeline/PipelineExtractDialog'
import PipelineSecondReviewDialog from './pipeline/PipelineSecondReviewDialog'

interface PipelinePanelProps {
  novelId: number
  novelName: string
}

type ModuleAction = 'generate' | 'edit' | 'save'

const modules = [
  { key: 'set_core', title: '1 核心设定', mapping: 'set_core' },
  { key: 'set_payoff', title: '2 核心爽点架构', mapping: 'set_payoff_arch / set_payoff_lines' },
  { key: 'set_opponent', title: '3 对手矩阵', mapping: 'set_opponent_matrix / set_opponents' },
  { key: 'set_power_ladder', title: '4 权力升级阶梯', mapping: 'set_power_ladder' },
  { key: 'set_traitor', title: '5 内鬼系统', mapping: 'set_traitor_system / set_traitors / set_traitor_stages' },
  { key: 'set_story_phases', title: '6 故事发展阶段', mapping: 'set_story_phases' },
]

const defaultEnhanceReferenceTables = [
  'drama_source_text',
  'novel_characters',
  'novel_key_nodes',
  'novel_adaptation_strategy',
  'adaptation_modes',
]

const defaultExtractReferenceTables: PipelineExtractReferenceTable[] = [
  'drama_novels',
  'drama_source_text',
  'novel_adaptation_strategy',
  'adaptation_modes',
  'set_core',
]

const defaultSecondReviewTargetTables: PipelineSecondReviewTargetTable[] = [
  'novel_characters',
  'novel_key_nodes',
  'novel_skeleton_topic_items',
  'novel_explosions',
]

const defaultSecondReviewReferenceTables: PipelineSecondReviewReferenceTable[] = [
  'drama_novels',
  'drama_source_text',
  'novel_adaptation_strategy',
  'adaptation_modes',
  'set_core',
]

export default function PipelinePanel({ novelId, novelName }: PipelinePanelProps) {
  const [step1Expanded, setStep1Expanded] = useState(true)
  const [step2Expanded, setStep2Expanded] = useState(true)
  const [step3Expanded, setStep3Expanded] = useState(true)
  const [requireConfirm, setRequireConfirm] = useState(true)
  const [setCoreVersionActionValue, setSetCoreVersionActionValue] = useState('action:new_version')
  const [setCoreVersions, setSetCoreVersions] = useState<SetCoreVersionDto[]>([])
  const [activeSetCoreVersionId, setActiveSetCoreVersionId] = useState<number | null>(null)
  const [setCoreLoadedSnapshot, setSetCoreLoadedSnapshot] = useState('')
  const [expandedEditors, setExpandedEditors] = useState<Record<string, boolean>>({
    set_core: false,
  })

  const [stepChecks, setStepChecks] = useState({
    timeline: false,
    characters: false,
    keyNodes: false,
    explosions: false,
  })

  const [coreSettingText, setCoreSettingText] = useState('')
  const [coreFields, setCoreFields] = useState({
    title: '',
    protagonistName: '',
    protagonistIdentity: '',
    targetStory: '',
    rewriteGoal: '',
    coreConstraint: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [timelines, setTimelines] = useState<Record<string, any>[]>([])
  const [characters, setCharacters] = useState<Record<string, any>[]>([])
  const [keyNodes, setKeyNodes] = useState<Record<string, any>[]>([])
  const [explosions, setExplosions] = useState<Record<string, any>[]>([])
  const [worldview, setWorldview] = useState<PipelineOverviewDto['worldview']>({
    core: [],
    payoffArch: [],
    opponents: [],
    powerLadder: [],
    traitors: [],
    storyPhases: [],
  })
  const [expandedDataLists, setExpandedDataLists] = useState<Record<string, boolean>>({
    set_core: true,
  })
  const [setCoreEnhanceDialogOpen, setSetCoreEnhanceDialogOpen] = useState(false)
  const [enhanceModels, setEnhanceModels] = useState<AiModelOptionDto[]>([])
  const [enhanceLoading, setEnhanceLoading] = useState(false)
  const [enhanceSubmitting, setEnhanceSubmitting] = useState(false)
  const [enhanceReferenceTables, setEnhanceReferenceTables] = useState<string[]>(
    defaultEnhanceReferenceTables
  )
  const [enhancePromptPreview, setEnhancePromptPreview] = useState('')
  const [enhanceAllowPromptEdit, setEnhanceAllowPromptEdit] = useState(false)
  const [enhanceUserInstruction, setEnhanceUserInstruction] = useState('')
  const [enhanceSelectedModelKey, setEnhanceSelectedModelKey] = useState('')
  const [extractDialogOpen, setExtractDialogOpen] = useState(false)
  const [extractModels, setExtractModels] = useState<AiModelOptionDto[]>([])
  const [extractLoading, setExtractLoading] = useState(false)
  const [extractSubmitting, setExtractSubmitting] = useState(false)
  const [extractReferenceTables, setExtractReferenceTables] =
    useState<PipelineExtractReferenceTable[]>(defaultExtractReferenceTables)
  const [extractPromptPreview, setExtractPromptPreview] = useState('')
  const [extractAllowPromptEdit, setExtractAllowPromptEdit] = useState(false)
  const [extractUserInstruction, setExtractUserInstruction] = useState('')
  const [extractSelectedModelKey, setExtractSelectedModelKey] = useState('')
  const [extractFontSize, setExtractFontSize] = useState(14)
  const [extractRefreshKey, setExtractRefreshKey] = useState(0)
  const [secondReviewDialogOpen, setSecondReviewDialogOpen] = useState(false)
  const [secondReviewModels, setSecondReviewModels] = useState<AiModelOptionDto[]>([])
  const [secondReviewLoading, setSecondReviewLoading] = useState(false)
  const [secondReviewSubmitting, setSecondReviewSubmitting] = useState(false)
  const [secondReviewTargetTables, setSecondReviewTargetTables] =
    useState<PipelineSecondReviewTargetTable[]>(defaultSecondReviewTargetTables)
  const [secondReviewReferenceTables, setSecondReviewReferenceTables] =
    useState<PipelineSecondReviewReferenceTable[]>(defaultSecondReviewReferenceTables)
  const [secondReviewPromptPreview, setSecondReviewPromptPreview] = useState('')
  const [secondReviewAllowPromptEdit, setSecondReviewAllowPromptEdit] = useState(false)
  const [secondReviewUserInstruction, setSecondReviewUserInstruction] = useState('')
  const [secondReviewSelectedModelKey, setSecondReviewSelectedModelKey] = useState('')
  const [secondReviewFontSize, setSecondReviewFontSize] = useState(14)

  const loadOverview = async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await api.getPipelineOverview(novelId)
      setTimelines(data.timelines || [])
      setCharacters(data.characters || [])
      setKeyNodes(data.keyNodes || [])
      setExplosions(data.explosions || [])
      setWorldview(
        data.worldview || {
          core: [],
          payoffArch: [],
          opponents: [],
          powerLadder: [],
          traitors: [],
          storyPhases: [],
        }
      )
    } catch (err: any) {
      setError(err?.message || 'Failed to load pipeline overview')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadOverview()
  }, [novelId])

  const handleStepCheck = (key: keyof typeof stepChecks) => {
    setStepChecks((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const handleModuleAction = (module: string, action: ModuleAction) => {
    console.log({ module, action, novelId, novelName })
  }

  const loadExtractModels = async () => {
    const models = await pipelineAiApi.listAiModelOptions()
    setExtractModels(models || [])
    return models || []
  }

  const refreshExtractPromptPreview = async (modelKey?: string) => {
    const resolvedModelKey = modelKey || extractSelectedModelKey
    if (!resolvedModelKey) {
      return
    }

    try {
      setExtractLoading(true)
      const preview = await pipelineAiApi.previewExtractPrompt(novelId, {
        modelKey: resolvedModelKey,
        referenceTables: extractReferenceTables,
        userInstruction: extractUserInstruction || undefined,
        allowPromptEdit: extractAllowPromptEdit,
        promptOverride:
          extractAllowPromptEdit && extractPromptPreview.trim()
            ? extractPromptPreview
            : undefined,
      })
      setExtractPromptPreview(preview.promptPreview || '')
      if (!extractSelectedModelKey && preview.usedModelKey) {
        setExtractSelectedModelKey(preview.usedModelKey)
      }
    } catch (err: any) {
      alert(err?.message || '生成预处理 prompt 预览失败')
    } finally {
      setExtractLoading(false)
    }
  }

  const handleOpenExtractDialog = async () => {
    try {
      setExtractDialogOpen(true)

      let resolvedModelKey = extractSelectedModelKey
      let models = extractModels
      if (!models.length) {
        models = await loadExtractModels()
      }
      if (!resolvedModelKey && models.length) {
        resolvedModelKey = models[0].modelKey
        setExtractSelectedModelKey(resolvedModelKey)
      }

      if (!extractReferenceTables.length) {
        setExtractReferenceTables(defaultExtractReferenceTables)
      }

      if (resolvedModelKey) {
        await refreshExtractPromptPreview(resolvedModelKey)
      }
    } catch (err: any) {
      alert(err?.message || '打开预处理 AI 弹窗失败')
    }
  }

  const handleToggleExtractReferenceTable = (table: PipelineExtractReferenceTable) => {
    setExtractReferenceTables((prev) =>
      prev.includes(table) ? prev.filter((item) => item !== table) : [...prev, table]
    )
  }

  const handleSubmitExtract = async () => {
    if (!extractSelectedModelKey) {
      alert('请选择 AI 模型')
      return
    }

    try {
      setExtractSubmitting(true)
      const result = await pipelineAiApi.extractAndGenerate(novelId, {
        modelKey: extractSelectedModelKey,
        referenceTables: extractReferenceTables,
        userInstruction: extractUserInstruction || undefined,
        allowPromptEdit: extractAllowPromptEdit,
        promptOverride:
          extractAllowPromptEdit && extractPromptPreview.trim()
            ? extractPromptPreview
            : undefined,
      })

      await loadOverview()
      setExtractRefreshKey((prev) => prev + 1)
      setExtractDialogOpen(false)

      const summary = result.summary
      const detailsText = result.details
        ? `\n\n调试信息：\n启用主题数：${result.details.enabledTopicCount}\n启用 topicKeys：${
            result.details.enabledTopicKeys.join(', ') || '(none)'
          }\n标准化后数组：timelines=${result.details.normalizedCounts.timelines}, characters=${result.details.normalizedCounts.characters}, keyNodes=${result.details.normalizedCounts.keyNodes}, skeletonTopicItems=${result.details.normalizedCounts.skeletonTopicItems}, explosions=${result.details.normalizedCounts.explosions}\n骨架主题项：requestedGroups=${result.details.skeletonTopicItemsRequestedGroups}, requestedItems=${result.details.skeletonTopicItemsRequestedItems}, inserted=${result.details.skeletonTopicItemsInserted}, dropped=${result.details.skeletonTopicItemsDropped}`
        : ''
      const warningText = result.warnings?.length
        ? `\n\nwarnings:\n- ${result.warnings.join('\n- ')}`
        : ''

      alert(
        `生成并写入成功\n时间线：${summary.timelines}\n人物：${summary.characters}\n关键节点：${summary.keyNodes}\n骨架主题内容：${summary.skeletonTopicItems}\n爆点：${summary.explosions}${warningText}${detailsText}`
      )
    } catch (err: any) {
      alert(
        err?.message || '生成并写入失败，后端未返回明确错误信息。请检查服务端日志。'
      )
    } finally {
      setExtractSubmitting(false)
    }
  }

  const handlePreStep3Action = () => {
    void handleOpenExtractDialog()
  }

  const loadSecondReviewModels = async () => {
    const models = await pipelineAiApi.listAiModelOptions()
    setSecondReviewModels(models || [])
    return models || []
  }

  const refreshSecondReviewPromptPreview = async (modelKey?: string) => {
    const resolvedModelKey = modelKey || secondReviewSelectedModelKey
    if (!resolvedModelKey) {
      return
    }

    try {
      setSecondReviewLoading(true)
      const preview = await pipelineReviewApi.previewPipelineSecondReviewPrompt(novelId, {
        modelKey: resolvedModelKey,
        targetTables: secondReviewTargetTables,
        referenceTables: secondReviewReferenceTables,
        userInstruction: secondReviewUserInstruction || undefined,
        allowPromptEdit: secondReviewAllowPromptEdit,
        promptOverride:
          secondReviewAllowPromptEdit && secondReviewPromptPreview.trim()
            ? secondReviewPromptPreview
            : undefined,
      })
      setSecondReviewPromptPreview(preview.promptPreview || '')
      if (!secondReviewSelectedModelKey && preview.usedModelKey) {
        setSecondReviewSelectedModelKey(preview.usedModelKey)
      }
    } catch (err: any) {
      alert(err?.message || '生成二次AI自检 prompt 预览失败')
    } finally {
      setSecondReviewLoading(false)
    }
  }

  const handleOpenSecondReviewDialog = async () => {
    try {
      setSecondReviewDialogOpen(true)

      let resolvedModelKey = secondReviewSelectedModelKey
      let models = secondReviewModels
      if (!models.length) {
        models = await loadSecondReviewModels()
      }
      if (!resolvedModelKey && models.length) {
        resolvedModelKey = models[0].modelKey
        setSecondReviewSelectedModelKey(resolvedModelKey)
      }

      if (!secondReviewTargetTables.length) {
        setSecondReviewTargetTables(defaultSecondReviewTargetTables)
      }
      if (!secondReviewReferenceTables.length) {
        setSecondReviewReferenceTables(defaultSecondReviewReferenceTables)
      }

      if (resolvedModelKey) {
        await refreshSecondReviewPromptPreview(resolvedModelKey)
      }
    } catch (err: any) {
      alert(err?.message || '打开二次AI自检弹窗失败')
    }
  }

  const handleToggleSecondReviewTargetTable = (table: PipelineSecondReviewTargetTable) => {
    setSecondReviewTargetTables((prev) =>
      prev.includes(table) ? prev.filter((item) => item !== table) : [...prev, table]
    )
  }

  const handleToggleSecondReviewReferenceTable = (
    table: PipelineSecondReviewReferenceTable
  ) => {
    setSecondReviewReferenceTables((prev) =>
      prev.includes(table) ? prev.filter((item) => item !== table) : [...prev, table]
    )
  }

  const handleSubmitSecondReview = async () => {
    if (!secondReviewSelectedModelKey) {
      alert('请选择 AI 模型')
      return
    }
    if (!secondReviewTargetTables.length) {
      alert('请至少选择一个检测对象表')
      return
    }

    try {
      setSecondReviewSubmitting(true)
      const result = await pipelineReviewApi.runPipelineSecondReview(novelId, {
        modelKey: secondReviewSelectedModelKey,
        targetTables: secondReviewTargetTables,
        referenceTables: secondReviewReferenceTables,
        userInstruction: secondReviewUserInstruction || undefined,
        allowPromptEdit: secondReviewAllowPromptEdit,
        promptOverride:
          secondReviewAllowPromptEdit && secondReviewPromptPreview.trim()
            ? secondReviewPromptPreview
            : undefined,
      })

      await loadOverview()
      setExtractRefreshKey((prev) => prev + 1)
      setSecondReviewDialogOpen(false)

      const reviewNoteText = result.reviewNotes?.length
        ? `\n\nreviewNotes:\n- ${result.reviewNotes
            .map((item) => `${item.table}: ${item.issue} -> ${item.fix}`)
            .join('\n- ')}`
        : ''
      const warningText = result.warnings?.length
        ? `\n\nwarnings:\n- ${result.warnings.join('\n- ')}`
        : ''

      alert(
        `二次AI自检完成\n时间线：${result.summary.timelines}\n人物：${result.summary.characters}\n关键节点：${result.summary.keyNodes}\n骨架主题内容：${result.summary.skeletonTopicItems}\n爆点：${result.summary.explosions}${reviewNoteText}${warningText}`
      )
    } catch (err: any) {
      alert(err?.message || '二次AI自检失败')
    } finally {
      setSecondReviewSubmitting(false)
    }
  }

  const fillSetCoreEditor = (row: {
    title: string | null
    coreText: string | null
    protagonistName: string | null
    protagonistIdentity: string | null
    targetStory: string | null
    rewriteGoal: string | null
    constraintText: string | null
  } | null) => {
    if (!row) {
      const emptyFields = {
        title: '',
        protagonistName: '',
        protagonistIdentity: '',
        targetStory: '',
        rewriteGoal: '',
        coreConstraint: '',
      }
      setCoreSettingText('')
      setCoreFields(emptyFields)
      setSetCoreLoadedSnapshot(JSON.stringify({ coreText: '', ...emptyFields }))
      return
    }

    const nextText = row.coreText || ''
    const nextFields = {
      title: row.title || '',
      protagonistName: row.protagonistName || '',
      protagonistIdentity: row.protagonistIdentity || '',
      targetStory: row.targetStory || '',
      rewriteGoal: row.rewriteGoal || '',
      coreConstraint: row.constraintText || '',
    }

    setCoreSettingText(nextText)
    setCoreFields(nextFields)
    setSetCoreLoadedSnapshot(JSON.stringify({ coreText: nextText, ...nextFields }))
  }

  const loadSetCoreEditorData = async () => {
    const [activeSetCore, versions] = await Promise.all([
      setCoreApi.getActiveSetCore(novelId),
      setCoreApi.listSetCoreVersions(novelId),
    ])

    fillSetCoreEditor(activeSetCore)
    setSetCoreVersions(versions || [])
    const activeIdFromVersions = versions.find((v) => v.isActive === 1)?.id ?? null
    const resolvedActiveId = activeSetCore?.id ?? activeIdFromVersions
    setActiveSetCoreVersionId(resolvedActiveId)
    setSetCoreVersionActionValue(
      resolvedActiveId ? `version:${resolvedActiveId}` : 'action:new_version'
    )
  }

  const hasUnsavedSetCoreChanges = () => {
    const currentSnapshot = JSON.stringify({
      coreText: coreSettingText,
      ...coreFields,
    })
    return currentSnapshot !== setCoreLoadedSnapshot
  }

  const toggleEditor = async (moduleKey: string) => {
    const shouldOpen = !expandedEditors[moduleKey]
    setExpandedEditors((prev) => ({ ...prev, [moduleKey]: shouldOpen }))

    if (moduleKey === 'set_core' && shouldOpen) {
      try {
        await loadSetCoreEditorData()
      } catch (err: any) {
        alert(err?.message || '加载 set_core 失败')
      }
    }
  }

  const handleInsertCharacters = () => {
    console.log({
      action: 'insert_novel_characters',
      novelId,
      novelName,
      protagonistName: coreFields.protagonistName,
      protagonistIdentity: coreFields.protagonistIdentity,
    })
  }

  const getCurrentEnhanceFields = (): EnhanceSetCoreCurrentFields => {
    return {
      title: coreFields.title || undefined,
      protagonistName: coreFields.protagonistName || undefined,
      protagonistIdentity: coreFields.protagonistIdentity || undefined,
      targetStory: coreFields.targetStory || undefined,
      rewriteGoal: coreFields.rewriteGoal || undefined,
      constraintText: coreFields.coreConstraint || undefined,
    }
  }

  const loadEnhanceModels = async () => {
    const models = await setCoreApi.listAiModelCatalogOptions()
    setEnhanceModels(models || [])
    return models || []
  }

  const refreshEnhancePromptPreview = async (modelKey?: string) => {
    const resolvedModelKey = modelKey || enhanceSelectedModelKey
    if (!resolvedModelKey) {
      return
    }

    try {
      setEnhanceLoading(true)
      const preview = await setCoreApi.previewSetCoreEnhancePrompt(novelId, {
        modelKey: resolvedModelKey,
        referenceTables: enhanceReferenceTables,
        currentCoreText: coreSettingText || undefined,
        currentFields: getCurrentEnhanceFields(),
        userInstruction: enhanceUserInstruction || undefined,
      })
      setEnhancePromptPreview(preview.promptPreview || '')
      if (!enhanceSelectedModelKey && preview.usedModelKey) {
        setEnhanceSelectedModelKey(preview.usedModelKey)
      }
    } catch (err: any) {
      alert(err?.message || '生成 prompt 预览失败')
    } finally {
      setEnhanceLoading(false)
    }
  }

  const handleOpenEnhanceDialog = async () => {
    try {
      setSetCoreEnhanceDialogOpen(true)

      let resolvedModelKey = enhanceSelectedModelKey
      let models = enhanceModels
      if (!models.length) {
        models = await loadEnhanceModels()
      }
      if (!resolvedModelKey && models.length) {
        resolvedModelKey = models[0].modelKey
        setEnhanceSelectedModelKey(resolvedModelKey)
      }

      if (!enhanceReferenceTables.length) {
        setEnhanceReferenceTables(defaultEnhanceReferenceTables)
      }

      if (resolvedModelKey) {
        await refreshEnhancePromptPreview(resolvedModelKey)
      }
    } catch (err: any) {
      alert(err?.message || '打开 AI 完善弹窗失败')
    }
  }

  const handleToggleEnhanceReferenceTable = (table: string) => {
    setEnhanceReferenceTables((prev) =>
      prev.includes(table) ? prev.filter((item) => item !== table) : [...prev, table]
    )
  }

  const getSetCoreSaveMode = (): UpsertSetCorePayload['mode'] =>
    setCoreVersionActionValue === 'action:new_version' ? 'new_version' : 'update_active'

  const persistSetCorePayload = async (
    payload: UpsertSetCorePayload,
    buildSuccessMessage: (saved: { version: number }) => string
  ) => {
    const saved = await setCoreApi.upsertSetCore(novelId, payload)
    fillSetCoreEditor(saved)
    await refreshSetCoreStates()
    await loadOverview()
    setExpandedEditors((prev) => ({ ...prev, set_core: true }))
    alert(buildSuccessMessage(saved))
    return saved
  }

  const handleSubmitEnhance = async () => {
    if (!enhanceSelectedModelKey) {
      alert('请选择 AI 模型')
      return
    }

    try {
      setEnhanceSubmitting(true)
      const result = await setCoreApi.enhanceSetCore(novelId, {
        modelKey: enhanceSelectedModelKey,
        referenceTables: enhanceReferenceTables,
        currentCoreText: coreSettingText || undefined,
        currentFields: getCurrentEnhanceFields(),
        userInstruction: enhanceUserInstruction || undefined,
        allowPromptEdit: enhanceAllowPromptEdit,
        promptOverride:
          enhanceAllowPromptEdit && enhancePromptPreview.trim()
            ? enhancePromptPreview
            : undefined,
      })

      const nextPayload: UpsertSetCorePayload = {
        title: result.title || undefined,
        coreText: result.coreText || undefined,
        protagonistName: result.protagonistName || undefined,
        protagonistIdentity: result.protagonistIdentity || undefined,
        targetStory: result.targetStory || undefined,
        rewriteGoal: result.rewriteGoal || undefined,
        constraintText: result.constraintText || undefined,
      }

      setCoreSettingText(nextPayload.coreText || '')
      setCoreFields({
        title: nextPayload.title || '',
        protagonistName: nextPayload.protagonistName || '',
        protagonistIdentity: nextPayload.protagonistIdentity || '',
        targetStory: nextPayload.targetStory || '',
        rewriteGoal: nextPayload.rewriteGoal || '',
        coreConstraint: nextPayload.constraintText || '',
      })
      setEnhancePromptPreview(result.promptPreview || enhancePromptPreview)

      if (requireConfirm) {
        setSetCoreEnhanceDialogOpen(false)
        alert('AI 完善结果已回填，未自动保存，请检查后手动保存')
        return
      }

      setSetCoreEnhanceDialogOpen(false)

      try {
        await persistSetCorePayload(
          {
            ...nextPayload,
            mode: getSetCoreSaveMode(),
          },
          (saved) => `AI 完善结果已自动保存到 set_core（v${saved.version}）`
        )
      } catch (saveErr: any) {
        alert(saveErr?.message || 'AI 结果已回填，但自动保存失败，请检查后手动保存')
      }
    } catch (err: any) {
      alert(err?.message || 'AI 完善失败')
    } finally {
      setEnhanceSubmitting(false)
    }
  }

  const refreshSetCoreStates = async () => {
    const [activeSetCore, versions] = await Promise.all([
      setCoreApi.getActiveSetCore(novelId),
      setCoreApi.listSetCoreVersions(novelId),
    ])

    fillSetCoreEditor(activeSetCore)
    setSetCoreVersions(versions || [])
    const activeIdFromVersions = versions.find((v) => v.isActive === 1)?.id ?? null
    const resolvedActiveId = activeSetCore?.id ?? activeIdFromVersions
    setActiveSetCoreVersionId(resolvedActiveId)
    setSetCoreVersionActionValue(
      resolvedActiveId ? `version:${resolvedActiveId}` : 'action:new_version'
    )
  }

  const handleChangeVersionAction = async (value: string) => {
    if (value === 'action:new_version') {
      setSetCoreVersionActionValue('action:new_version')
      return
    }

    if (!value.startsWith('version:')) {
      return
    }

    const versionId = Number(value.split(':')[1])
    if (!Number.isInteger(versionId) || versionId <= 0) {
      return
    }
    if (versionId === activeSetCoreVersionId) {
      setSetCoreVersionActionValue(`version:${versionId}`)
      return
    }

    if (hasUnsavedSetCoreChanges()) {
      const shouldContinue = confirm('切换版本会覆盖当前编辑内容，是否继续？')
      if (!shouldContinue) {
        setSetCoreVersionActionValue(
          activeSetCoreVersionId ? `version:${activeSetCoreVersionId}` : 'action:new_version'
        )
        return
      }
    }

    try {
      const activated = await setCoreApi.activateSetCoreVersion(versionId)
      fillSetCoreEditor(activated)
      await refreshSetCoreStates()
      await loadOverview()
      alert(`已切换到 v${activated.version}`)
    } catch (err: any) {
      setSetCoreVersionActionValue(
        activeSetCoreVersionId ? `version:${activeSetCoreVersionId}` : 'action:new_version'
      )
      alert(err?.message || '切换 set_core 版本失败')
    }
  }

  const handleDeleteSetCore = async (id: number) => {
    const shouldDelete = confirm('确定删除该版本吗？')
    if (!shouldDelete) {
      return
    }

    try {
      await setCoreApi.deleteSetCore(id)
      await refreshSetCoreStates()
      await loadOverview()
      alert('set_core 版本删除成功')
    } catch (err: any) {
      alert(err?.message || '删除 set_core 版本失败')
    }
  }

  const toggleSetCoreDataList = () => {
    setExpandedDataLists((prev) => ({
      ...prev,
      set_core: !prev.set_core,
    }))
  }

  const handleSetCoreSave = () => {
    const save = async () => {
      try {
        const payload = {
          title: coreFields.title || undefined,
          coreText: coreSettingText || undefined,
          protagonistName: coreFields.protagonistName || undefined,
          protagonistIdentity: coreFields.protagonistIdentity || undefined,
          targetStory: coreFields.targetStory || undefined,
          rewriteGoal: coreFields.rewriteGoal || undefined,
          constraintText: coreFields.coreConstraint || undefined,
          mode: getSetCoreSaveMode(),
        } satisfies UpsertSetCorePayload

        await persistSetCorePayload(payload, (saved) => `set_core 保存成功（v${saved.version}）`)
      } catch (err: any) {
        alert(err?.message || 'set_core 保存失败')
      }
    }

    save()
  }

  const extractTitle = (row: Record<string, any>): string => {
    return (
      row.title ||
      row.name ||
      row.topic_name ||
      row.topicName ||
      row.item_title ||
      row.itemTitle ||
      row.level_title ||
      row.stage_title ||
      row.phase_name ||
      row.line_name ||
      row.opponent_name ||
      row.novels_name ||
      `#${row.id ?? 'N/A'}`
    )
  }

  const extractDescription = (row: Record<string, any>): string => {
    return (
      row.description ||
      row.core_text ||
      row.notes ||
      row.content ||
      row.line_content ||
      row.detailed_desc ||
      row.ability_boundary ||
      row.stage_desc ||
      row.historical_path ||
      row.rewrite_path ||
      row.public_identity ||
      row.real_identity ||
      row.source_ref ||
      ''
    )
  }

  const renderSimpleTable = (rows: Record<string, any>[], emptyText = '暂无数据') => {
    if (!rows.length) {
      return <div style={{ color: '#999', fontSize: '13px' }}>{emptyText}</div>
    }

    return (
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', borderBottom: '1px solid #f0f0f0', padding: '8px' }}>title</th>
            <th style={{ textAlign: 'left', borderBottom: '1px solid #f0f0f0', padding: '8px' }}>description</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={`${row.id ?? 'r'}-${idx}`}>
              <td style={{ borderBottom: '1px solid #f7f7f7', padding: '8px', verticalAlign: 'top' }}>{extractTitle(row)}</td>
              <td style={{ borderBottom: '1px solid #f7f7f7', padding: '8px', color: '#555' }}>
                {extractDescription(row) || '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  const renderSetCoreTable = (rows: Record<string, any>[]) => {
    if (!rows.length) {
      return <div style={{ color: '#999', fontSize: '13px' }}>暂无数据</div>
    }

    return (
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', borderBottom: '1px solid #f0f0f0', padding: '8px' }}>
              title
            </th>
            <th style={{ textAlign: 'left', borderBottom: '1px solid #f0f0f0', padding: '8px' }}>
              description
            </th>
            <th style={{ textAlign: 'left', borderBottom: '1px solid #f0f0f0', padding: '8px', width: '96px' }}>
              action
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={`${row.id ?? 'r'}-${idx}`}>
              <td style={{ borderBottom: '1px solid #f7f7f7', padding: '8px', verticalAlign: 'top' }}>
                {extractTitle(row)}
              </td>
              <td style={{ borderBottom: '1px solid #f7f7f7', padding: '8px', color: '#555' }}>
                {extractDescription(row) || '-'}
              </td>
              <td style={{ borderBottom: '1px solid #f7f7f7', padding: '8px' }}>
                <button
                  onClick={() => void handleDeleteSetCore(Number(row.id))}
                  style={{
                    padding: '4px 10px',
                    border: '1px solid #ff4d4f',
                    color: '#ff4d4f',
                    borderRadius: '4px',
                    background: 'white',
                    cursor: 'pointer',
                  }}
                  disabled={!row.id}
                >
                  删除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  const getModuleRows = (moduleKey: string): Record<string, any>[] => {
    switch (moduleKey) {
      case 'set_core':
        return worldview.core
      case 'set_payoff':
        return worldview.payoffArch
      case 'set_opponent':
        return worldview.opponents
      case 'set_power_ladder':
        return worldview.powerLadder
      case 'set_traitor':
        return worldview.traitors
      case 'set_story_phases':
        return worldview.storyPhases
      default:
        return []
    }
  }

  const enhanceSaveBehaviorDescription = requireConfirm
    ? '当前模式：生成后只回填编辑器，未自动保存到 set_core。'
    : `当前模式：生成后将自动保存到 set_core（${
        getSetCoreSaveMode() === 'new_version' ? '新建版本' : '更新当前激活版本'
      }），并刷新 Step3 数据。`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ fontSize: '20px', fontWeight: 600, color: '#333' }}>
        Pipeline - {novelName} (ID: {novelId})
      </div>
      {loading && <div style={{ color: '#1890ff', fontSize: '14px' }}>Loading pipeline overview...</div>}
      {error && <div style={{ color: '#ff4d4f', fontSize: '14px' }}>Load failed: {error}</div>}

      <div style={{ border: '1px solid #e8e8e8', borderRadius: '8px', overflow: 'hidden' }}>
        <div
          style={{
            background: '#fafafa',
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid #e8e8e8',
          }}
        >
          <div style={{ fontWeight: 600 }}>Step 1 - 抽取历史骨架</div>
          <button
            onClick={() => setStep1Expanded((prev) => !prev)}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#1890ff' }}
          >
            {step1Expanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
        {step1Expanded && (
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label>
              <input type="checkbox" checked={stepChecks.timeline} onChange={() => handleStepCheck('timeline')} />{' '}
              时间线分析 - 保存到 `novel_timelines`
            </label>
            <label>
              <input type="checkbox" checked={stepChecks.characters} onChange={() => handleStepCheck('characters')} />{' '}
              主要人物 - 保存到 `novel_characters`
            </label>
            <label>
              <input type="checkbox" checked={stepChecks.keyNodes} onChange={() => handleStepCheck('keyNodes')} /> 关键历史节点
              - 保存到 `novel_key_nodes`
            </label>
            <div style={{ marginLeft: '20px', marginTop: '4px' }}>
              <div style={{ fontWeight: 600, marginBottom: '6px' }}>骨架分析主题（可配置）</div>
              <SkeletonTopicsPanel novelId={novelId} refreshKey={extractRefreshKey} />
            </div>
            <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
              后端只读查询并展示已存在数据（本阶段不写库）
            </div>
            <div style={{ marginTop: '10px' }}>
              <div style={{ fontWeight: 600, marginBottom: '6px' }}>时间线列表</div>
              {renderSimpleTable(timelines)}
            </div>
            <div style={{ marginTop: '10px' }}>
              <div style={{ fontWeight: 600, marginBottom: '6px' }}>人物列表</div>
              {renderSimpleTable(characters)}
            </div>
            <div style={{ marginTop: '10px' }}>
              <div style={{ fontWeight: 600, marginBottom: '6px' }}>关键节点列表</div>
              {renderSimpleTable(keyNodes)}
            </div>
            <div style={{ marginTop: '10px' }}>
              <div style={{ fontWeight: 600, marginBottom: '6px' }}>骨架主题抽取结果（Topic Items）</div>
              <div style={{ color: '#999', fontSize: '13px' }}>
                请在上方“骨架分析主题（可配置）”中使用 Expand Items 查看各主题下的 items。
              </div>
            </div>
          </div>
        )}
      </div>

      <div style={{ border: '1px solid #e8e8e8', borderRadius: '8px', overflow: 'hidden' }}>
        <div
          style={{
            background: '#fafafa',
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid #e8e8e8',
          }}
        >
          <div style={{ fontWeight: 600 }}>Step 2 - 识别爆点</div>
          <button
            onClick={() => setStep2Expanded((prev) => !prev)}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#1890ff' }}
          >
            {step2Expanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
        {step2Expanded && (
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <label>
              <input type="checkbox" checked={stepChecks.explosions} onChange={() => handleStepCheck('explosions')} /> 识别爆点
              - 保存到 `novel_explosions`
            </label>
            <div>
              <div style={{ fontWeight: 600, marginBottom: '6px' }}>爆点列表</div>
              {renderSimpleTable(explosions)}
            </div>
          </div>
        )}
      </div>

      <div
        style={{
          border: '1px solid #e8e8e8',
          borderRadius: '8px',
          padding: '12px 16px',
          background: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '16px',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ fontWeight: 600, color: '#333' }}>预处理操作</div>
          <div style={{ fontSize: '12px', color: '#666' }}>
            在生成世界观前，先执行历史骨架抽取与爆点生成。
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            onClick={handlePreStep3Action}
            style={{
              padding: '6px 12px',
              border: 'none',
              borderRadius: '4px',
              background: '#1890ff',
              color: '#fff',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            抽取历史骨架和生成爆点
          </button>
          <button
            onClick={() => void handleOpenSecondReviewDialog()}
            style={{
              padding: '6px 12px',
              border: 'none',
              borderRadius: '4px',
              background: '#1890ff',
              color: '#fff',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            二次AI自检
          </button>
        </div>
      </div>

      <div style={{ border: '1px solid #e8e8e8', borderRadius: '8px', overflow: 'hidden' }}>
        <div
          style={{
            background: '#fafafa',
            padding: '12px 16px',
            borderBottom: '1px solid #e8e8e8',
          }}
        >
          <AdaptationStrategyToolbar
            novelId={novelId}
            step3Expanded={step3Expanded}
            onToggle={() => setStep3Expanded((prev) => !prev)}
          />
        </div>
        {step3Expanded && (
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {modules.map((item) => (
              <div key={item.key}>
                <div
                  style={{
                    border: '1px solid #f0f0f0',
                    borderRadius: '6px',
                    padding: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600 }}>{item.title}</div>
                    <div style={{ fontSize: '12px', color: '#666' }}>{item.mapping}</div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {item.key === 'set_core' && (
                      <button
                        onClick={toggleSetCoreDataList}
                        style={{ padding: '6px 12px', border: '1px solid #d9d9d9', background: 'white', borderRadius: '4px', cursor: 'pointer' }}
                      >
                        {expandedDataLists.set_core ? '列表收起' : '列表展开'}
                      </button>
                    )}
                    <button
                      onClick={() => handleModuleAction(item.key, 'generate')}
                      style={{ padding: '6px 12px', border: '1px solid #1890ff', background: 'white', color: '#1890ff', borderRadius: '4px', cursor: 'pointer' }}
                    >
                      生成(或刷新)
                    </button>
                    <button
                      onClick={() => {
                        if (item.key === 'set_core') {
                          void toggleEditor('set_core')
                          handleModuleAction(item.key, 'edit')
                          return
                        }
                        handleModuleAction(item.key, 'edit')
                      }}
                      style={{ padding: '6px 12px', border: '1px solid #d9d9d9', background: 'white', borderRadius: '4px', cursor: 'pointer' }}
                    >
                      {item.key === 'set_core' && expandedEditors.set_core ? '收起' : '编辑'}
                    </button>
                    <button
                      onClick={() => {
                        if (item.key === 'set_core') {
                          handleSetCoreSave()
                          return
                        }
                        handleModuleAction(item.key, 'save')
                      }}
                      style={{ padding: '6px 12px', border: 'none', background: '#1890ff', color: 'white', borderRadius: '4px', cursor: 'pointer' }}
                    >
                      保存
                    </button>
                  </div>
                </div>
                {item.key === 'set_core' && expandedEditors.set_core && (
                  <SetCoreEditor
                    coreSettingText={coreSettingText}
                    setCoreSettingText={setCoreSettingText}
                    coreFields={coreFields}
                    setCoreFields={setCoreFields}
                    versions={setCoreVersions}
                    activeVersionId={activeSetCoreVersionId}
                    versionActionValue={setCoreVersionActionValue}
                    onChangeVersionAction={handleChangeVersionAction}
                    onInsertCharacters={handleInsertCharacters}
                    onOpenEnhanceDialog={() => void handleOpenEnhanceDialog()}
                    onSave={handleSetCoreSave}
                    onCollapse={() => void toggleEditor('set_core')}
                  />
                )}
                {item.key !== 'set_core' && (
                  <div
                    style={{
                      marginTop: '8px',
                      paddingLeft: '12px',
                      borderLeft: '2px solid #f0f0f0',
                    }}
                  >
                    {renderSimpleTable(getModuleRows(item.key))}
                  </div>
                )}
                {item.key === 'set_core' && expandedDataLists.set_core && (
                  <div
                    style={{
                      marginTop: '8px',
                      paddingLeft: '12px',
                      borderLeft: '2px solid #f0f0f0',
                    }}
                  >
                    {renderSetCoreTable(getModuleRows('set_core'))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ border: '1px solid #e8e8e8', borderRadius: '8px', padding: '12px 16px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 500 }}>
          <input type="checkbox" checked={requireConfirm} onChange={() => setRequireConfirm((prev) => !prev)} /> 生成后需要我确认才写入数据库
          （默认勾选 true）
        </label>
        <div style={{ marginTop: '6px', fontSize: '12px', color: '#666' }}>
          勾选：先预览再落库（推荐） | 不勾选：自动落库（高级）
        </div>
      </div>

      <SetCoreEnhanceDialog
        open={setCoreEnhanceDialogOpen}
        models={enhanceModels}
        loading={enhanceLoading}
        submitting={enhanceSubmitting}
        saveBehaviorDescription={enhanceSaveBehaviorDescription}
        selectedModelKey={enhanceSelectedModelKey}
        userInstruction={enhanceUserInstruction}
        referenceTables={enhanceReferenceTables}
        allowPromptEdit={enhanceAllowPromptEdit}
        promptPreview={enhancePromptPreview}
        onClose={() => setSetCoreEnhanceDialogOpen(false)}
        onChangeModelKey={(value) => {
          setEnhanceSelectedModelKey(value)
          if (!enhanceAllowPromptEdit && value) {
            void refreshEnhancePromptPreview(value)
          }
        }}
        onChangeUserInstruction={setEnhanceUserInstruction}
        onToggleReferenceTable={handleToggleEnhanceReferenceTable}
        onChangeAllowPromptEdit={setEnhanceAllowPromptEdit}
        onChangePromptPreview={setEnhancePromptPreview}
        onRefreshPromptPreview={() => void refreshEnhancePromptPreview()}
        onSubmit={() => void handleSubmitEnhance()}
      />

      <PipelineExtractDialog
        open={extractDialogOpen}
        models={extractModels}
        loading={extractLoading}
        submitting={extractSubmitting}
        selectedModelKey={extractSelectedModelKey}
        userInstruction={extractUserInstruction}
        referenceTables={extractReferenceTables}
        allowPromptEdit={extractAllowPromptEdit}
        promptPreview={extractPromptPreview}
        fontSize={extractFontSize}
        onClose={() => setExtractDialogOpen(false)}
        onChangeModelKey={(value) => {
          setExtractSelectedModelKey(value)
          if (!extractAllowPromptEdit && value) {
            void refreshExtractPromptPreview(value)
          }
        }}
        onChangeUserInstruction={setExtractUserInstruction}
        onToggleReferenceTable={handleToggleExtractReferenceTable}
        onChangeAllowPromptEdit={setExtractAllowPromptEdit}
        onChangePromptPreview={setExtractPromptPreview}
        onRefreshPromptPreview={() => void refreshExtractPromptPreview()}
        onChangeFontSize={setExtractFontSize}
        onSubmit={() => void handleSubmitExtract()}
      />

      <PipelineSecondReviewDialog
        open={secondReviewDialogOpen}
        models={secondReviewModels}
        loading={secondReviewLoading}
        submitting={secondReviewSubmitting}
        selectedModelKey={secondReviewSelectedModelKey}
        userInstruction={secondReviewUserInstruction}
        targetTables={secondReviewTargetTables}
        referenceTables={secondReviewReferenceTables}
        allowPromptEdit={secondReviewAllowPromptEdit}
        promptPreview={secondReviewPromptPreview}
        fontSize={secondReviewFontSize}
        onClose={() => setSecondReviewDialogOpen(false)}
        onChangeModelKey={(value) => {
          setSecondReviewSelectedModelKey(value)
          if (!secondReviewAllowPromptEdit && value) {
            void refreshSecondReviewPromptPreview(value)
          }
        }}
        onChangeUserInstruction={setSecondReviewUserInstruction}
        onToggleTargetTable={handleToggleSecondReviewTargetTable}
        onToggleReferenceTable={handleToggleSecondReviewReferenceTable}
        onChangeAllowPromptEdit={setSecondReviewAllowPromptEdit}
        onChangePromptPreview={setSecondReviewPromptPreview}
        onRefreshPromptPreview={() => void refreshSecondReviewPromptPreview()}
        onChangeFontSize={setSecondReviewFontSize}
        onSubmit={() => void handleSubmitSecondReview()}
      />
    </div>
  )
}
