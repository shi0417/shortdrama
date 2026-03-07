import { Module } from '@nestjs/common';
import { SetCoreController } from './set-core.controller';
import { SetCoreService } from './set-core.service';

@Module({
  controllers: [SetCoreController],
  providers: [SetCoreService],
})
export class SetCoreModule {}
