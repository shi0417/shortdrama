'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, PipelineOverviewDto } from '@/lib/api'
import { setCoreApi } from '@/lib/set-core-api'
import { pipelineAiApi } from '@/lib/pipeline-ai-api'
import { pipelineReviewApi } from '@/lib/pipeline-review-api'
import { pipelineWorldviewApi } from '@/lib/pipeline-worldview-api'
import { pipelineEpisodeScriptApi } from '@/lib/pipeline-episode-script-api'
import {
  AiModelOptionDto,
  EnhanceSetCoreCurrentFields,
  PipelineEpisodeDurationMode,
  PipelineEpisodeGenerationMode,
  PipelineEpisodeScriptBatchInfo,
  PipelineEpisodeScriptDraft,
  PipelineEpisodeScriptReferenceSummaryItem,
  PipelineEpisodeScriptReferenceTable,
  PipelineEpisodeScriptRepairSummary,
  PipelineExtractReferenceTable,
  PipelineWorldviewDraft,
  PipelineWorldviewAlignmentSummary,
  PipelineWorldviewAlignmentWarning,
  PipelineWorldviewEvidenceSummary,
  PipelineWorldviewInferenceSummary,
  PipelineWorldviewRepairSummary,
  PipelineWorldviewQualitySummary,
  PipelineWorldviewQualityWarning,
  PipelineWorldviewReferenceSummaryItem,
  PipelineWorldviewReferenceTable,
  PipelineWorldviewValidationReport,
  PipelineWorldviewClosureStatus,
  SetCoreVersionDto,
  UpsertSetCorePayload,
} from '@/types/pipeline'
import { PipelineResourceName } from '@/types/pipeline-resource'
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
import PipelineWorldviewDialog from './pipeline/PipelineWorldviewDialog'
import PipelineEpisodeScriptDialog from './pipeline/PipelineEpisodeScriptDialog'
import PipelineDataSection from './pipeline/PipelineDataSection'

interface PipelinePanelProps {
  novelId: number
  novelName: string
  totalChapters?: number
}

type ModuleAction = 'generate' | 'edit' | 'save'

type Step3ModuleConfig = {
  key:
    | 'set_core'
    | 'set_payoff'
    | 'set_opponent'
    | 'set_power_ladder'
    | 'set_traitor'
    | 'set_story_phases'
  title: string
  mapping: string
  primaryResource?: PipelineResourceName
  resources?: PipelineResourceName[]
}

