import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SourceTextsController } from './source-texts.controller';
import { SourceTextsService } from './source-texts.service';
import { DramaSourceText } from '../entities/drama-source-text.entity';
import { NovelSourceSegment } from '../entities/novel-source-segment.entity';
import { SourceSegmentationService } from './source-segmentation.service';
import { SourceRetrievalService } from './source-retrieval.service';

@Module({
  imports: [TypeOrmModule.forFeature([DramaSourceText, NovelSourceSegment])],
  controllers: [SourceTextsController],
  providers: [SourceTextsService, SourceSegmentationService, SourceRetrievalService],
  exports: [SourceTextsService, SourceSegmentationService, SourceRetrievalService],
})
export class SourceTextsModule {}
