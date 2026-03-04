import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThemesController } from './themes.controller';
import { ThemesService } from './themes.service';
import { AiShortDramaTheme } from '../entities/ai-short-drama-theme.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AiShortDramaTheme])],
  controllers: [ThemesController],
  providers: [ThemesService],
})
export class ThemesModule {}
