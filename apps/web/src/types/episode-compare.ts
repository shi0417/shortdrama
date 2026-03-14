export interface EpisodeCompareRow {
  episodeKey: number
  episode: Record<string, unknown> | null
  structureTemplate: Record<string, unknown> | null
  hookRhythm: Record<string, unknown> | null
}

export interface EpisodeCompareResponse {
  novelId: number
  rows: EpisodeCompareRow[]
}
