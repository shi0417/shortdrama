import { IsOptional, IsString, IsInt } from 'class-validator';
import { Type } from 'class-transformer';

export class QueryThemeDto {
  @IsOptional()
  @IsString()
  categoryMain?: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  hotLevel?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  isHotTrack?: number;
}
