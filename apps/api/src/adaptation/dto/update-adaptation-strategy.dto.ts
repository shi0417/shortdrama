import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateAdaptationStrategyDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  modeId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  strategyTitle?: string;

  @IsOptional()
  @IsString()
  strategyDescription?: string;

  @IsOptional()
  @IsString()
  aiPromptTemplate?: string;
}
