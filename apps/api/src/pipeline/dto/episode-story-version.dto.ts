import {
  IsInt,
  IsOptional,
  IsString,
  IsIn,
  Min,
  MaxLength,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';

const storyTypes = ['story_text', 'longform', 'revised'] as const;
const statuses = ['draft', 'approved', 'locked'] as const;
const generationSources = ['ai', 'manual', 'mixed'] as const;

export class CreateEpisodeStoryVersionDto {
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
  @IsIn(storyTypes)
  storyType: (typeof storyTypes)[number];

  @IsString()
  @MaxLength(255)
  title: string;

  @IsOptional()
  @IsString()
  summary?: string;

  @IsString()
  storyText: string;

  @IsOptional()
  @IsObject()
  storyBeatJson?: Record<string, unknown>;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  wordCount?: number;

  @IsOptional()
  @IsString()
  @IsIn(statuses)
  status?: (typeof statuses)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  isActive?: number;

  @IsOptional()
  @IsString()
  @IsIn(generationSources)
  generationSource?: (typeof generationSources)[number];

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateEpisodeStoryVersionDto {
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
  @IsIn(storyTypes)
  storyType?: (typeof storyTypes)[number];

  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  summary?: string;

  @IsOptional()
  @IsString()
  storyText?: string;

  @IsOptional()
  @IsObject()
  storyBeatJson?: Record<string, unknown>;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  wordCount?: number;

  @IsOptional()
  @IsString()
  @IsIn(statuses)
  status?: (typeof statuses)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  isActive?: number;

  @IsOptional()
  @IsString()
  @IsIn(generationSources)
  generationSource?: (typeof generationSources)[number];

  @IsOptional()
  @IsString()
  notes?: string;
}
