import { IsInt, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

export const allowedPipelineResources = [
  'timelines',
  'characters',
  'key-nodes',
  'explosions',
  'episodes',
  'structure-templates',
  'hook-rhythms',
  'skeleton-topics',
  'skeleton-topic-items',
  'payoff-arch',
  'payoff-lines',
  'opponent-matrix',
  'opponents',
  'power-ladder',
  'traitor-system',
  'traitors',
  'traitor-stages',
  'story-phases',
  'character-visual-profiles',
] as const;

export type PipelineResourceName = (typeof allowedPipelineResources)[number];

export class PipelineResourceListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  topicId?: number;
}
