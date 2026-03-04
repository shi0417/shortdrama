import { Controller, Get, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PipelineService } from './pipeline.service';

@Controller('pipeline')
@UseGuards(JwtAuthGuard)
export class PipelineController {
  constructor(private readonly pipelineService: PipelineService) {}

  @Get(':novelId/overview')
  getOverview(@Param('novelId', ParseIntPipe) novelId: number) {
    return this.pipelineService.getOverview(novelId);
  }
}
