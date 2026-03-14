import { IsInt, IsOptional, IsObject, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class NarratorScriptGenerateDraftDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  targetEpisodeCount?: number;

  /** 起始集（含），与 endEpisode 一起限定范围；不传则从第 1 集起 */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  startEpisode?: number;

  /** 结束集（含）；不传则用 targetEpisodeCount 或全部 */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  endEpisode?: number;

  /** 每批 LLM 请求的集数，默认 5 */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  batchSize?: number;

  /** 生成模型 key，不传则用配置默认 */
  @IsOptional()
  @IsString()
  modelKey?: string;
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

export interface NarratorScriptDraftMeta {
  batchCount?: number;
}

export interface NarratorScriptDraftPayload {
  scripts: NarratorScriptVersionDraft[];
  meta?: NarratorScriptDraftMeta;
}
