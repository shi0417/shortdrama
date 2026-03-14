import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateEpisodeShotPromptDto {
  @IsString()
  @MaxLength(50)
  promptType: string;

  @IsString()
  promptText: string;

  @IsOptional()
  @IsString()
  negativePrompt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  modelName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  stylePreset?: string;
}

export class UpdateEpisodeShotPromptDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  promptType?: string;

  @IsOptional()
  @IsString()
  promptText?: string;

  @IsOptional()
  @IsString()
  negativePrompt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  modelName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  stylePreset?: string;
}
