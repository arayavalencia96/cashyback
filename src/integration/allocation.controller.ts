import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../common/auth/firebase-auth.guard';
import { AllocationService } from './allocation.service';
import { LegacyReviewService } from './legacy-review.service';
import { IntegrationUserGuard } from './integration-user.guard';
import { IntegrationPeerGuard } from './integration-peer.guard';
import { IntegrationExceptionFilter } from './integration-exception.filter';
import { parseLinkInput, requireLinkId } from './link-input';
import type { IntegrationResponse } from './integration.contracts';

@Controller('integration')
@UseFilters(IntegrationExceptionFilter)
export class AllocationController {
  constructor(
    private readonly allocations: AllocationService,
    private readonly legacy: LegacyReviewService,
  ) {}
  @Post('allocation/legacy-review')
  @HttpCode(200)
  @UseGuards(IntegrationUserGuard)
  async reviewLegacy(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ) {
    if (!request.firebaseUser) throw new UnauthorizedException();
    return this.success(
      await this.legacy.review(request.firebaseUser.uid, body),
    );
  }

  @Get('allocation')
  @UseGuards(IntegrationUserGuard)
  async own(
    @Req() request: AuthenticatedRequest,
    @Query('period') period: unknown,
  ) {
    if (!request.firebaseUser) throw new UnauthorizedException();
    return this.success(
      await this.allocations.forCashy(request.firebaseUser.uid, period),
    );
  }

  @Post('peer/allocation')
  @HttpCode(200)
  @UseGuards(IntegrationPeerGuard)
  async peer(@Body() body: unknown) {
    const input = parseLinkInput(body, ['growlyUserId', 'linkId', 'period']);
    if (!/^[a-f0-9]{24}$/i.test(input.growlyUserId))
      throw new UnauthorizedException('Cuenta Growly inválida.');
    return this.success(
      await this.allocations.forGrowly(
        input.growlyUserId,
        requireLinkId(input.linkId),
        input.period,
      ),
    );
  }

  private success<T>(result: T): IntegrationResponse<T> {
    return {
      result,
      message: 'Asignación consultada',
      description: 'Presupuesto mensual de Cashy',
      statuscode: 200,
      ok: true,
    };
  }
}