const modules: Step3ModuleConfig[] = [
  { key: 'set_core', title: '1 核心设定', mapping: 'set_core' },
  {
    key: 'set_payoff',
    title: '2 核心爽点架构',
    mapping: 'payoff-arch / payoff-lines',
    primaryResource: 'payoff-arch',
    resources: ['payoff-arch', 'payoff-lines'],
  },
  {
    key: 'set_opponent',
    title: '3 对手矩阵',
    mapping: 'opponent-matrix / opponents',
    primaryResource: 'opponent-matrix',
    resources: ['opponent-matrix', 'opponents'],
  },
  {
    key: 'set_power_ladder',
    title: '4 权力升级阶梯',
    mapping: 'power-ladder',
    primaryResource: 'power-ladder',
    resources: ['power-ladder'],
  },
  {
    key: 'set_traitor',
    title: '5 内鬼系统',
    mapping: 'traitor-system / traitors / traitor-stages',
    primaryResource: 'traitor-system',
    resources: ['traitor-system', 'traitors', 'traitor-stages'],
  },
  {
    key: 'set_story_phases',
    title: '6 故事发展阶段',
    mapping: 'story-phases',
    primaryResource: 'story-phases',
    resources: ['story-phases'],
  },
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

const defaultWorldviewReferenceTables: PipelineWorldviewReferenceTable[] = [
  'drama_novels',
  'novel_adaptation_strategy',
  'adaptation_modes',
  'set_core',
  'novel_timelines',
  'novel_characters',
  'novel_key_nodes',
  'novel_skeleton_topics',
  'novel_skeleton_topic_items',
  'novel_explosions',
]

const defaultEpisodeScriptReferenceTables: PipelineEpisodeScriptReferenceTable[] = [
  'drama_novels',
  'novel_source_segments',
  'novel_adaptation_strategy',
  'adaptation_modes',
  'set_core',
  'novel_timelines',
  'novel_characters',
  'novel_key_nodes',
  'novel_explosions',
  'novel_skeleton_topics',
  'novel_skeleton_topic_items',
]

const worldviewDefaultModelCandidates = [
  'claude-3-7-sonnet-20250219',
  'claude-3-5-sonnet-20241022',
  'claude-3-5-sonnet-20240620',
  'chatgpt-4o-latest',
]

function isSafeWorldviewModel(model: AiModelOptionDto): boolean {
  const key = (model.modelKey || '').toLowerCase()
  const provider = (model.provider || '').toLowerCase()
  const family = (model.family || '').toLowerCase()
  const modality = (model.modality || '').toLowerCase()

  if (key.includes('imagine') || key.includes('midjourney')) return false
  if (provider.includes('midjourney')) return false
  if (modality && modality !== 'text') return false

  return (
    key.includes('claude') ||
    key.includes('gpt') ||
    key.includes('deepseek') ||
    family.includes('claude') ||
    family.includes('gpt') ||
    family.includes('deepseek')
  )
}

export default function PipelinePanel({ novelId, novelName, totalChapters }: PipelinePanelProps) {
  const router = useRouter()
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
  const [skeletonTopics, setSkeletonTopics] = useState<PipelineOverviewDto['skeletonTopics']>([])
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
  const [expandedStep3Modules, setExpandedStep3Modules] = useState<Record<string, boolean>>(
    () =>
      Object.fromEntries(
        modules.map((item) => [item.key, true])
      ) as Record<string, boolean>
  )
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
  const [worldviewDialogOpen, setWorldviewDialogOpen] = useState(false)
  const [worldviewModels, setWorldviewModels] = useState<AiModelOptionDto[]>([])
  const [worldviewLoading, setWorldviewLoading] = useState(false)
  const [worldviewGenerating, setWorldviewGenerating] = useState(false)
  const [worldviewPersisting, setWorldviewPersisting] = useState(false)
  const [worldviewSelectedModelKey, setWorldviewSelectedModelKey] = useState('')
  const [worldviewReferenceTables, setWorldviewReferenceTables] =
    useState<PipelineWorldviewReferenceTable[]>(defaultWorldviewReferenceTables)
  const [worldviewUserInstruction, setWorldviewUserInstruction] = useState('')
  const [worldviewAllowPromptEdit, setWorldviewAllowPromptEdit] = useState(false)
  const [worldviewPromptPreview, setWorldviewPromptPreview] = useState('')
  const [worldviewFontSize, setWorldviewFontSize] = useState(14)
  const [worldviewSourceTextCharBudget, setWorldviewSourceTextCharBudget] = useState(20000)
  const [worldviewReferenceSummary, setWorldviewReferenceSummary] = useState<
    PipelineWorldviewReferenceSummaryItem[]
  >([])
  const [worldviewEvidenceSummary, setWorldviewEvidenceSummary] =
    useState<PipelineWorldviewEvidenceSummary | null>(null)
  const [worldviewInferenceSummary, setWorldviewInferenceSummary] =
    useState<PipelineWorldviewInferenceSummary | null>(null)
  const [worldviewQualitySummary, setWorldviewQualitySummary] =
    useState<PipelineWorldviewQualitySummary | null>(null)
  const [worldviewQualityWarnings, setWorldviewQualityWarnings] = useState<
    PipelineWorldviewQualityWarning[]
  >([])
  const [worldviewAlignmentSummary, setWorldviewAlignmentSummary] =
    useState<PipelineWorldviewAlignmentSummary | null>(null)
  const [worldviewAlignmentWarnings, setWorldviewAlignmentWarnings] = useState<
    PipelineWorldviewAlignmentWarning[]
  >([])
  const [worldviewDraft, setWorldviewDraft] = useState<PipelineWorldviewDraft | null>(null)
  const [worldviewValidationReportPreview, setWorldviewValidationReportPreview] =
    useState<PipelineWorldviewValidationReport | null>(null)
  const [worldviewValidationReport, setWorldviewValidationReport] =
    useState<PipelineWorldviewValidationReport | null>(null)
  const [worldviewInitialValidationReport, setWorldviewInitialValidationReport] =
    useState<PipelineWorldviewValidationReport | null>(null)
  const [worldviewFinalValidationReport, setWorldviewFinalValidationReport] =
    useState<PipelineWorldviewValidationReport | null>(null)
  const [worldviewRepairSummary, setWorldviewRepairSummary] =
    useState<PipelineWorldviewRepairSummary | null>(null)
  const [worldviewClosureStatus, setWorldviewClosureStatus] =
    useState<PipelineWorldviewClosureStatus | null>(null)
  const [worldviewRepairApplied, setWorldviewRepairApplied] = useState(false)
  const [worldviewEvidenceReselected, setWorldviewEvidenceReselected] = useState(false)
  const [worldviewWarnings, setWorldviewWarnings] = useState<string[]>([])
  const [worldviewNormalizationWarnings, setWorldviewNormalizationWarnings] = useState<string[]>([])
  const [worldviewValidationWarnings, setWorldviewValidationWarnings] = useState<string[]>([])
  const [episodeScriptDialogOpen, setEpisodeScriptDialogOpen] = useState(false)
  const [episodeScriptModels, setEpisodeScriptModels] = useState<AiModelOptionDto[]>([])
  const [episodeScriptLoading, setEpisodeScriptLoading] = useState(false)
  const [episodeScriptGenerating, setEpisodeScriptGenerating] = useState(false)
  const [episodeScriptPersisting, setEpisodeScriptPersisting] = useState(false)
  const [episodeScriptSelectedModelKey, setEpisodeScriptSelectedModelKey] = useState('')
  const [episodeScriptDurationMode, setEpisodeScriptDurationMode] =
    useState<PipelineEpisodeDurationMode>('60s')
  const [episodeScriptGenerationMode, setEpisodeScriptGenerationMode] =
    useState<PipelineEpisodeGenerationMode>('outline_and_script')
  const [episodeScriptReferenceTables, setEpisodeScriptReferenceTables] =
    useState<PipelineEpisodeScriptReferenceTable[]>(defaultEpisodeScriptReferenceTables)
  const [episodeScriptUserInstruction, setEpisodeScriptUserInstruction] = useState('')
  const [episodeScriptAllowPromptEdit, setEpisodeScriptAllowPromptEdit] = useState(false)
  const [episodeScriptPromptPreview, setEpisodeScriptPromptPreview] = useState('')
  const [episodeScriptFontSize, setEpisodeScriptFontSize] = useState(14)
  const [episodeScriptSourceTextCharBudget, setEpisodeScriptSourceTextCharBudget] = useState(30000)
  const [episodeScriptReferenceSummary, setEpisodeScriptReferenceSummary] = useState<
    PipelineEpisodeScriptReferenceSummaryItem[]
  >([])
  const [episodeScriptDraft, setEpisodeScriptDraft] = useState<PipelineEpisodeScriptDraft | null>(
    null
  )
  const [episodeScriptWarnings, setEpisodeScriptWarnings] = useState<string[]>([])
  const [episodeScriptNormalizationWarnings, setEpisodeScriptNormalizationWarnings] = useState<
    string[]
  >([])
  const [episodeScriptValidationWarnings, setEpisodeScriptValidationWarnings] = useState<
    string[]
  >([])
  const [episodeScriptDraftGenerationMode, setEpisodeScriptDraftGenerationMode] = useState<
    string | undefined
  >(undefined)
  const [episodeScriptTargetEpisodeCount, setEpisodeScriptTargetEpisodeCount] = useState<
    number | undefined
  >(undefined)
  const [episodeScriptActualEpisodeCount, setEpisodeScriptActualEpisodeCount] = useState<
    number | undefined
  >(undefined)
  const [episodeScriptCountMismatchWarning, setEpisodeScriptCountMismatchWarning] = useState<
    string | undefined
  >(undefined)
  const [episodeScriptFinalCompletenessOk, setEpisodeScriptFinalCompletenessOk] = useState<
    boolean | undefined
  >(undefined)
  const [episodeScriptBatchInfo, setEpisodeScriptBatchInfo] = useState<
    PipelineEpisodeScriptBatchInfo[] | undefined
  >(undefined)
  const [episodeScriptFailedBatches, setEpisodeScriptFailedBatches] = useState<
    Array<{ batchIndex: number; range: string; error?: string }> | undefined
  >(undefined)
  const [episodeScriptRepairSummary, setEpisodeScriptRepairSummary] = useState<
    PipelineEpisodeScriptRepairSummary | undefined
  >(undefined)
  const [episodeScriptGeneratingPhase, setEpisodeScriptGeneratingPhase] = useState('')
  const episodeScriptPhaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadOverview = async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await api.getPipelineOverview(novelId)
      setTimelines(data.timelines || [])
      setCharacters(data.characters || [])
      setKeyNodes(data.keyNodes || [])
      setExplosions(data.explosions || [])
      setSkeletonTopics(data.skeletonTopics || [])
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

  const getModuleConfig = (module: string) =>
    modules.find((item) => item.key === module)

  const openResourceManager = (resource: PipelineResourceName) => {
    router.push(`/projects/${novelId}/pipeline/${resource}`)
  }

  const toggleStep3Module = (module: string) => {
    setExpandedStep3Modules((prev) => ({
      ...prev,
      [module]: !prev[module],
    }))
  }

  const handleModuleAction = (module: string, action: ModuleAction) => {
    if (module === 'set_core') {
      if (action === 'save') {
        handleSetCoreSave()
        return
      }
      if (action === 'edit') {
        void toggleEditor('set_core')
        return
      }
      if (action === 'generate') {
        void handleOpenEnhanceDialog()
      }
      return
    }

    const moduleConfig = getModuleConfig(module)
    if (!moduleConfig?.primaryResource) {
      return
    }

    if (action === 'generate') {
      void handleOpenWorldviewDialog()
      return
    }

    openResourceManager(moduleConfig.primaryResource)
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
      const detailText = result.details
        ? `\n\nnotes details:\n真实AI修正说明：${result.details.reviewNotes.normalizedCount} / 原始返回 ${result.details.reviewNotes.rawCount} / 丢弃 ${result.details.reviewNotes.droppedCount}\n表级摘要：\n- timelines: ai=${result.details.tables.novel_timelines.usedAiNotes}, fallback=${result.details.tables.novel_timelines.usedFallback ? 'yes' : 'no'}, merged=${result.details.tables.novel_timelines.mergedWithHistory}\n- characters: ai=${result.details.tables.novel_characters.usedAiNotes}, fallback=${result.details.tables.novel_characters.usedFallback ? 'yes' : 'no'}, merged=${result.details.tables.novel_characters.mergedWithHistory}\n- keyNodes: ai=${result.details.tables.novel_key_nodes.usedAiNotes}, fallback=${result.details.tables.novel_key_nodes.usedFallback ? 'yes' : 'no'}, merged=${result.details.tables.novel_key_nodes.mergedWithHistory}\n- skeletonTopicItems: ai=${result.details.tables.novel_skeleton_topic_items.usedAiNotes}, fallback=${result.details.tables.novel_skeleton_topic_items.usedFallback ? 'yes' : 'no'}, merged=${result.details.tables.novel_skeleton_topic_items.mergedWithHistory}\n- explosions: ai=${result.details.tables.novel_explosions.usedAiNotes}, fallback=${result.details.tables.novel_explosions.usedFallback ? 'yes' : 'no'}, merged=${result.details.tables.novel_explosions.mergedWithHistory}`
        : ''
      const warningText = result.warnings?.length
        ? `\n\nwarnings:\n- ${result.warnings.join('\n- ')}`
        : ''

      alert(
        `二次AI自检完成\n时间线：${result.summary.timelines}\n人物：${result.summary.characters}\n关键节点：${result.summary.keyNodes}\n骨架主题内容：${result.summary.skeletonTopicItems}\n爆点：${result.summary.explosions}${detailText}${reviewNoteText}${warningText}`
      )
    } catch (err: any) {
      alert(err?.message || '二次AI自检失败')
    } finally {
      setSecondReviewSubmitting(false)
    }
  }

  const loadWorldviewModels = async () => {
    const models = await pipelineAiApi.listAiModelOptions()
    const safeModels = (models || []).filter(isSafeWorldviewModel)
    setWorldviewModels(safeModels)
    return safeModels
  }

  const refreshWorldviewPromptPreview = async (modelKey?: string) => {
    const resolvedModelKey = modelKey || worldviewSelectedModelKey
    if (!resolvedModelKey) {
      return
    }

    try {
      setWorldviewLoading(true)
      const preview = await pipelineWorldviewApi.previewWorldviewPrompt(novelId, {
        modelKey: resolvedModelKey,
        referenceTables: worldviewReferenceTables,
        userInstruction: worldviewUserInstruction || undefined,
        allowPromptEdit: worldviewAllowPromptEdit,
        promptOverride:
          worldviewAllowPromptEdit && worldviewPromptPreview.trim()
            ? worldviewPromptPreview
            : undefined,
        sourceTextCharBudget: worldviewSourceTextCharBudget,
      })
      setWorldviewPromptPreview(preview.promptPreview || '')
      setWorldviewReferenceSummary(preview.referenceSummary || [])
      setWorldviewEvidenceSummary(preview.evidenceSummary || null)
      setWorldviewInferenceSummary(preview.inferenceSummary || null)
      setWorldviewQualitySummary(preview.qualitySummary || null)
      setWorldviewQualityWarnings(preview.qualityWarnings || [])
      setWorldviewAlignmentSummary(preview.alignmentSummary || null)
      setWorldviewAlignmentWarnings(preview.alignmentWarnings || [])
      setWorldviewValidationReportPreview(preview.validationReportPreview || null)
      setWorldviewWarnings(preview.warnings || [])
      if (!worldviewSelectedModelKey && preview.usedModelKey) {
        setWorldviewSelectedModelKey(preview.usedModelKey)
      }
    } catch (err: any) {
      alert(err?.message || '生成世界观 Prompt 预览失败')
    } finally {
      setWorldviewLoading(false)
    }
  }

  const handleOpenWorldviewDialog = async () => {
    try {
      setWorldviewDialogOpen(true)
      setWorldviewDraft(null)
      setWorldviewNormalizationWarnings([])
      setWorldviewValidationWarnings([])
      setWorldviewEvidenceSummary(null)
      setWorldviewInferenceSummary(null)
      setWorldviewQualitySummary(null)
      setWorldviewQualityWarnings([])
      setWorldviewAlignmentSummary(null)
      setWorldviewAlignmentWarnings([])
      setWorldviewValidationReportPreview(null)
      setWorldviewValidationReport(null)
      setWorldviewInitialValidationReport(null)
      setWorldviewFinalValidationReport(null)
      setWorldviewRepairSummary(null)
      setWorldviewClosureStatus(null)
      setWorldviewRepairApplied(false)
      setWorldviewEvidenceReselected(false)

      let resolvedModelKey = worldviewSelectedModelKey
      let models = worldviewModels
      if (!models.length) {
        models = await loadWorldviewModels()
      }
      if (!models.length) {
        alert('未找到适合世界观结构化输出的稳定文本模型，请联系管理员检查模型配置')
        return
      }
      if (resolvedModelKey && !models.some((item) => item.modelKey === resolvedModelKey)) {
        resolvedModelKey = ''
      }
      if (!resolvedModelKey && models.length) {
        const preferred =
          worldviewDefaultModelCandidates.find((candidate) =>
            models.some((item) => item.modelKey === candidate)
          ) || models[0].modelKey
        resolvedModelKey = preferred
        setWorldviewSelectedModelKey(resolvedModelKey)
      }
      if (!worldviewReferenceTables.length) {
        setWorldviewReferenceTables(defaultWorldviewReferenceTables)
      }
      if (resolvedModelKey) {
        await refreshWorldviewPromptPreview(resolvedModelKey)
      }
    } catch (err: any) {
      alert(err?.message || '打开世界观提炼弹窗失败')
    }
  }

  const handleToggleWorldviewReferenceTable = (table: PipelineWorldviewReferenceTable) => {
    setWorldviewReferenceTables((prev) =>
      prev.includes(table) ? prev.filter((item) => item !== table) : [...prev, table]
    )
  }

  const handleGenerateWorldviewDraft = async () => {
    if (!worldviewSelectedModelKey) {
      alert('请选择 AI 模型')
      return
    }

    try {
      setWorldviewGenerating(true)
      const result = await pipelineWorldviewApi.generateWorldviewDraft(novelId, {
        modelKey: worldviewSelectedModelKey,
        referenceTables: worldviewReferenceTables,
        userInstruction: worldviewUserInstruction || undefined,
        allowPromptEdit: worldviewAllowPromptEdit,
        promptOverride:
          worldviewAllowPromptEdit && worldviewPromptPreview.trim()
            ? worldviewPromptPreview
            : undefined,
        sourceTextCharBudget: worldviewSourceTextCharBudget,
      })
      setWorldviewPromptPreview(result.promptPreview || worldviewPromptPreview)
      setWorldviewReferenceSummary(result.referenceSummary || [])
      setWorldviewEvidenceSummary(result.evidenceSummary || null)
      setWorldviewInferenceSummary(result.inferenceSummary || null)
      setWorldviewQualitySummary(result.qualitySummary || null)
      setWorldviewQualityWarnings(result.qualityWarnings || [])
      setWorldviewAlignmentSummary(result.alignmentSummary || null)
      setWorldviewAlignmentWarnings(result.alignmentWarnings || [])
      setWorldviewValidationReport(result.validationReport || null)
      setWorldviewInitialValidationReport(result.initialValidationReport || null)
      setWorldviewFinalValidationReport(result.finalValidationReport || null)
      setWorldviewRepairSummary(result.repairSummary || null)
      setWorldviewClosureStatus(result.closureStatus || null)
      setWorldviewRepairApplied(Boolean(result.repairApplied))
      setWorldviewEvidenceReselected(Boolean(result.evidenceReselected))
      setWorldviewDraft(result.draft || null)
      setWorldviewWarnings(result.warnings || [])
      setWorldviewNormalizationWarnings(result.normalizationWarnings || [])
      setWorldviewValidationWarnings(result.validationWarnings || [])
    } catch (err: any) {
      alert(err?.message || '生成世界观草稿失败')
    } finally {
      setWorldviewGenerating(false)
    }
  }

  const handlePersistWorldviewDraft = async () => {
    if (!worldviewDraft) {
      alert('请先生成世界观草稿')
      return
    }

    try {
      setWorldviewPersisting(true)
      const result = await pipelineWorldviewApi.persistWorldviewDraft(novelId, {
        draft: worldviewDraft,
      })
      setWorldviewNormalizationWarnings(result.normalizationWarnings || [])
      setWorldviewValidationWarnings(result.validationWarnings || [])
      setWorldviewInferenceSummary(result.inferenceSummary || null)
      setWorldviewQualitySummary(result.qualitySummary || null)
      setWorldviewQualityWarnings(result.qualityWarnings || [])
      setWorldviewAlignmentSummary(result.alignmentSummary || null)
      setWorldviewAlignmentWarnings(result.alignmentWarnings || [])
      setWorldviewValidationReport(result.validationReport || null)
      setWorldviewFinalValidationReport(result.validationReport || null)
      setWorldviewClosureStatus(result.closureStatus || null)
      setWorldviewRepairApplied(Boolean(result.repairApplied))
      setWorldviewEvidenceReselected(Boolean(result.evidenceReselected))
      await loadOverview()
      alert(
        `世界观写入成功\n爽点架构：${result.summary.payoffArch}\n爽点线：${result.summary.payoffLines}\n对手矩阵：${result.summary.opponentMatrix}\n对手明细：${result.summary.opponents}\n权力阶梯：${result.summary.powerLadder}\n内鬼系统：${result.summary.traitorSystem}\n内鬼角色：${result.summary.traitors}\n内鬼阶段：${result.summary.traitorStages}\n故事阶段：${result.summary.storyPhases}`
      )
    } catch (err: any) {
      alert(err?.message || '写入世界观草稿失败')
    } finally {
      setWorldviewPersisting(false)
    }
  }

  const loadEpisodeScriptModels = async () => {
    const models = await pipelineAiApi.listAiModelOptions()
    const safeModels = (models || []).filter(isSafeWorldviewModel)
    setEpisodeScriptModels(safeModels)
    return safeModels
  }

  const refreshEpisodeScriptPromptPreview = async (modelKey?: string) => {
    const resolvedModelKey = modelKey || episodeScriptSelectedModelKey
    if (!resolvedModelKey) {
      return
    }
    try {
      setEpisodeScriptLoading(true)
      const preview = await pipelineEpisodeScriptApi.previewEpisodeScriptPrompt(novelId, {
        modelKey: resolvedModelKey,
        referenceTables: episodeScriptReferenceTables,
        userInstruction: episodeScriptUserInstruction || undefined,
        allowPromptEdit: episodeScriptAllowPromptEdit,
        promptOverride:
          episodeScriptAllowPromptEdit && episodeScriptPromptPreview.trim()
            ? episodeScriptPromptPreview
            : undefined,
        sourceTextCharBudget: episodeScriptSourceTextCharBudget,
        durationMode: episodeScriptDurationMode,
        generationMode: episodeScriptGenerationMode,
        targetEpisodeCount: totalChapters,
      })
      setEpisodeScriptPromptPreview(preview.promptPreview || '')
      setEpisodeScriptReferenceSummary(preview.referenceSummary || [])
      setEpisodeScriptWarnings(preview.warnings || [])
      if (!episodeScriptSelectedModelKey && preview.usedModelKey) {
        setEpisodeScriptSelectedModelKey(preview.usedModelKey)
      }
    } catch (err: any) {
      alert(err?.message || '生成每集纲要/剧本 Prompt 预览失败')
    } finally {
      setEpisodeScriptLoading(false)
    }
  }

  const handleOpenEpisodeScriptDialog = async () => {
    try {
      setEpisodeScriptDialogOpen(true)
      setEpisodeScriptDraft(null)
      setEpisodeScriptWarnings([])
      setEpisodeScriptNormalizationWarnings([])
      setEpisodeScriptValidationWarnings([])
      setEpisodeScriptReferenceSummary([])

      let resolvedModelKey = episodeScriptSelectedModelKey
      let models = episodeScriptModels
      if (!models.length) {
        models = await loadEpisodeScriptModels()
      }
      if (!models.length) {
        alert('未找到可用文本模型，请先配置模型')
        return
      }
      if (resolvedModelKey && !models.some((item) => item.modelKey === resolvedModelKey)) {
        resolvedModelKey = ''
      }
      if (!resolvedModelKey) {
        resolvedModelKey = models[0].modelKey
        setEpisodeScriptSelectedModelKey(resolvedModelKey)
      }
      if (!episodeScriptReferenceTables.length) {
        setEpisodeScriptReferenceTables(defaultEpisodeScriptReferenceTables)
      }
      await refreshEpisodeScriptPromptPreview(resolvedModelKey)
    } catch (err: any) {
      alert(err?.message || '打开每集纲要/剧本弹窗失败')
    }
  }

  const handleToggleEpisodeScriptReferenceTable = (table: PipelineEpisodeScriptReferenceTable) => {
    setEpisodeScriptReferenceTables((prev) =>
      prev.includes(table) ? prev.filter((item) => item !== table) : [...prev, table]
    )
  }

  const handleGenerateEpisodeScriptDraft = async () => {
    if (!episodeScriptSelectedModelKey) {
      alert('请选择 AI 模型')
      return
    }
    if (process.env.NODE_ENV !== 'production') {
      console.info('[episode-script][generateDraft][frontend][request]', {
        novelId,
        modelKey: episodeScriptSelectedModelKey,
        generationMode: episodeScriptGenerationMode,
        durationMode: episodeScriptDurationMode,
        targetEpisodeCount: totalChapters,
        referenceTableCount: episodeScriptReferenceTables.length,
      })
    }
    const clearPhaseTimer = () => {
      if (episodeScriptPhaseTimerRef.current) {
        clearTimeout(episodeScriptPhaseTimerRef.current)
        episodeScriptPhaseTimerRef.current = null
      }
    }
    const startPseudoPhases = () => {
      const targetEp = totalChapters || 61
      const batchSize = 5
      const estimatedBatches = Math.ceil(targetEp / batchSize)
      setEpisodeScriptGeneratingPhase('正在生成全集规划（Plan）...')
      let currentBatch = 0
      const advanceBatch = () => {
        currentBatch++
        if (currentBatch <= estimatedBatches) {
          setEpisodeScriptGeneratingPhase(
            `正在分批生成（Batch ${currentBatch} / ${estimatedBatches}）...`
          )
          episodeScriptPhaseTimerRef.current = setTimeout(advanceBatch, 25000)
        } else {
          setEpisodeScriptGeneratingPhase('正在合并与校验结果...')
        }
      }
      episodeScriptPhaseTimerRef.current = setTimeout(advanceBatch, 15000)
    }
    try {
      setEpisodeScriptGenerating(true)
      startPseudoPhases()
      const result = await pipelineEpisodeScriptApi.generateEpisodeScriptDraft(novelId, {
        modelKey: episodeScriptSelectedModelKey,
        referenceTables: episodeScriptReferenceTables,
        userInstruction: episodeScriptUserInstruction || undefined,
        allowPromptEdit: episodeScriptAllowPromptEdit,
        promptOverride:
          episodeScriptAllowPromptEdit && episodeScriptPromptPreview.trim()
            ? episodeScriptPromptPreview
            : undefined,
        sourceTextCharBudget: episodeScriptSourceTextCharBudget,
        durationMode: episodeScriptDurationMode,
        generationMode: episodeScriptGenerationMode,
        targetEpisodeCount: totalChapters,
      })
      setEpisodeScriptPromptPreview(result.promptPreview || episodeScriptPromptPreview)
      setEpisodeScriptReferenceSummary(result.referenceSummary || [])
      setEpisodeScriptDraft(result.draft || null)
      setEpisodeScriptDraftGenerationMode(result.generationMode)
      setEpisodeScriptTargetEpisodeCount(result.targetEpisodeCount)
      setEpisodeScriptActualEpisodeCount(result.actualEpisodeCount)
      setEpisodeScriptCountMismatchWarning(result.countMismatchWarning)
      setEpisodeScriptWarnings(result.warnings || [])
      setEpisodeScriptNormalizationWarnings(result.normalizationWarnings || [])
      setEpisodeScriptValidationWarnings(result.validationWarnings || [])
      setEpisodeScriptFinalCompletenessOk(result.finalCompletenessOk)
      setEpisodeScriptBatchInfo(result.batchInfo)
      setEpisodeScriptFailedBatches(result.failedBatches)
      setEpisodeScriptRepairSummary(result.repairSummary)
      if (process.env.NODE_ENV !== 'production') {
        console.info('[episode-script][generateDraft][frontend][response]', {
          novelId,
          actualEpisodeCount: result.actualEpisodeCount ?? null,
          validationWarningCount: (result.validationWarnings || []).length,
          normalizationWarningCount: (result.normalizationWarnings || []).length,
          countMismatchWarning: result.countMismatchWarning || null,
          finalCompletenessOk: result.finalCompletenessOk ?? null,
          batchCount: result.batchCount ?? null,
          failedBatchCount: (result.failedBatches || []).length,
        })
      }
    } catch (err: any) {
      alert(err?.message || '生成每集纲要/剧本草稿失败')
    } finally {
      clearPhaseTimer()
      setEpisodeScriptGeneratingPhase('')
      setEpisodeScriptGenerating(false)
    }
  }

  const handlePersistEpisodeScriptDraft = async () => {
    if (!episodeScriptDraft) {
      alert('请先生成草稿')
      return
    }
    if (episodeScriptFinalCompletenessOk === false) {
      const missingStr = (episodeScriptDraft?.episodePackage?.episodes || []).length
        ? `实际 ${episodeScriptDraft.episodePackage.episodes.length} 集`
        : '集数未知'
      const confirmed = window.confirm(
        `⚠️ 草稿不完整（${missingStr}，目标 ${episodeScriptTargetEpisodeCount || '?'} 集）\n\n` +
        `缺失集号可能导致数据不完整。确定要强制写入数据库吗？`
      )
      if (!confirmed) return
    }
    try {
      setEpisodeScriptPersisting(true)
      const persistPayload = {
        draft: episodeScriptDraft,
        generationMode: episodeScriptGenerationMode,
      }
      if (process.env.NODE_ENV !== 'production') {
        const payloadJson = JSON.stringify(persistPayload)
        const payloadChars = payloadJson.length
        const payloadBytes = new Blob([payloadJson]).size
        console.info('[episode-script][persist][frontend][payload]', {
          novelId,
          generationMode: episodeScriptGenerationMode,
          payloadChars,
          payloadBytes,
          payloadMB: (payloadBytes / 1024 / 1024).toFixed(2),
          targetEpisodeCount: episodeScriptTargetEpisodeCount ?? null,
          actualEpisodeCount: episodeScriptDraft?.episodePackage?.episodes?.length ?? null,
        })
      }
      const result = await pipelineEpisodeScriptApi.persistEpisodeScriptDraft(novelId, persistPayload)
      setEpisodeScriptWarnings(result.warnings || [])
      setEpisodeScriptNormalizationWarnings(result.normalizationWarnings || [])
      setEpisodeScriptValidationWarnings(result.validationWarnings || [])
      await loadOverview()
      alert(
        `写入成功\nepisodes：${result.summary.episodes}\nstructure templates：${result.summary.structureTemplates}\nhook rhythm：${result.summary.hookRhythm}`
      )
    } catch (err: any) {
      alert(err?.message || '写入每集纲要/剧本失败')
    } finally {
      setEpisodeScriptPersisting(false)
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

  const getResourceRows = (resource: PipelineResourceName): Record<string, any>[] => {
    switch (resource) {
      case 'payoff-arch':
        return payoffArchRows
      case 'payoff-lines':
        return payoffLineRows
      case 'opponent-matrix':
        return opponentMatrixRows
      case 'opponents':
        return opponentRows
      case 'power-ladder':
        return worldview.powerLadder || []
      case 'traitor-system':
        return traitorSystemRows
      case 'traitors':
        return traitorRows
      case 'traitor-stages':
        return traitorStageRows
      case 'story-phases':
        return worldview.storyPhases || []
      default:
        return []
    }
  }

  const enhanceSaveBehaviorDescription = requireConfirm
    ? '当前模式：生成后只回填编辑器，未自动保存到 set_core。'
    : `当前模式：生成后将自动保存到 set_core（${
        getSetCoreSaveMode() === 'new_version' ? '新建版本' : '更新当前激活版本'
      }），并刷新 Step3 数据。`

  const payoffArchRows = useMemo(() => worldview.payoffArch || [], [worldview.payoffArch])
  const payoffLineRows = useMemo(
    () =>
      (worldview.payoffArch || []).flatMap((arch) =>
        (arch.lines || []).map((line: Record<string, any>) => ({
          ...line,
          novel_id: line.novel_id ?? arch.novel_id ?? novelId,
          payoff_arch_id: line.payoff_arch_id ?? arch.id,
        }))
      ),
    [worldview.payoffArch, novelId]
  )
  const opponentMatrixRows = useMemo(() => worldview.opponents || [], [worldview.opponents])
  const opponentRows = useMemo(
    () =>
      (worldview.opponents || []).flatMap((matrix) =>
        (matrix.opponents || []).map((item: Record<string, any>) => ({
          ...item,
          novel_id: item.novel_id ?? matrix.novel_id ?? novelId,
          opponent_matrix_id: item.opponent_matrix_id ?? matrix.id,
        }))
      ),
    [worldview.opponents, novelId]
  )
  const traitorSystemRows = useMemo(() => worldview.traitors || [], [worldview.traitors])
  const traitorRows = useMemo(
    () =>
      (worldview.traitors || []).flatMap((system) =>
        (system.traitors || []).map((item: Record<string, any>) => ({
          ...item,
          novel_id: item.novel_id ?? system.novel_id ?? novelId,
          traitor_system_id: item.traitor_system_id ?? system.id,
        }))
      ),
    [worldview.traitors, novelId]
  )
  const traitorStageRows = useMemo(
    () =>
      (worldview.traitors || []).flatMap((system) =>
        (system.stages || []).map((item: Record<string, any>) => ({
          ...item,
          novel_id: item.novel_id ?? system.novel_id ?? novelId,
          traitor_system_id: item.traitor_system_id ?? system.id,
        }))
      ),
    [worldview.traitors, novelId]
  )

  const skeletonTopicItemRows = useMemo(() => {
    return skeletonTopics.flatMap((topic) =>
      (topic.items || []).map((item) => ({
        ...item,
        topic_id: topic.id,
        topic_key: topic.topic_key,
        topic_name: topic.topic_name,
        topic_type: topic.topic_type,
      }))
    )
  }, [skeletonTopics])

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
              <button
                onClick={() => router.push(`/projects/${novelId}/pipeline/skeleton-topics`)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  padding: 0,
                  fontWeight: 600,
                  marginBottom: '6px',
                  color: '#1890ff',
                  cursor: 'pointer',
                }}
              >
                骨架分析主题（可配置）
              </button>
              <SkeletonTopicsPanel novelId={novelId} refreshKey={extractRefreshKey} />
            </div>
            <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
              后端只读查询并展示已存在数据（本阶段不写库）
            </div>
            <PipelineDataSection
              novelId={novelId}
              resource="timelines"
              rows={timelines}
              onRefresh={loadOverview}
            />
            <PipelineDataSection
              novelId={novelId}
              resource="characters"
              rows={characters}
              onRefresh={loadOverview}
            />
            <PipelineDataSection
              novelId={novelId}
              resource="key-nodes"
              rows={keyNodes}
              onRefresh={loadOverview}
            />
            <PipelineDataSection
              novelId={novelId}
              resource="skeleton-topic-items"
              rows={skeletonTopicItemRows}
              onRefresh={loadOverview}
            />
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
            <PipelineDataSection
              novelId={novelId}
              resource="explosions"
              rows={explosions}
              onRefresh={loadOverview}
            />
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
          <button
            onClick={() => void handleOpenWorldviewDialog()}
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
            提炼短剧世界观
          </button>
          <button
            onClick={() => void handleOpenEpisodeScriptDialog()}
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
            生成每集纲要和每集剧本
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
                    flexWrap: 'wrap',
                  }}
                >
                  <div>
                    {item.primaryResource ? (
                      <button
                        onClick={() => openResourceManager(item.primaryResource!)}
                        style={{
                          border: 'none',
                          background: 'transparent',
                          padding: 0,
                          fontWeight: 600,
                          color: '#1890ff',
                          cursor: 'pointer',
                        }}
                      >
                        {item.title}
                      </button>
                    ) : (
                      <div style={{ fontWeight: 600 }}>{item.title}</div>
                    )}
                    <div style={{ fontSize: '12px', color: '#666', marginTop: '2px' }}>
                      {item.resources?.length ? (
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          {item.resources.map((resourceKey) => (
                            <button
                              key={resourceKey}
                              onClick={() => openResourceManager(resourceKey)}
                              style={{
                                border: 'none',
                                background: 'transparent',
                                color: '#1890ff',
                                cursor: 'pointer',
                                padding: 0,
                                fontSize: '12px',
                              }}
                            >
                              {resourceKey}
                            </button>
                          ))}
                        </div>
                      ) : (
                        item.mapping
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {item.key === 'set_core' && (
                      <button
                        onClick={toggleSetCoreDataList}
                        style={{
                          padding: '6px 12px',
                          border: '1px solid #d9d9d9',
                          background: 'white',
                          borderRadius: '4px',
                          cursor: 'pointer',
                        }}
                      >
                        {expandedDataLists.set_core ? '列表收起' : '列表展开'}
                      </button>
                    )}
                    <button
                      onClick={() => void handleModuleAction(item.key, 'generate')}
                      style={{ padding: '6px 12px', border: '1px solid #1890ff', background: 'white', color: '#1890ff', borderRadius: '4px', cursor: 'pointer' }}
                    >
                      生成(或刷新)
                    </button>
                    <button
                      onClick={() => void handleModuleAction(item.key, 'edit')}
                      style={{ padding: '6px 12px', border: '1px solid #d9d9d9', background: 'white', borderRadius: '4px', cursor: 'pointer' }}
                    >
                      {item.key === 'set_core' && expandedEditors.set_core ? '收起' : '编辑'}
                    </button>
                    <button
                      onClick={() => void handleModuleAction(item.key, 'save')}
                      style={{ padding: '6px 12px', border: 'none', background: '#1890ff', color: 'white', borderRadius: '4px', cursor: 'pointer' }}
                    >
                      {item.key === 'set_core' ? '保存' : '前往管理页'}
                    </button>
                    <button
                      onClick={() => toggleStep3Module(item.key)}
                      style={{
                        padding: '6px 12px',
                        border: '1px solid #d9d9d9',
                        background: 'white',
                        borderRadius: '4px',
                        cursor: 'pointer',
                      }}
                    >
                      {expandedStep3Modules[item.key] ? '收起' : '展开'}
                    </button>
                  </div>
                </div>
                {item.key === 'set_core' && expandedStep3Modules[item.key] && expandedEditors.set_core && (
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
                {item.key !== 'set_core' && expandedStep3Modules[item.key] && (
                  <div
                    style={{
                      marginTop: '10px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px',
                    }}
                  >
                    {(item.resources || []).map((resource) => (
                      <PipelineDataSection
                        key={`${item.key}-${resource}`}
                        novelId={novelId}
                        resource={resource}
                        rows={getResourceRows(resource)}
                        onRefresh={loadOverview}
                      />
                    ))}
                  </div>
                )}
                {item.key === 'set_core' && expandedStep3Modules[item.key] && expandedDataLists.set_core && (
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
      <PipelineWorldviewDialog
        open={worldviewDialogOpen}
        models={worldviewModels}
        loading={worldviewLoading}
        generating={worldviewGenerating}
        persisting={worldviewPersisting}
        selectedModelKey={worldviewSelectedModelKey}
        referenceTables={worldviewReferenceTables}
        userInstruction={worldviewUserInstruction}
        allowPromptEdit={worldviewAllowPromptEdit}
        promptPreview={worldviewPromptPreview}
        fontSize={worldviewFontSize}
        sourceTextCharBudget={worldviewSourceTextCharBudget}
        referenceSummary={worldviewReferenceSummary}
        evidenceSummary={worldviewEvidenceSummary}
        inferenceSummary={worldviewInferenceSummary}
        qualitySummary={worldviewQualitySummary}
        qualityWarnings={worldviewQualityWarnings}
        alignmentSummary={worldviewAlignmentSummary}
        alignmentWarnings={worldviewAlignmentWarnings}
        validationReportPreview={worldviewValidationReportPreview}
        validationReport={worldviewValidationReport}
        initialValidationReport={worldviewInitialValidationReport}
        finalValidationReport={worldviewFinalValidationReport}
        repairSummary={worldviewRepairSummary}
        closureStatus={worldviewClosureStatus}
        repairApplied={worldviewRepairApplied}
        evidenceReselected={worldviewEvidenceReselected}
        draft={worldviewDraft}
        warnings={worldviewWarnings}
        normalizationWarnings={worldviewNormalizationWarnings}
        validationWarnings={worldviewValidationWarnings}
        onClose={() => setWorldviewDialogOpen(false)}
        onChangeModelKey={(value) => {
          setWorldviewSelectedModelKey(value)
          if (!worldviewAllowPromptEdit && value) {
            void refreshWorldviewPromptPreview(value)
          }
        }}
        onToggleReferenceTable={handleToggleWorldviewReferenceTable}
        onChangeUserInstruction={setWorldviewUserInstruction}
        onChangeAllowPromptEdit={setWorldviewAllowPromptEdit}
        onChangePromptPreview={setWorldviewPromptPreview}
        onChangeFontSize={setWorldviewFontSize}
        onChangeSourceTextCharBudget={setWorldviewSourceTextCharBudget}
        onRefreshPromptPreview={() => void refreshWorldviewPromptPreview()}
        onGenerateDraft={() => void handleGenerateWorldviewDraft()}
        onPersistDraft={() => void handlePersistWorldviewDraft()}
      />
      <PipelineEpisodeScriptDialog
        open={episodeScriptDialogOpen}
        models={episodeScriptModels}
        loading={episodeScriptLoading}
        generating={episodeScriptGenerating}
        persisting={episodeScriptPersisting}
        selectedModelKey={episodeScriptSelectedModelKey}
        durationMode={episodeScriptDurationMode}
        generationMode={episodeScriptGenerationMode}
        draftGenerationMode={episodeScriptDraftGenerationMode}
        targetEpisodeCount={episodeScriptTargetEpisodeCount}
        actualEpisodeCount={episodeScriptActualEpisodeCount}
        countMismatchWarning={episodeScriptCountMismatchWarning}
        referenceTables={episodeScriptReferenceTables}
        userInstruction={episodeScriptUserInstruction}
        allowPromptEdit={episodeScriptAllowPromptEdit}
        promptPreview={episodeScriptPromptPreview}
        fontSize={episodeScriptFontSize}
        sourceTextCharBudget={episodeScriptSourceTextCharBudget}
        referenceSummary={episodeScriptReferenceSummary}
        draft={episodeScriptDraft}
        warnings={episodeScriptWarnings}
        normalizationWarnings={episodeScriptNormalizationWarnings}
        validationWarnings={episodeScriptValidationWarnings}
        finalCompletenessOk={episodeScriptFinalCompletenessOk}
        batchInfo={episodeScriptBatchInfo}
        failedBatches={episodeScriptFailedBatches}
        repairSummary={episodeScriptRepairSummary}
        generatingPhase={episodeScriptGeneratingPhase}
        onClose={() => {
          setEpisodeScriptDialogOpen(false)
          setEpisodeScriptDraft(null)
          setEpisodeScriptDraftGenerationMode(undefined)
          setEpisodeScriptTargetEpisodeCount(undefined)
          setEpisodeScriptActualEpisodeCount(undefined)
          setEpisodeScriptCountMismatchWarning(undefined)
          setEpisodeScriptFinalCompletenessOk(undefined)
          setEpisodeScriptBatchInfo(undefined)
          setEpisodeScriptFailedBatches(undefined)
          setEpisodeScriptRepairSummary(undefined)
        }}
        onChangeModelKey={(value) => {
          setEpisodeScriptSelectedModelKey(value)
          if (!episodeScriptAllowPromptEdit && value) {
            void refreshEpisodeScriptPromptPreview(value)
          }
        }}
        onChangeDurationMode={setEpisodeScriptDurationMode}
        onChangeGenerationMode={setEpisodeScriptGenerationMode}
        onToggleReferenceTable={handleToggleEpisodeScriptReferenceTable}
        onChangeUserInstruction={setEpisodeScriptUserInstruction}
        onChangeAllowPromptEdit={setEpisodeScriptAllowPromptEdit}
        onChangePromptPreview={setEpisodeScriptPromptPreview}
        onChangeFontSize={setEpisodeScriptFontSize}
        onChangeSourceTextCharBudget={setEpisodeScriptSourceTextCharBudget}
        onRefreshPromptPreview={() => void refreshEpisodeScriptPromptPreview()}
        onGenerateDraft={() => void handleGenerateEpisodeScriptDraft()}
        onPersistDraft={() => void handlePersistEpisodeScriptDraft()}
      />
    </div>
  )
}
