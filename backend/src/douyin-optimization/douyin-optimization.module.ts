import { Module } from '@nestjs/common';
import { DouyinOptimizationService } from './douyin-optimization.service';

@Module({
  providers: [DouyinOptimizationService],
  exports: [DouyinOptimizationService],
})
export class DouyinOptimizationModule {}
