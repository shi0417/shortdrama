import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EpisodesController } from './episodes.controller';
import { EpisodesService } from './episodes.service';
import { Episode } from '../entities/episode.entity';
import { DramaStructureTemplate } from '../entities/drama-structure-template.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Episode, DramaStructureTemplate])],
  controllers: [EpisodesController],
  providers: [EpisodesService],
})
export class EpisodesModule {}
