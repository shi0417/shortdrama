export interface AdaptationModeDto {
  id: number
  modeKey: string
  modeName: string
  description?: string | null
  isActive: number
  sortOrder: number
  createdAt: string
}

export interface AdaptationStrategyDto {
  id: number
  novelId: number
  modeId: number
  modeKey: string
  modeName: string
  strategyTitle?: string | null
  strategyDescription?: string | null
  aiPromptTemplate?: string | null
  version: number
  createdAt: string
  updatedAt: string
}

export interface CreateAdaptationStrategyPayload {
  modeId: number
  strategyTitle?: string
  strategyDescription?: string
  aiPromptTemplate?: string
}

export interface UpdateAdaptationStrategyPayload {
  modeId?: number
  strategyTitle?: string
  strategyDescription?: string
  aiPromptTemplate?: string
}
