import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator';

@Controller()
export class HealthController {
  @Get('healthz')
  @Public()
  getHealth() {
    return {
      success: true,
      data: {
        status: 'ok',
      },
    };
  }
}
