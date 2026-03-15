import { Module } from '@nestjs/common';
import { PipelineController } from './pipeline.controller';
import { PipelineResourceController } from './pipeline-resource.controller';
import { EpisodeCompareController } from './episode-compare.controller';
import { EpisodeScriptProductionController } from './episode-script-production.controller';
import { EpisodeStoryVersionController } from './episode-story-version.controller';
import { PipelineService } from './pipeline.service';
import { PipelineExtractService } from './pipeline-extract.service';
import { PipelineReviewService } from './pipeline-review.service';
import { PipelineResourceService } from './pipeline-resource.service';
import { PipelineWorldviewService } from './pipeline-worldview.service';
import { PipelineEpisodeScriptService } from './pipeline-episode-script.service';
import { EpisodeCompareService } from './episode-compare.service';
import { EpisodeScriptVersionService } from './episode-script-version.service';
import { EpisodeSceneService } from './episode-scene.service';
import { EpisodeShotService } from './episode-shot.service';
import { EpisodeShotPromptService } from './episode-shot-prompt.service';
import { EpisodeStoryVersionService } from './episode-story-version.service';
import { NarratorScriptService } from './narrator-script.service';
import { EpisodeStoryGenerationService } from './episode-story-generation.service';
import { PipelineReferenceContextService } from './pipeline-reference-context.service';
import { MaterialSiftingService } from './material-sifting.service';
import { SourceTextsModule } from '../source-texts/source-texts.module';

@Module({
  imports: [SourceTextsModule],
  controllers: [
    PipelineController,
    PipelineResourceController,
    EpisodeCompareController,
    EpisodeScriptProductionController,
    EpisodeStoryVersionController,
  ],
  providers: [
    PipelineService,
    PipelineExtractService,
    PipelineReviewService,
    PipelineResourceService,
    PipelineWorldviewService,
    PipelineReferenceContextService,
    MaterialSiftingService,
    PipelineEpisodeScriptService,
    EpisodeCompareService,
    EpisodeScriptVersionService,
    EpisodeSceneService,
    EpisodeShotService,
    EpisodeShotPromptService,
    EpisodeStoryVersionService,
    EpisodeStoryGenerationService,
    NarratorScriptService,
  ],
  exports: [MaterialSiftingService],
})
export class PipelineModule {}
