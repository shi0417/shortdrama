import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export const allowedSecondReviewTargetTables = [
  'novel_timelines',
  'novel_characters',
  'novel_key_nodes',
  'novel_skeleton_topic_items',
  'novel_explosions',
] as const;

export const allowedSecondReviewReferenceTables = [
  'drama_novels',
  'drama_source_text',
  'novel_adaptation_strategy',
  'adaptation_modes',
  'set_core',
] as const;

export type PipelineSecondReviewTargetTable =
  (typeof allowedSecondReviewTargetTables)[number];
export type PipelineSecondReviewReferenceTable =
  (typeof allowedSecondReviewReferenceTables)[number];

export class PipelineSecondReviewDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  modelKey?: string;

  @IsArray()
  @ArrayUnique()
  @IsIn(allowedSecondReviewTargetTables, { each: true })
  targetTables!: PipelineSecondReviewTargetTable[];

  @IsArray()
  @ArrayUnique()
  @IsIn(allowedSecondReviewReferenceTables, { each: true })
  referenceTables!: PipelineSecondReviewReferenceTable[];

  @IsOptional()
  @IsString()
  userInstruction?: string;

  @IsOptional()
  @IsBoolean()
  allowPromptEdit?: boolean;

  @IsOptional()
  @IsString()
  promptOverride?: string;
}
