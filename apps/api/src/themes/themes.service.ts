import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiShortDramaTheme } from '../entities/ai-short-drama-theme.entity';
import { QueryThemeDto } from './dto/query-theme.dto';

@Injectable()
export class ThemesService {
  constructor(
    @InjectRepository(AiShortDramaTheme)
    private themesRepository: Repository<AiShortDramaTheme>,
  ) {}

  async findAll(query: QueryThemeDto) {
    const where: any = {};

    if (query.categoryMain) {
      where.categoryMain = query.categoryMain;
    }

    if (query.hotLevel !== undefined) {
      where.hotLevel = query.hotLevel;
    }

    if (query.isHotTrack !== undefined) {
      where.isHotTrack = query.isHotTrack;
    }

    return this.themesRepository.find({
      where,
      order: { hotLevel: 'DESC', id: 'ASC' },
    });
  }
}
