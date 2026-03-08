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

@Controller('pipeline')
@UseGuards(JwtAuthGuard)
export class PipelineController {
  constructor(
    private readonly pipelineService: PipelineService,
    private readonly pipelineExtractService: PipelineExtractService,
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
}
