export class DramaStructureTemplateDto {
  id: number;
  themeType: string;
  structureName: string;
  identityGap?: string;
  pressureSource?: string;
  firstReverse?: string;
  continuousUpgrade?: string;
  suspenseHook?: string;
  powerLevel: number;
  isPowerUpChapter: number;
  powerUpContent?: string;
}

export class EpisodeResponseDto {
  id: number;
  novelId: number;
  episodeNumber: number;
  episodeTitle: string;
  arc?: string;
  opening?: string;
  coreConflict?: string;
  hooks?: string;
  cliffhanger?: string;
  fullContent?: string;
  outlineContent?: string;
  historyOutline?: string;
  rewriteDiff?: string;
  structureTemplateId?: number;
  sortOrder?: number;
  createdAt: Date;
  structureTemplate?: DramaStructureTemplateDto;
}
