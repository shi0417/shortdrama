import { IsBoolean, IsOptional } from 'class-validator';

export class GenerateSourceSegmentsDto {
  @IsOptional()
  @IsBoolean()
  forceRegenerate?: boolean;
}
