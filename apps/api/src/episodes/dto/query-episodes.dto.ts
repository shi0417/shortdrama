import { Transform } from 'class-transformer';
import { IsInt, IsOptional } from 'class-validator';

export class QueryEpisodesDto {
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  novelId?: number;
}
