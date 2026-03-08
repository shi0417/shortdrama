const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000'

type ApiErrorPayload = {
  message?: string | string[]
  warnings?: string[]
  details?: unknown
  error?: string
}

export interface LoginResponse {
  accessToken: string
  user: {
    id: number
    username: string
    phone: string | null
  }
}

export interface DramaStructureTemplateDto {
  id: number
  themeType: string
  structureName: string
  identityGap?: string
  pressureSource?: string
  firstReverse?: string
  continuousUpgrade?: string
  suspenseHook?: string
  powerLevel: number
  isPowerUpChapter: number
  powerUpContent?: string
}

export interface EpisodeResponseDto {
  id: number
  novelId: number
  episodeNumber: number
  episodeTitle: string
  arc?: string
  opening?: string
  coreConflict?: string
  hooks?: string
  cliffhanger?: string
  fullContent?: string
  outlineContent?: string
  historyOutline?: string
  rewriteDiff?: string
  structureTemplateId?: number
  sortOrder?: number
  createdAt: string
  structureTemplate?: DramaStructureTemplateDto
}

export interface PipelineOverviewDto {
  timelines: Record<string, any>[]
  characters: Record<string, any>[]
  keyNodes: Record<string, any>[]
  explosions: Record<string, any>[]
  skeletonTopics: Array<Record<string, any> & { items: Record<string, any>[] }>
  worldview: {
    core: Record<string, any>[]
    payoffArch: Record<string, any>[]
    opponents: Record<string, any>[]
    powerLadder: Record<string, any>[]
    traitors: Record<string, any>[]
    storyPhases: Record<string, any>[]
  }
}

function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('accessToken')
}

export async function apiClient(endpoint: string, options: RequestInit = {}) {
  const token = getToken()
  const headers = new Headers(options.headers)
  headers.set('Content-Type', 'application/json')

  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
  })

  if (!response.ok) {
    const rawText = await response.text()
    const payload = parseApiErrorPayload(rawText)
    const message = buildApiErrorMessage(payload, rawText, response.status)
    const error = new Error(message) as Error & {
      status?: number
      warnings?: string[]
      details?: unknown
      payload?: ApiErrorPayload
    }
    error.status = response.status
    error.warnings = payload.warnings
    error.details = payload.details
    error.payload = payload
    throw error
  }

  return response.json()
}

function parseApiErrorPayload(rawText: string): ApiErrorPayload {
  if (!rawText) {
    return {}
  }

  try {
    return JSON.parse(rawText) as ApiErrorPayload
  } catch {
    return {
      message: rawText,
    }
  }
}

function normalizeErrorMessage(message?: string | string[]): string {
  if (Array.isArray(message)) {
    return message.filter(Boolean).join('; ')
  }
  return message || ''
}

function stringifyDetails(details: unknown): string {
  if (details === null || details === undefined) {
    return ''
  }

  if (typeof details === 'string') {
    return details
  }

  try {
    return JSON.stringify(details)
  } catch {
    return '[details unavailable]'
  }
}

function buildApiErrorMessage(payload: ApiErrorPayload, rawText: string, status: number): string {
  const parts: string[] = []
  const message = normalizeErrorMessage(payload.message) || payload.error

  if (message) {
    parts.push(message)
  } else if (rawText.trim()) {
    parts.push(rawText.trim())
  } else {
    parts.push(`Request failed with status ${status}`)
  }

  if (payload.warnings?.length) {
    parts.push(`warnings: ${payload.warnings.join(' | ')}`)
  }

  if (payload.details !== undefined) {
    const detailsText = stringifyDetails(payload.details)
    if (detailsText) {
      parts.push(`details: ${detailsText}`)
    }
  }

  return parts.join('\n\n')
}

export const api = {
  async login(username: string, password: string): Promise<LoginResponse> {
    const response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, password }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.message || 'Login failed')
    }

    return response.json()
  },

  // Novels
  getNovels: (params?: { keyword?: string; status?: number; themeId?: number }) => {
    const query = new URLSearchParams()
    if (params?.keyword) query.append('keyword', params.keyword)
    if (params?.status !== undefined) query.append('status', params.status.toString())
    if (params?.themeId !== undefined) query.append('themeId', params.themeId.toString())
    return apiClient(`/novels?${query.toString()}`)
  },

  getNovel: (id: number) => apiClient(`/novels/${id}`),

  createNovel: (data: any) => apiClient('/novels', {
    method: 'POST',
    body: JSON.stringify(data),
  }),

  updateNovel: (id: number, data: any) => apiClient(`/novels/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  }),

  deleteNovel: (id: number) => apiClient(`/novels/${id}`, {
    method: 'DELETE',
  }),

  // Themes
  getThemes: (params?: { categoryMain?: string; hotLevel?: number; isHotTrack?: number }) => {
    const query = new URLSearchParams()
    if (params?.categoryMain) query.append('categoryMain', params.categoryMain)
    if (params?.hotLevel !== undefined) query.append('hotLevel', params.hotLevel.toString())
    if (params?.isHotTrack !== undefined) query.append('isHotTrack', params.isHotTrack.toString())
    return apiClient(`/themes?${query.toString()}`)
  },

  // Source Texts
  getSourceTexts: (novelId: number) => apiClient(`/novels/${novelId}/source-texts`),

  createSourceText: (novelId: number, data?: { sourceText?: string }) =>
    apiClient(`/novels/${novelId}/source-texts`, {
      method: 'POST',
      body: JSON.stringify(data || {}),
    }),

  getSourceTextFull: (id: number) => apiClient(`/source-texts/${id}?mode=full`),

  getSourceTextChunk: (id: number, offset: number, limit: number) =>
    apiClient(`/source-texts/${id}?mode=range&offset=${offset}&limit=${limit}`),

  updateSourceText: (id: number, sourceText: string) =>
    apiClient(`/source-texts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ sourceText }),
    }),

  deleteSourceText: (id: number) => apiClient(`/source-texts/${id}`, {
    method: 'DELETE',
  }),

  // Episodes
  getEpisodes: (novelId: number) => apiClient(`/episodes?novelId=${novelId}`) as Promise<EpisodeResponseDto[]>,

  // Pipeline (Read-only)
  getPipelineOverview: (novelId: number) =>
    apiClient(`/pipeline/${novelId}/overview`) as Promise<PipelineOverviewDto>,
}
