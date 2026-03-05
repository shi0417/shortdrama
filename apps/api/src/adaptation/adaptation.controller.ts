import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdaptationService } from './adaptation.service';
import { CreateAdaptationStrategyDto } from './dto/create-adaptation-strategy.dto';
import { UpdateAdaptationStrategyDto } from './dto/update-adaptation-strategy.dto';

@Controller()
@UseGuards(JwtAuthGuard)
export class AdaptationController {
  constructor(private readonly adaptationService: AdaptationService) {}

  @Get('adaptation-modes')
  listModes(@Query('all') all?: string) {
    const onlyActive = all !== '1';
    return this.adaptationService.listModes(onlyActive);
  }

  @Get('novels/:novelId/adaptation-strategies')
  listNovelStrategies(@Param('novelId', ParseIntPipe) novelId: number) {
    return this.adaptationService.listNovelStrategies(novelId);
  }

  @Post('novels/:novelId/adaptation-strategies')
  createNovelStrategy(
    @Param('novelId', ParseIntPipe) novelId: number,
    @Body() dto: CreateAdaptationStrategyDto,
  ) {
    return this.adaptationService.createNovelStrategy(novelId, dto);
  }

  @Patch('adaptation-strategies/:id')
  updateStrategy(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAdaptationStrategyDto,
  ) {
    return this.adaptationService.updateStrategy(id, dto);
  }

  @Delete('adaptation-strategies/:id')
  deleteStrategy(@Param('id', ParseIntPipe) id: number) {
    return this.adaptationService.deleteStrategy(id);
  }
}
