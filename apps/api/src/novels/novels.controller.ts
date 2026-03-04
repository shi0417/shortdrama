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
import { NovelsService } from './novels.service';
import { CreateNovelDto } from './dto/create-novel.dto';
import { UpdateNovelDto } from './dto/update-novel.dto';
import { QueryNovelDto } from './dto/query-novel.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('novels')
@UseGuards(JwtAuthGuard)
export class NovelsController {
  constructor(private readonly novelsService: NovelsService) {}

  @Get()
  findAll(@Query() query: QueryNovelDto) {
    return this.novelsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.novelsService.findOne(id);
  }

  @Post()
  create(@Body() createNovelDto: CreateNovelDto) {
    return this.novelsService.create(createNovelDto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateNovelDto: UpdateNovelDto,
  ) {
    return this.novelsService.update(id, updateNovelDto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.novelsService.remove(id);
  }
}
