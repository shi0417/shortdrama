import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { Episode } from '../entities/episode.entity';
import { QueryEpisodesDto } from './dto/query-episodes.dto';
import { EpisodeResponseDto } from './dto/episode-response.dto';

@Injectable()
export class EpisodesService {
  constructor(
    @InjectRepository(Episode)
    private readonly episodesRepository: Repository<Episode>,
  ) {}

  async findAll(query: QueryEpisodesDto): Promise<EpisodeResponseDto[]> {
    const where: FindOptionsWhere<Episode> = {};

    if (query.novelId !== undefined) {
      where.novelId = query.novelId;
    }

    const episodes = await this.episodesRepository.find({
      where,
      relations: ['structureTemplate'],
      order: { episodeNumber: 'ASC' },
    });

    return episodes.map((episode) => this.toResponseDto(episode));
  }

  async findOne(id: number): Promise<EpisodeResponseDto> {
    const episode = await this.episodesRepository.findOne({
      where: { id },
      relations: ['structureTemplate'],
    });

    if (!episode) {
      throw new NotFoundException(`Episode with ID ${id} not found`);
    }

    return this.toResponseDto(episode);
  }

  private toResponseDto(episode: Episode): EpisodeResponseDto {
    return {
      id: episode.id,
      novelId: episode.novelId,
      episodeNumber: episode.episodeNumber,
      episodeTitle: episode.episodeTitle,
      arc: episode.arc,
      opening: episode.opening,
      coreConflict: episode.coreConflict,
      hooks: episode.hooks,
      cliffhanger: episode.cliffhanger,
      fullContent: episode.fullContent,
      outlineContent: episode.outlineContent,
      historyOutline: episode.historyOutline,
      rewriteDiff: episode.rewriteDiff,
      structureTemplateId: episode.structureTemplateId,
      sortOrder: episode.sortOrder,
      createdAt: episode.createdAt,
      structureTemplate: episode.structureTemplate
        ? {
            id: episode.structureTemplate.id,
            themeType: episode.structureTemplate.themeType,
            structureName: episode.structureTemplate.structureName,
            identityGap: episode.structureTemplate.identityGap,
            pressureSource: episode.structureTemplate.pressureSource,
            firstReverse: episode.structureTemplate.firstReverse,
            continuousUpgrade: episode.structureTemplate.continuousUpgrade,
            suspenseHook: episode.structureTemplate.suspenseHook,
            powerLevel: episode.structureTemplate.powerLevel,
            isPowerUpChapter: episode.structureTemplate.isPowerUpChapter,
            powerUpContent: episode.structureTemplate.powerUpContent,
          }
        : undefined,
    };
  }
}
