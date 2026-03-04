import { IsString, IsOptional, IsInt, Min, Max } from 'class-validator';

export class UpdateNovelDto {
  @IsOptional()
  @IsString()
  novelsName?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  totalChapters?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  powerUpInterval?: number;

  @IsOptional()
  @IsString()
  author?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2)
  status?: number;

  @IsOptional()
  @IsInt()
  themeId?: number;
}
