import {
  IsInt,
  IsOptional,
  IsString,
  IsIn,
  Min,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

const scriptTypes = ['outline', 'ai_video', 'narrator_video', 'final'] as const;
const statuses = ['draft', 'approved', 'locked'] as const;

export class CreateEpisodeScriptVersionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  episodeNumber: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sourceEpisodeId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  versionNo?: number;

  @IsString()
  @IsIn(scriptTypes)
  scriptType: (typeof scriptTypes)[number];

  @IsString()
  @MaxLength(255)
  title: string;

  @IsOptional()
  @IsString()
  summary?: string;

  @IsOptional()
  @IsString()
  @IsIn(statuses)
  status?: (typeof statuses)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  isActive?: number;
}

export class UpdateEpisodeScriptVersionDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sourceEpisodeId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  versionNo?: number;

  @IsOptional()
  @IsString()
  @IsIn(scriptTypes)
  scriptType?: (typeof scriptTypes)[number];

  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  summary?: string;

  @IsOptional()
  @IsString()
  @IsIn(statuses)
  status?: (typeof statuses)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  isActive?: number;
}
