import { IsInt, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

export const allowedPipelineResources = [
  'timelines',
  'characters',
  'key-nodes',
  'explosions',
  'skeleton-topics',
  'skeleton-topic-items',
] as const;

export type PipelineResourceName = (typeof allowedPipelineResources)[number];

export class PipelineResourceListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  topicId?: number;
}
