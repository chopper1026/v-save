import { IsIn, IsOptional } from 'class-validator';
import type { RuntimeDashboardWindow } from '../runtime-monitor.types';

export class QueryRuntimeDashboardDto {
  @IsOptional()
  @IsIn(['today', '24h', '7d'])
  window?: RuntimeDashboardWindow;
}
