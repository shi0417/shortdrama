import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PipelineService } from './pipeline.service';
import { PipelineExtractService } from './pipeline-extract.service';
import { PipelineExtractDto } from './dto/pipeline-extract.dto';
import { PipelineSecondReviewDto } from './dto/pipeline-second-review.dto';
import {
  PipelineEpisodeScriptGenerateDraftDto,
  PipelineEpisodeScriptPersistDto,
  PipelineEpisodeScriptPreviewDto,
} from './dto/pipeline-episode-script.dto';
import {
  PipelineWorldviewGenerateDraftDto,
  PipelineWorldviewPersistDto,
  PipelineWorldviewPreviewDto,
} from './dto/pipeline-worldview.dto';
import { PipelineReviewService } from './pipeline-review.service';
import { PipelineEpisodeScriptService } from './pipeline-episode-script.service';
import { PipelineWorldviewService } from './pipeline-worldview.service';

@Controller('pipeline')
@UseGuards(JwtAuthGuard)
export class PipelineController {
  constructor(
    private readonly pipelineService: PipelineService,
    private readonly pipelineExtractService: PipelineExtractService,
    private readonly pipelineReviewService: PipelineReviewService,
    private readonly pipelineWorldviewService: PipelineWorldviewService,
    private readonly pipelineEpisodeScriptService: PipelineEpisodeScriptService,
  ) {}

  @Get(':novelId/overview')
  getOverview(@Param('novelId', ParseIntPipe) novelId: number) {
    return this.pipelineService.getOverview(novelId);
  }

  @Post(':novelId/extract-preview-prompt')
  previewExtractPrompt(
    @Param('novelId', ParseIntPipe) novelId: number,
    @Body() dto: PipelineExtractDto,
  ) {
    return this.pipelineExtractService.previewPrompt(novelId, dto);
  }

  @Post(':novelId/extract-and-generate')
  extractAndGenerate(
    @Param('novelId', ParseIntPipe) novelId: number,
    @Body() dto: PipelineExtractDto,
  ) {
    return this.pipelineExtractService.extractAndGenerate(novelId, dto);
  }

  @Post(':novelId/review-preview-prompt')
  previewReviewPrompt(
    @Param('novelId', ParseIntPipe) novelId: number,
    @Body() dto: PipelineSecondReviewDto,
  ) {
    return this.pipelineReviewService.previewPrompt(novelId, dto);
  }

  @Post(':novelId/review-and-correct')
  reviewAndCorrect(
    @Param('novelId', ParseIntPipe) novelId: number,
    @Body() dto: PipelineSecondReviewDto,
  ) {
    return this.pipelineReviewService.reviewAndCorrect(novelId, dto);
  }

  @Post(':novelId/worldview-preview-prompt')
  previewWorldviewPrompt(
    @Param('novelId', ParseIntPipe) novelId: number,
    @Body() dto: PipelineWorldviewPreviewDto,
  ) {
    return this.pipelineWorldviewService.previewPrompt(novelId, dto);
  }

  @Post(':novelId/worldview-generate-draft')
  generateWorldviewDraft(
    @Param('novelId', ParseIntPipe) novelId: number,
    @Body() dto: PipelineWorldviewGenerateDraftDto,
  ) {
    return this.pipelineWorldviewService.generateDraft(novelId, dto);
  }

  @Post(':novelId/worldview-persist')
  persistWorldviewDraft(
    @Param('novelId', ParseIntPipe) novelId: number,
    @Body() dto: PipelineWorldviewPersistDto,
  ) {
    return this.pipelineWorldviewService.persistDraft(novelId, dto);
  }

  @Post(':novelId/episode-script-preview-prompt')
  previewEpisodeScriptPrompt(
    @Param('novelId', ParseIntPipe) novelId: number,
    @Body() dto: PipelineEpisodeScriptPreviewDto,
  ) {
    return this.pipelineEpisodeScriptService.previewPrompt(novelId, dto);
  }

  @Post(':novelId/episode-script-generate-draft')
  generateEpisodeScriptDraft(
    @Param('novelId', ParseIntPipe) novelId: number,
    @Body() dto: PipelineEpisodeScriptGenerateDraftDto,
  ) {
    return this.pipelineEpisodeScriptService.generateDraft(novelId, dto);
  }

  @Post(':novelId/episode-script-persist')
  persistEpisodeScriptDraft(
    @Param('novelId', ParseIntPipe) novelId: number,
    @Body() dto: PipelineEpisodeScriptPersistDto,
  ) {
    return this.pipelineEpisodeScriptService.persistDraft(novelId, dto);
  }
}
