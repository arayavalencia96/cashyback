import { Controller, Get } from '@nestjs/common';
import { buildSuccessResponse } from './common/api-response';

interface HealthResult {
  status: 'ok';
  timestamp: string;
}

@Controller()
export class HealthController {
  @Get('health')
  health() {
    return buildSuccessResponse<HealthResult>(
      {
        status: 'ok',
        timestamp: new Date().toISOString(),
      },
      'Service is healthy',
      'The application is running and ready to receive requests.',
      200,
    );
  }
}
