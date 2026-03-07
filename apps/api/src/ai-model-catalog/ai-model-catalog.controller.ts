import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AiModelCatalogService } from './ai-model-catalog.service';

@Controller('ai-model-catalog')
@UseGuards(JwtAuthGuard)
export class AiModelCatalogController {
  constructor(private readonly aiModelCatalogService: AiModelCatalogService) {}

  @Get('options')
  listOptions() {
    return this.aiModelCatalogService.listOptions();
  }
}
