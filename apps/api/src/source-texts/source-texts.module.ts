import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SourceTextsController } from './source-texts.controller';
import { SourceTextsService } from './source-texts.service';
import { DramaSourceText } from '../entities/drama-source-text.entity';

@Module({
  imports: [TypeOrmModule.forFeature([DramaSourceText])],
  controllers: [SourceTextsController],
  providers: [SourceTextsService],
})
export class SourceTextsModule {}
