import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** 扩展参考表白名单，与 pipeline-reference-context EXTENDED_TABLE_CONFIG 及 adaptation_modes 对齐 */
export const allowedEpisodeStoryReferenceTables = [
  'drama_novels',
  'drama_source_text',
  'novel_adaptation_strategy',
  'adaptation_modes',
  'novel_characters',
  'novel_key_nodes',
  'novel_timelines',
  'novel_explosions',
  'novel_skeleton_topics',
  'novel_skeleton_topic_items',
  'novel_source_segments',
  'set_core',
  'set_payoff_arch',
  'set_payoff_lines',
  'set_opponent_matrix',
  'set_opponents',
  'set_power_ladder',
  'set_traitor_system',
  'set_traitors',
  'set_traitor_stages',
  'set_story_phases',
] as const;

export type EpisodeStoryReferenceTable =
  (typeof allowedEpisodeStoryReferenceTables)[number];

/** 单集草稿（含 planner 的 storyBeat，便于 persist 写入 story_beat_json） */
export interface EpisodeStoryDraftEpisode {
  episodeNumber: number;
  title?: string;
  summary?: string;
  storyText: string;
  /** 规划节拍，来自 planner；persist 时可写入 story_beat_json */
  storyBeat?: string;
  /** 用户反馈（反馈闭环预留）：用于存储用户对本集的修改意见，供自动重写代理参考 */
  userFeedback?: string;
}

/** 故事草稿 */
export interface EpisodeStoryDraft {
  episodes: EpisodeStoryDraftEpisode[];
}

export class EpisodeStoryPreviewDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  modelKey?: string;

  @IsArray()
  @ArrayUnique()
  @IsIn(allowedEpisodeStoryReferenceTables, { each: true })
  referenceTables!: EpisodeStoryReferenceTable[];

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

  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(120000)
  sourceTextCharBudget?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  targetEpisodeCount?: number;

  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(10)
  batchSize?: number;
}

export class EpisodeStoryGenerateDraftDto extends EpisodeStoryPreviewDto {}

export interface EpisodeStoryReferenceSummaryItem {
  table: string;
  label: string;
  rowCount: number;
  fields: string[];
}

export interface EpisodeStoryPreviewResponse {
  promptPreview: string;
  usedModelKey: string;
  referenceTables: EpisodeStoryReferenceTable[];
  referenceSummary: EpisodeStoryReferenceSummaryItem[];
  warnings?: string[];
}

export interface EpisodeStoryBatchInfo {
  batchIndex: number;
  range: string;
  success: boolean;
  episodeCount: number;
}

export interface EpisodeStoryGenerateDraftResponse {
  draftId: string;
  draft: EpisodeStoryDraft;
  usedModelKey: string;
  promptPreview?: string;
  referenceSummary?: EpisodeStoryReferenceSummaryItem[];
  targetEpisodeCount?: number;
  actualEpisodeCount?: number;
  countMismatchWarning?: string;
  warnings?: string[];
  batchInfo?: EpisodeStoryBatchInfo[];
  finalCompletenessOk?: boolean;
}

export class EpisodeStoryPersistDto {
  @IsOptional()
  @IsString()
  draftId?: string;

  @IsOptional()
  @IsObject()
  draft?: EpisodeStoryDraft;

  @IsOptional()
  @IsIn(['ai', 'manual'])
  generationMode?: 'ai' | 'manual';
}

export interface EpisodeStoryPersistResponse {
  ok: true;
  summary: { episodeNumbers: number[]; versionCount: number };
  warnings?: string[];
}

export class EpisodeStoryCheckDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  draftId?: string;

  @IsOptional()
  @IsObject()
  draft?: EpisodeStoryDraft;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  versionIds?: number[];

  @IsOptional()
  @IsArray()
  @IsIn(allowedEpisodeStoryReferenceTables, { each: true })
  referenceTables?: EpisodeStoryReferenceTable[];

  @IsOptional()
  @IsString()
  @MaxLength(100)
  modelKey?: string;
}

export interface StoryCheckReportEpisodeIssue {
  type: string;
  message: string;
  severity: 'low' | 'medium' | 'high';
}

export interface StoryCheckReportEpisodeItem {
  episodeNumber: number;
  issues: StoryCheckReportEpisodeIssue[];
}

export interface StoryCheckReportSuggestion {
  episodeNumber?: number;
  suggestion: string;
}

export interface StoryCheckReportDto {
  overallScore: number;
  passed: boolean;
  episodeIssues: StoryCheckReportEpisodeItem[];
  suggestions: StoryCheckReportSuggestion[];
  warnings?: string[];
}
