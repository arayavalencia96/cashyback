import { Controller, Get, UseFilters, UseGuards } from '@nestjs/common';
import { FirebaseAuthGuard } from '../common/auth/firebase-auth.guard';
import { IntegrationPeerGuard } from './integration-peer.guard';
import { IntegrationExceptionFilter } from './integration-exception.filter';
import { IntegrationService } from './integration.service';
import type { IntegrationResponse } from './integration.contracts';

@Controller('integration')
@UseFilters(IntegrationExceptionFilter)
export class IntegrationController {
  constructor(private readonly integration: IntegrationService) {}

  @Get('status')
  @UseGuards(FirebaseAuthGuard)
  status() {
    return this.success(this.integration.status());
  }

  @Get('diagnostics')
  @UseGuards(FirebaseAuthGuard)
  async diagnostics() {
    return this.success(await this.integration.diagnostics());
  }

  @Get('peer-health')
  @UseGuards(IntegrationPeerGuard)
  peerHealth() {
    return this.success(this.integration.peerHealth());
  }

  private success<T>(result: T): IntegrationResponse<T> {
    return {
      result,
      message: 'Integration request completed',
      description: 'Protocol version 1',
      statuscode: 200,
      ok: true,
    };
  }
}
