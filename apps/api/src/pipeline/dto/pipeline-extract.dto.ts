import { ArrayUnique, IsArray, IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

const allowedReferenceTables = [
  'drama_novels',
  'drama_source_text',
  'novel_adaptation_strategy',
  'adaptation_modes',
  'set_core',
] as const;

export type PipelineExtractReferenceTable = (typeof allowedReferenceTables)[number];

export class PipelineExtractDto {
  @IsString()
  @MaxLength(255)
  modelKey!: string;

  @IsArray()
  @ArrayUnique()
  @IsIn(allowedReferenceTables, { each: true })
  referenceTables!: PipelineExtractReferenceTable[];

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
