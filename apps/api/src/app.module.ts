import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { getDatabaseConfig } from './config/database.config';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { NovelsModule } from './novels/novels.module';
import { ThemesModule } from './themes/themes.module';
import { SourceTextsModule } from './source-texts/source-texts.module';
import { EpisodesModule } from './episodes/episodes.module';
import { PipelineModule } from './pipeline/pipeline.module';
import { SkeletonTopicsModule } from './skeleton-topics/skeleton-topics.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRootAsync({
      useFactory: getDatabaseConfig,
    }),
    AuthModule,
    HealthModule,
    NovelsModule,
    ThemesModule,
    SourceTextsModule,
    EpisodesModule,
    PipelineModule,
    SkeletonTopicsModule,
  ],
})
export class AppModule {}
