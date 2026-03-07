import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SetCoreService } from './set-core.service';
import { UpsertSetCoreDto } from './dto/upsert-set-core.dto';
import { EnhanceSetCoreDto } from './dto/enhance-set-core.dto';

@Controller()
@UseGuards(JwtAuthGuard)
export class SetCoreController {
  private readonly validationPipe = new ValidationPipe({
    transform: true,
    whitelist: false,
  });

  constructor(private readonly setCoreService: SetCoreService) {}

  @Get('novels/:novelId/set-core')
  getActiveSetCore(@Param('novelId', ParseIntPipe) novelId: number) {
    return this.setCoreService.getActiveSetCore(novelId);
  }

  @Get('novels/:novelId/set-core/versions')
  listSetCoreVersions(@Param('novelId', ParseIntPipe) novelId: number) {
    return this.setCoreService.listSetCoreVersions(novelId);
  }

  @Post('novels/:novelId/set-core*')
  async handleSetCorePost(
    @Param('novelId', ParseIntPipe) novelId: number,
    @Body() body: unknown,
    @Req() request: { path: string },
  ) {
    const path = request.path;

    if (path.endsWith('/set-core:enhance-preview-prompt')) {
      const dto = (await this.validationPipe.transform(body, {
        type: 'body',
        metatype: EnhanceSetCoreDto,
      })) as EnhanceSetCoreDto;

      return this.setCoreService.previewEnhancePrompt(novelId, dto);
    }

    if (path.endsWith('/set-core:enhance')) {
      const dto = (await this.validationPipe.transform(body, {
        type: 'body',
        metatype: EnhanceSetCoreDto,
      })) as EnhanceSetCoreDto;

      return this.setCoreService.enhanceSetCore(novelId, dto);
    }

    if (path.endsWith('/set-core:upsert')) {
      const dto = (await this.validationPipe.transform(body, {
        type: 'body',
        metatype: UpsertSetCoreDto,
      })) as UpsertSetCoreDto;

      return this.setCoreService.upsertSetCore(novelId, dto);
    }

    throw new BadRequestException(`Unsupported set_core action path: ${path}`);
  }

  @Post('set-core/:id/activate')
  activateVersion(@Param('id', ParseIntPipe) id: number) {
    return this.setCoreService.activateVersion(id);
  }

  @Delete('set-core/:id')
  deleteSetCore(@Param('id', ParseIntPipe) id: number) {
    return this.setCoreService.deleteSetCore(id);
  }
}
