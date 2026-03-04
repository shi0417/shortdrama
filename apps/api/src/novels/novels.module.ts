import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NovelsController } from './novels.controller';
import { NovelsService } from './novels.service';
import { DramaNovel } from '../entities/drama-novel.entity';

@Module({
  imports: [TypeOrmModule.forFeature([DramaNovel])],
  controllers: [NovelsController],
  providers: [NovelsService],
})
export class NovelsModule {}
