export interface Novel {
  id: number
  novelsName: string
  description: string | null
  totalChapters: number
  powerUpInterval: number
  author: string | null
  status: number
  themeId: number | null
  createTime: string
  theme?: Theme
}

export interface Theme {
  id: number
  categoryMain: string
  categorySub: string
  hotLevel: number
  isHotTrack: number
  applyScene: string
  remarks: string
}

export interface SourceText {
  id: number
  novelsId: number
  updateTime: string
  contentLength: number
}

export interface SourceTextDetail {
  id: number
  novelsId: number
  sourceText: string
  updateTime: string
}

export interface SourceTextChunk {
  id: number
  offset: number
  limit: number
  totalLength: number
  text: string
}

export interface SourceSegmentsSummaryItem {
  sourceTextId: number
  segmentCount: number
  chapterCount: number
  version: number | null
  latestGeneratedAt: string | null
}

export interface SourceSegmentsSummary {
  novelId: number
  hasActiveSegments: boolean
  activeSegments: number
  sourceTextCount: number
  activeVersion: number | null
  latestGeneratedAt: string | null
  sources: SourceSegmentsSummaryItem[]
}

export interface GenerateSourceSegmentsResponse {
  novelId: number
  sourceTextCount: number
  generatedSegments: number
  skippedSegments: number
  version: number
  warnings?: string[]
  bySourceText: Array<{
    sourceTextId: number
    contentLength: number
    generatedSegments: number
    skippedSegments: number
  }>
}
