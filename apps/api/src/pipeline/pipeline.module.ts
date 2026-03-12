import { Module } from '@nestjs/common';
import { PipelineController } from './pipeline.controller';
import { PipelineResourceController } from './pipeline-resource.controller';
import { PipelineService } from './pipeline.service';
import { PipelineExtractService } from './pipeline-extract.service';
import { PipelineReviewService } from './pipeline-review.service';
import { PipelineResourceService } from './pipeline-resource.service';
import { PipelineWorldviewService } from './pipeline-worldview.service';
import { PipelineEpisodeScriptService } from './pipeline-episode-script.service';
import { SourceTextsModule } from '../source-texts/source-texts.module';

@Module({
  imports: [SourceTextsModule],
  controllers: [PipelineController, PipelineResourceController],
  providers: [
    PipelineService,
    PipelineExtractService,
    PipelineReviewService,
    PipelineResourceService,
    PipelineWorldviewService,
    PipelineEpisodeScriptService,
  ],
})
export class PipelineModule {}
