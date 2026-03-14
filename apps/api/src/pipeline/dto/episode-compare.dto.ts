export interface EpisodeCompareRowDto {
  episodeKey: number;
  episode: Record<string, unknown> | null;
  structureTemplate: Record<string, unknown> | null;
  hookRhythm: Record<string, unknown> | null;
}

export interface EpisodeCompareResponseDto {
  novelId: number;
  rows: EpisodeCompareRowDto[];
}
