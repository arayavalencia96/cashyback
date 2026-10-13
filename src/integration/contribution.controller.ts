import {
  Body,
  Controller,
  HttpCode,
  Post,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { IntegrationExceptionFilter } from './integration-exception.filter';
import { IntegrationPeerGuard } from './integration-peer.guard';
import { ContributionService } from './contribution.service';
import { contributionIdentity, reserveInput } from './contribution-input';
import type { IntegrationResponse } from './integration.contracts';
import { ContributionAdjustmentService } from './contribution-adjustment.service';
import {
  adjustmentIdentity,
  adjustmentInput,
} from './contribution-adjustment-input';

@Controller('integration/peer/contribution')
@UseFilters(IntegrationExceptionFilter)
@UseGuards(IntegrationPeerGuard)
export class ContributionController {
  constructor(
    private readonly contributions: ContributionService,
    private readonly adjustments: ContributionAdjustmentService,
  ) {}
  @Post('adjust')
  @HttpCode(200)
  async adjust(@Body() body: unknown) {
    return this.success(await this.adjustments.apply(adjustmentInput(body)));
  }
  @Post('adjustment-reject')
  @HttpCode(200)
  async rejectAdjustment(@Body() body: unknown) {
    return this.success(
      await this.adjustments.apply(adjustmentInput(body), true),
    );
  }
  @Post('adjustment-status')
  @HttpCode(200)
  async adjustmentStatus(@Body() body: unknown) {
    return this.success(
      await this.adjustments.lookup(adjustmentIdentity(body)),
    );
  }
  @Post('reserve')
  @HttpCode(200)
  async reserve(@Body() body: unknown) {
    return this.success(await this.contributions.reserve(reserveInput(body)));
  }
  @Post('confirm')
  @HttpCode(200)
  async confirm(@Body() body: unknown) {
    return this.success(
      await this.contributions.confirm(contributionIdentity(body)),
    );
  }
  @Post('cancel')
  @HttpCode(200)
  async cancel(@Body() body: unknown) {
    return this.success(await this.contributions.cancel(reserveInput(body)));
  }
  @Post('status')
  @HttpCode(200)
  async status(@Body() body: unknown) {
    return this.success(
      await this.contributions.lookup(contributionIdentity(body)),
    );
  }
  private success<T>(result: T): IntegrationResponse<T> {
    return {
      result,
      message: 'Aporte procesado',
      description: 'Reserva y consumo del presupuesto de Cashy',
      statuscode: 200,
      ok: true,
    };
  }
}
