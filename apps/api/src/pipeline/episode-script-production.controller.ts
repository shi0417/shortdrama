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
import { EpisodeScriptVersionService } from './episode-script-version.service';
import { EpisodeSceneService } from './episode-scene.service';
import { EpisodeShotService } from './episode-shot.service';
import { EpisodeShotPromptService } from './episode-shot-prompt.service';
import {
  CreateEpisodeScriptVersionDto,
  UpdateEpisodeScriptVersionDto,
} from './dto/episode-script-version.dto';
import {
  CreateEpisodeSceneDto,
  UpdateEpisodeSceneDto,
} from './dto/episode-scene.dto';
import {
  CreateEpisodeShotDto,
  UpdateEpisodeShotDto,
} from './dto/episode-shot.dto';
import {
  CreateEpisodeShotPromptDto,
  UpdateEpisodeShotPromptDto,
} from './dto/episode-shot-prompt.dto';

@Controller()
@UseGuards(JwtAuthGuard)
export class EpisodeScriptProductionController {
  constructor(
    private readonly scriptVersionService: EpisodeScriptVersionService,
    private readonly sceneService: EpisodeSceneService,
    private readonly shotService: EpisodeShotService,
    private readonly shotPromptService: EpisodeShotPromptService,
  ) {}

  @Get('novels/:novelId/episode-script-versions')
  listScriptVersions(@Param('novelId', ParseIntPipe) novelId: number) {
    return this.scriptVersionService.listByNovel(novelId);
  }

  @Get('novels/:novelId/episode-script-versions/summary')
  listScriptVersionSummary(@Param('novelId', ParseIntPipe) novelId: number) {
    return this.scriptVersionService.listSummaryByNovel(novelId);
  }

  @Get('novels/:novelId/episode-script-versions/:episodeNumber')
  getScriptVersionsByEpisode(
    @Param('novelId', ParseIntPipe) novelId: number,
    @Param('episodeNumber', ParseIntPipe) episodeNumber: number,
  ) {
    return this.scriptVersionService.getByNovelAndEpisode(
      novelId,
      episodeNumber,
    );
  }

  @Post('novels/:novelId/episode-script-versions')
  createScriptVersion(
    @Param('novelId', ParseIntPipe) novelId: number,
    @Body() dto: CreateEpisodeScriptVersionDto,
  ) {
    return this.scriptVersionService.create(novelId, dto);
  }

  @Patch('episode-script-versions/:id')
  updateScriptVersion(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateEpisodeScriptVersionDto,
  ) {
    return this.scriptVersionService.update(id, dto);
  }

  @Post('episode-script-versions/:id/set-active')
  setActiveScriptVersion(@Param('id', ParseIntPipe) id: number) {
    return this.scriptVersionService.setActive(id);
  }

  @Delete('episode-script-versions/:id')
  removeScriptVersion(@Param('id', ParseIntPipe) id: number) {
    return this.scriptVersionService.remove(id);
  }

  @Get('episode-script-versions/:scriptVersionId/scenes')
  listScenes(
    @Param('scriptVersionId', ParseIntPipe) scriptVersionId: number,
  ) {
    return this.sceneService.listByScriptVersion(scriptVersionId);
  }

  @Post('episode-script-versions/:scriptVersionId/scenes')
  createScene(
    @Param('scriptVersionId', ParseIntPipe) scriptVersionId: number,
    @Body() dto: CreateEpisodeSceneDto,
  ) {
    return this.sceneService.create(scriptVersionId, dto);
  }

  @Patch('episode-scenes/:id')
  updateScene(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateEpisodeSceneDto,
  ) {
    return this.sceneService.update(id, dto);
  }

  @Delete('episode-scenes/:id')
  removeScene(@Param('id', ParseIntPipe) id: number) {
    return this.sceneService.remove(id);
  }

  @Get('episode-scenes/:sceneId/shots')
  listShots(@Param('sceneId', ParseIntPipe) sceneId: number) {
    return this.shotService.listByScene(sceneId);
  }

  @Post('episode-scenes/:sceneId/shots')
  createShot(
    @Param('sceneId', ParseIntPipe) sceneId: number,
    @Body() dto: CreateEpisodeShotDto,
  ) {
    return this.shotService.create(sceneId, dto);
  }

  @Patch('episode-shots/:id')
  updateShot(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateEpisodeShotDto,
  ) {
    return this.shotService.update(id, dto);
  }

  @Delete('episode-shots/:id')
  removeShot(@Param('id', ParseIntPipe) id: number) {
    return this.shotService.remove(id);
  }

  @Get('episode-shots/:shotId/prompts')
  listPrompts(@Param('shotId', ParseIntPipe) shotId: number) {
    return this.shotPromptService.listByShot(shotId);
  }

  @Post('episode-shots/:shotId/prompts')
  createPrompt(
    @Param('shotId', ParseIntPipe) shotId: number,
    @Body() dto: CreateEpisodeShotPromptDto,
  ) {
    return this.shotPromptService.create(shotId, dto);
  }

  @Patch('episode-shot-prompts/:id')
  updatePrompt(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateEpisodeShotPromptDto,
  ) {
    return this.shotPromptService.update(id, dto);
  }

  @Delete('episode-shot-prompts/:id')
  removePrompt(@Param('id', ParseIntPipe) id: number) {
    return this.shotPromptService.remove(id);
  }
}
