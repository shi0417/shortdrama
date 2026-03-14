import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateEpisodeShotDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  shotNo: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  shotType?: string;

  @IsString()
  visualDesc: string;

  @IsOptional()
  @IsString()
  narratorText?: string;

  @IsOptional()
  @IsString()
  dialogueText?: string;

  @IsOptional()
  @IsString()
  subtitleText?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  durationSec?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  cameraMovement?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  emotionTag?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateEpisodeShotDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  shotNo?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  shotType?: string;

  @IsOptional()
  @IsString()
  visualDesc?: string;

  @IsOptional()
  @IsString()
  narratorText?: string;

  @IsOptional()
  @IsString()
  dialogueText?: string;

  @IsOptional()
  @IsString()
  subtitleText?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  durationSec?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  cameraMovement?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  emotionTag?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
