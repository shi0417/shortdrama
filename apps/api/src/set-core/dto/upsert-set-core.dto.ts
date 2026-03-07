import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpsertSetCoreDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  coreText?: string;

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

  @IsOptional()
  @IsIn(['update_active', 'new_version'])
  mode?: 'update_active' | 'new_version';
}
