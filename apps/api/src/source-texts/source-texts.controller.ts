import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { SourceTextsService } from './source-texts.service';
import { CreateSourceTextDto } from './dto/create-source-text.dto';
import { UpdateSourceTextDto } from './dto/update-source-text.dto';
import { GenerateSourceSegmentsDto } from './dto/source-segments.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SourceSegmentationService } from './source-segmentation.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class SourceTextsController {
  constructor(
    private readonly sourceTextsService: SourceTextsService,
    private readonly sourceSegmentationService: SourceSegmentationService,
  ) {}

  @Get('novels/:novelId/source-texts')
  findByNovelId(@Param('novelId', ParseIntPipe) novelId: number) {
    return this.sourceTextsService.findByNovelId(novelId);
  }

  @Post('novels/:novelId/source-texts')
  create(
    @Param('novelId', ParseIntPipe) novelId: number,
    @Body() createDto: CreateSourceTextDto,
  ) {
    return this.sourceTextsService.create(novelId, createDto);
  }

  @Post('novels/:novelId/source-segments/generate')
  generateSegments(
    @Param('novelId', ParseIntPipe) novelId: number,
    @Body() dto: GenerateSourceSegmentsDto,
  ) {
    void dto;
    return this.sourceSegmentationService.generateSegments(novelId);
  }

  @Get('novels/:novelId/source-segments/summary')
  getSourceSegmentsSummary(@Param('novelId', ParseIntPipe) novelId: number) {
    return this.sourceSegmentationService.getSummary(novelId);
  }

  @Get('source-texts/:id')
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @Query('mode') mode?: string,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.sourceTextsService.findOne(id, mode, offset, limit);
  }

  @Patch('source-texts/:id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateDto: UpdateSourceTextDto,
  ) {
    return this.sourceTextsService.update(id, updateDto);
  }

  @Delete('source-texts/:id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.sourceTextsService.remove(id);
  }
}
