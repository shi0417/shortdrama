import { IsString } from 'class-validator';

export class UpdateSourceTextDto {
  @IsString()
  sourceText: string;
}
