import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthHealthModule } from '../auth-health/auth-health.module';
import { RuntimeFeatureEvent } from './entities/runtime-feature-event.entity';
import { RuntimeInterfaceEvent } from './entities/runtime-interface-event.entity';
import { AdminRuntimeDashboardController } from './runtime-dashboard.controller';
import { RuntimeClientEventsController } from './runtime-events.controller';
import { RuntimeMonitorService } from './runtime-monitor.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([RuntimeFeatureEvent, RuntimeInterfaceEvent]),
    AuthHealthModule,
  ],
  controllers: [
    AdminRuntimeDashboardController,
    RuntimeClientEventsController,
  ],
  providers: [RuntimeMonitorService],
  exports: [RuntimeMonitorService],
})
export class RuntimeMonitorModule {}
