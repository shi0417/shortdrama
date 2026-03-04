import { Module } from '@nestjs/common';
import { SkeletonTopicsController } from './skeleton-topics.controller';
import { SkeletonTopicsService } from './skeleton-topics.service';

@Module({
  controllers: [SkeletonTopicsController],
  providers: [SkeletonTopicsService],
})
export class SkeletonTopicsModule {}
