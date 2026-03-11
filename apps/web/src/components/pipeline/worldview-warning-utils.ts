import type { PipelineWorldviewQualityWarning } from '@/types/pipeline'

export type ParsedWorldviewWarningPath = {
  moduleKey: PipelineWorldviewQualityWarning['moduleKey']
  groupKey: string
  index: number | null
  field: string | null
}

export function parseWorldviewWarningPath(
  warning: PipelineWorldviewQualityWarning
): ParsedWorldviewWarningPath {
  const path = warning.path || ''

  let groupKey = warning.moduleKey
  let index: number | null = null
  let field: string | null = null

  const storyMatch = path.match(/^setStoryPhases\[(\d+)\](?:\.(.+))?$/)
  if (storyMatch) {
    groupKey = 'story_phase.items'
    index = Number(storyMatch[1])
    field = storyMatch[2] || null
    return { moduleKey: warning.moduleKey, groupKey, index, field }
  }

  const traitorMatch = path.match(/^setTraitorSystem\.traitors\[(\d+)\](?:\.(.+))?$/)
  if (traitorMatch) {
    groupKey = 'traitor.traitors'
    index = Number(traitorMatch[1])
    field = traitorMatch[2] || null
    return { moduleKey: warning.moduleKey, groupKey, index, field }
  }

  const stageMatch = path.match(/^setTraitorSystem\.stages\[(\d+)\](?:\.(.+))?$/)
  if (stageMatch) {
    groupKey = 'traitor.stages'
    index = Number(stageMatch[1])
    field = stageMatch[2] || null
    return { moduleKey: warning.moduleKey, groupKey, index, field }
  }

  const payoffMatch = path.match(/^setPayoffArch\.lines\[(\d+)\](?:\.(.+))?$/)
  if (payoffMatch) {
    groupKey = 'payoff.lines'
    index = Number(payoffMatch[1])
    field = payoffMatch[2] || null
    return { moduleKey: warning.moduleKey, groupKey, index, field }
  }

  const powerMatch = path.match(/^setPowerLadder\[(\d+)\](?:\.(.+))?$/)
  if (powerMatch) {
    groupKey = 'power.items'
    index = Number(powerMatch[1])
    field = powerMatch[2] || null
    return { moduleKey: warning.moduleKey, groupKey, index, field }
  }

  const opponentMatch = path.match(/^setOpponentMatrix\.opponents\[(\d+)\](?:\.(.+))?$/)
  if (opponentMatch) {
    groupKey = 'opponents.items'
    index = Number(opponentMatch[1])
    field = opponentMatch[2] || null
    return { moduleKey: warning.moduleKey, groupKey, index, field }
  }

  return {
    moduleKey: warning.moduleKey,
    groupKey,
    index,
    field,
  }
}

export function groupWarningsByModuleAndIndex(
  warnings: PipelineWorldviewQualityWarning[]
) {
  const bucket = new Map<string, PipelineWorldviewQualityWarning[]>()
  warnings.forEach((warning) => {
    const parsed = parseWorldviewWarningPath(warning)
    const key = `${parsed.groupKey}:${parsed.index ?? 'root'}`
    const list = bucket.get(key) || []
    list.push(warning)
    bucket.set(key, list)
  })
  return bucket
}
