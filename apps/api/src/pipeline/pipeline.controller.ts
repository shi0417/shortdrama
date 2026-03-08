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
import { PipelineReviewService } from './pipeline-review.service';

@Controller('pipeline')
@UseGuards(JwtAuthGuard)
export class PipelineController {
  constructor(
    private readonly pipelineService: PipelineService,
    private readonly pipelineExtractService: PipelineExtractService,
    private readonly pipelineReviewService: PipelineReviewService,
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
}
