import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const allowedReferenceTables = [
  'drama_source_text',
  'novel_timelines',
  'novel_characters',
  'novel_key_nodes',
  'novel_skeleton_topics',
  'novel_skeleton_topic_items',
  'novel_explosions',
  'novel_adaptation_strategy',
  'adaptation_modes',
] as const;

export type AllowedReferenceTable = (typeof allowedReferenceTables)[number];

export class EnhanceSetCoreCurrentFieldsDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  protagonistName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  protagonistIdentity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  targetStory?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  rewriteGoal?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  constraintText?: string;
}

export class EnhanceSetCoreDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  modelKey?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(allowedReferenceTables, { each: true })
  referenceTables?: AllowedReferenceTable[];

  @IsOptional()
  @IsString()
  currentCoreText?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => EnhanceSetCoreCurrentFieldsDto)
  currentFields?: EnhanceSetCoreCurrentFieldsDto;

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
