import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsObject,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

/** narrator 可选的参考表白名单（与 getContext 支持的扩展表一致） */
export const allowedNarratorReferenceTables = [
  'set_core',
  'set_payoff_arch',
  'set_payoff_lines',
  'set_opponents',
  'set_power_ladder',
  'set_story_phases',
  'novel_characters',
  'novel_key_nodes',
  'novel_timelines',
  'novel_source_segments',
  'drama_source_text',
  'novel_adaptation_strategy',
  'drama_novels',
  'novel_explosions',
  'novel_skeleton_topics',
  'novel_skeleton_topic_items',
  'set_opponent_matrix',
  'set_traitor_system',
  'set_traitors',
  'set_traitor_stages',
] as const;

export type NarratorReferenceTable = (typeof allowedNarratorReferenceTables)[number];

export class NarratorScriptPreviewDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  modelKey?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  referenceTables?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  startEpisode?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  endEpisode?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @Max(120000)
  sourceTextCharBudget?: number;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  userInstruction?: string;

  @IsOptional()
  @IsBoolean()
  allowPromptEdit?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200000)
  promptOverride?: string;
}

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

  /** 参考表列表，不传则用 NARRATOR_DEFAULT_EXTENSION */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  referenceTables?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @Max(120000)
  sourceTextCharBudget?: number;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  userInstruction?: string;

  @IsOptional()
  @IsBoolean()
  allowPromptEdit?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200000)
  promptOverride?: string;
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
