import { Module } from '@nestjs/common';
import { PipelineController } from './pipeline.controller';
import { PipelineService } from './pipeline.service';
import { PipelineExtractService } from './pipeline-extract.service';
import { PipelineReviewService } from './pipeline-review.service';

@Module({
  controllers: [PipelineController],
  providers: [PipelineService, PipelineExtractService, PipelineReviewService],
})
export class PipelineModule {}
