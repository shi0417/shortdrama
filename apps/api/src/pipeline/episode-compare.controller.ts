import { Controller, Get, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { EpisodeCompareService } from './episode-compare.service';

@Controller('novels')
@UseGuards(JwtAuthGuard)
export class EpisodeCompareController {
  constructor(private readonly episodeCompareService: EpisodeCompareService) {}

  @Get(':novelId/episode-compare')
  getByNovel(@Param('novelId', ParseIntPipe) novelId: number) {
    return this.episodeCompareService.getByNovel(novelId);
  }
}
