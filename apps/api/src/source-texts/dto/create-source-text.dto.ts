import { IsOptional, IsString } from 'class-validator';

export class CreateSourceTextDto {
  @IsOptional()
  @IsString()
  sourceText?: string;
}
