import { Body, Controller, Post } from '@nestjs/common';
import { RuntimeClientEventDto } from './dto/runtime-client-event.dto';
import { RuntimeMonitorService } from './runtime-monitor.service';

@Controller('runtime')
export class RuntimeClientEventsController {
  constructor(private readonly runtimeMonitorService: RuntimeMonitorService) {}

  @Post('client-events')
  async recordEvent(@Body() body: RuntimeClientEventDto) {
    const data = await this.runtimeMonitorService.recordClientEvent(body);
    return {
      success: true,
      data,
    };
  }
}
