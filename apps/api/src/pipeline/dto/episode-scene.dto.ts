import { IsInt, IsOptional, IsString, Min, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateEpisodeSceneDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sceneNo: number;

  @IsString()
  @MaxLength(255)
  sceneTitle: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  locationName?: string;

  @IsOptional()
  @IsString()
  sceneSummary?: string;

  @IsOptional()
  @IsString()
  mainConflict?: string;

  @IsOptional()
  @IsString()
  narratorText?: string;

  @IsOptional()
  @IsString()
  screenSubtitle?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  estimatedSeconds?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateEpisodeSceneDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sceneNo?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  sceneTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  locationName?: string;

  @IsOptional()
  @IsString()
  sceneSummary?: string;

  @IsOptional()
  @IsString()
  mainConflict?: string;

  @IsOptional()
  @IsString()
  narratorText?: string;

  @IsOptional()
  @IsString()
  screenSubtitle?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  estimatedSeconds?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
