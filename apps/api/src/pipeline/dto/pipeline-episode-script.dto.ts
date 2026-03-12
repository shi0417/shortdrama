import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const allowedEpisodeScriptReferenceTables = [
  'drama_novels',
  'drama_source_text',
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
  'set_payoff_arch',
  'set_payoff_lines',
  'set_opponent_matrix',
  'set_opponents',
  'set_power_ladder',
  'set_traitor_system',
  'set_traitors',
  'set_traitor_stages',
  'set_story_phases',
] as const;

export type PipelineEpisodeScriptReferenceTable =
  (typeof allowedEpisodeScriptReferenceTables)[number];

export const episodeDurationModes = ['60s', '90s'] as const;
export type EpisodeDurationMode = (typeof episodeDurationModes)[number];

export const episodeGenerationModes = [
  'outline_only',
  'outline_and_script',
  'overwrite_existing',
] as const;
export type EpisodeGenerationMode = (typeof episodeGenerationModes)[number];

export class PipelineEpisodeScriptPreviewDto {
  @IsString()
  @MaxLength(100)
  modelKey!: string;

  @IsArray()
  @ArrayUnique()
  @IsIn(allowedEpisodeScriptReferenceTables, { each: true })
  referenceTables!: PipelineEpisodeScriptReferenceTable[];

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  userInstruction?: string;

  @IsOptional()
  @IsBoolean()
  allowPromptEdit?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200000)
  promptOverride?: string;

  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(120000)
  sourceTextCharBudget?: number;

  @IsOptional()
  @IsIn(episodeDurationModes)
  durationMode?: EpisodeDurationMode;

  @IsOptional()
  @IsIn(episodeGenerationModes)
  generationMode?: EpisodeGenerationMode;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  targetEpisodeCount?: number;
}

export class PipelineEpisodeScriptGenerateDraftDto extends PipelineEpisodeScriptPreviewDto {}

export class PipelineEpisodeScriptPersistDto {
  @IsOptional()
  @IsString()
  draftId?: string;

  @IsOptional()
  @IsObject()
  draft?: Record<string, any>;

  @IsOptional()
  @IsIn(episodeGenerationModes)
  generationMode?: EpisodeGenerationMode;
}

