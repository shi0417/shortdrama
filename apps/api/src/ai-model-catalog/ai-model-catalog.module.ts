import { Module } from '@nestjs/common';
import { AiModelCatalogController } from './ai-model-catalog.controller';
import { AiModelCatalogService } from './ai-model-catalog.service';

@Module({
  controllers: [AiModelCatalogController],
  providers: [AiModelCatalogService],
  exports: [AiModelCatalogService],
})
export class AiModelCatalogModule {}
