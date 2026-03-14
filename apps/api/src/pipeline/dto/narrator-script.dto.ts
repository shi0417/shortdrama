import { IsInt, IsOptional, IsObject, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class NarratorScriptGenerateDraftDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  targetEpisodeCount?: number;
}

export class NarratorScriptPersistDto {
  @IsOptional()
  @IsString()
  draftId?: string;

  @IsOptional()
  @IsObject()
  draft?: NarratorScriptDraftPayload;
}

export interface NarratorScriptShotPromptDraft {
  promptType: string;
  promptText: string;
  negativePrompt?: string;
  modelName?: string;
  stylePreset?: string;
}

export interface NarratorScriptShotDraft {
  shotNo: number;
  shotType?: string;
  visualDesc: string;
  narratorText?: string;
  dialogueText?: string;
  subtitleText?: string;
  durationSec?: number;
  cameraMovement?: string;
  emotionTag?: string;
  prompts?: NarratorScriptShotPromptDraft[];
}

export interface NarratorScriptSceneDraft {
  sceneNo: number;
  sceneTitle: string;
  locationName?: string;
  sceneSummary?: string;
  mainConflict?: string;
  narratorText?: string;
  screenSubtitle?: string;
  estimatedSeconds?: number;
  shots: NarratorScriptShotDraft[];
}

export interface NarratorScriptVersionDraft {
  episodeNumber: number;
  title: string;
  summary: string;
  scriptType: string;
  scenes: NarratorScriptSceneDraft[];
}

export interface NarratorScriptDraftPayload {
  scripts: NarratorScriptVersionDraft[];
}
