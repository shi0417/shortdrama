import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateSkeletonTopicDto } from './dto/create-skeleton-topic.dto';
import { UpdateSkeletonTopicDto } from './dto/update-skeleton-topic.dto';
import { SkeletonTopicsService } from './skeleton-topics.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class SkeletonTopicsController {
  constructor(private readonly skeletonTopicsService: SkeletonTopicsService) {}

  @Get('novels/:novelId/skeleton-topics')
  listByNovel(@Param('novelId', ParseIntPipe) novelId: number) {
    return this.skeletonTopicsService.listByNovel(novelId);
  }

  @Post('novels/:novelId/skeleton-topics')
  create(
    @Param('novelId', ParseIntPipe) novelId: number,
    @Body() dto: CreateSkeletonTopicDto,
  ) {
    return this.skeletonTopicsService.create(novelId, dto);
  }

  @Patch('skeleton-topics/:id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSkeletonTopicDto,
  ) {
    return this.skeletonTopicsService.update(id, dto);
  }

  @Delete('skeleton-topics/:id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.skeletonTopicsService.remove(id);
  }

  @Get('skeleton-topics/:id/items')
  listItems(@Param('id', ParseIntPipe) id: number) {
    return this.skeletonTopicsService.listItemsByTopic(id);
  }
}
