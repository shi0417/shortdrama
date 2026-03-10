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

export const allowedWorldviewReferenceTables = [
  'drama_novels',
  'drama_source_text',
  'novel_adaptation_strategy',
  'adaptation_modes',
  'set_core',
  'novel_timelines',
  'novel_characters',
  'novel_key_nodes',
  'novel_skeleton_topics',
  'novel_skeleton_topic_items',
  'novel_explosions',
] as const;

export type PipelineWorldviewReferenceTable =
  (typeof allowedWorldviewReferenceTables)[number];

export class PipelineWorldviewPreviewDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  modelKey?: string;

  @IsArray()
  @ArrayUnique()
  @IsIn(allowedWorldviewReferenceTables, { each: true })
  referenceTables!: PipelineWorldviewReferenceTable[];

  @IsOptional()
  @IsString()
  userInstruction?: string;

  @IsOptional()
  @IsBoolean()
  allowPromptEdit?: boolean;

  @IsOptional()
  @IsString()
  promptOverride?: string;

  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(40000)
  sourceTextCharBudget?: number;
}

export class PipelineWorldviewGenerateDraftDto extends PipelineWorldviewPreviewDto {}

export class PipelineWorldviewPersistDto {
  @IsObject()
  draft!: Record<string, unknown>;
}
