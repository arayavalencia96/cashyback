import {
  Controller,
  Get,
  Req,
  UnauthorizedException,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../common/auth/firebase-auth.guard';
import { IntegrationUserGuard } from './integration-user.guard';
import { IntegrationExceptionFilter } from './integration-exception.filter';
import { PortfolioService } from './portfolio.service';

@Controller('integration')
@UseFilters(IntegrationExceptionFilter)
@UseGuards(IntegrationUserGuard)
export class PortfolioController {
  constructor(private readonly portfolio: PortfolioService) {}
  @Get('portfolio')
  async get(@Req() request: AuthenticatedRequest) {
    if (!request.firebaseUser) throw new UnauthorizedException();
    return {
      result: await this.portfolio.get(request.firebaseUser.uid),
      message: 'Cartera consultada',
      description: 'Valor contable informado por Growly',
      statuscode: 200,
      ok: true,
    };
  }
}
