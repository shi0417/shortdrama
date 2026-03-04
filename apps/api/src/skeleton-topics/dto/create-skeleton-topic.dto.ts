import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  Min,
  Max,
} from 'class-validator';

export class CreateSkeletonTopicDto {
  @IsString()
  @Length(1, 64)
  @Matches(/^[a-z0-9_]+$/, {
    message: 'topicKey must contain only lowercase letters, numbers, and underscores',
  })
  topicKey: string;

  @IsString()
  @Length(1, 100)
  topicName: string;

  @IsString()
  @IsIn(['text', 'list', 'json'])
  topicType: 'text' | 'list' | 'json';

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1)
  isEnabled?: number;
}
