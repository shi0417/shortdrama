import {
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Body,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { EpisodeStoryVersionService } from './episode-story-version.service';
import {
  CreateEpisodeStoryVersionDto,
  UpdateEpisodeStoryVersionDto,
} from './dto/episode-story-version.dto';

@Controller()
@UseGuards(JwtAuthGuard)
export class EpisodeStoryVersionController {
  constructor(
    private readonly storyVersionService: EpisodeStoryVersionService,
  ) {}

  @Get('novels/:novelId/episode-story-versions')
  listStoryVersions(@Param('novelId', ParseIntPipe) novelId: number) {
    return this.storyVersionService.listByNovel(novelId);
  }

  @Get('novels/:novelId/episode-story-versions/:episodeNumber/active')
  getActiveStoryVersion(
    @Param('novelId', ParseIntPipe) novelId: number,
    @Param('episodeNumber', ParseIntPipe) episodeNumber: number,
  ) {
    return this.storyVersionService.getActiveByNovelAndEpisode(
      novelId,
      episodeNumber,
    );
  }

  @Get('novels/:novelId/episode-story-versions/:episodeNumber')
  getStoryVersionsByEpisode(
    @Param('novelId', ParseIntPipe) novelId: number,
    @Param('episodeNumber', ParseIntPipe) episodeNumber: number,
  ) {
    return this.storyVersionService.getByNovelAndEpisode(
      novelId,
      episodeNumber,
    );
  }

  @Post('novels/:novelId/episode-story-versions')
  createStoryVersion(
    @Param('novelId', ParseIntPipe) novelId: number,
    @Body() dto: CreateEpisodeStoryVersionDto,
  ) {
    return this.storyVersionService.create(novelId, dto);
  }

  @Patch('episode-story-versions/:id')
  updateStoryVersion(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateEpisodeStoryVersionDto,
  ) {
    return this.storyVersionService.update(id, dto);
  }

  @Post('episode-story-versions/:id/set-active')
  setActiveStoryVersion(@Param('id', ParseIntPipe) id: number) {
    return this.storyVersionService.setActive(id);
  }

  @Delete('episode-story-versions/:id')
  removeStoryVersion(@Param('id', ParseIntPipe) id: number) {
    return this.storyVersionService.remove(id);
  }
}
