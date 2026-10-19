import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseFilters,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../common/auth/firebase-auth.guard';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { RateLimitGuard } from '../common/rate-limit/rate-limit.guard';
import { AccountLinkService } from './account-link.service';
import { IntegrationUserGuard } from './integration-user.guard';
import { IntegrationPeerGuard } from './integration-peer.guard';
import { IntegrationExceptionFilter } from './integration-exception.filter';
import {
  parseLinkInput,
  requireLinkId,
  requireLinkPermission,
} from './link-input';
import type { IntegrationResponse } from './integration.contracts';

@Controller('integration')
@UseFilters(IntegrationExceptionFilter)
export class AccountLinkController {
  constructor(private readonly links: AccountLinkService) {}

  @Get('link')
  @UseGuards(IntegrationUserGuard)
  async link(@Req() request: AuthenticatedRequest) {
    return this.success(await this.links.getCashyLink(this.user(request).uid));
  }

  @Post('link/start')
  @HttpCode(200)
  @UseGuards(IntegrationUserGuard, RateLimitGuard)
  @RateLimit({ limit: 10, windowMs: 60000, keyBy: ['ip'] })
  async start(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const input = parseLinkInput(body, ['codeChallenge', 'state']);
    return this.success(
      await this.links.start(
        this.user(request),
        input.codeChallenge,
        input.state,
      ),
    );
  }
  @Post('link/renew')
  @HttpCode(200)
  @UseGuards(IntegrationUserGuard, RateLimitGuard)
  @RateLimit({ limit: 10, windowMs: 60000, keyBy: ['ip'] })
  async renew(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const input = parseLinkInput(body, ['codeChallenge', 'state']);
    return this.success(
      await this.links.start(
        this.user(request),
        input.codeChallenge,
        input.state,
        true,
      ),
    );
  }

  @Post('link/complete')
  @HttpCode(200)
  @UseGuards(IntegrationUserGuard)
  async complete(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const input = parseLinkInput(body, ['requestToken', 'code', 'verifier']);
    return this.success(
      await this.links.complete(
        this.user(request),
        input.requestToken,
        input.code,
        input.verifier,
      ),
    );
  }

  @Post('link/review')
  @HttpCode(200)
  @UseGuards(IntegrationUserGuard)
  async review(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const input = parseLinkInput(body, ['requestToken', 'code', 'verifier']);
    return this.success(
      await this.links.review(
        this.user(request),
        input.requestToken,
        input.code,
        input.verifier,
      ),
    );
  }

  @Post('link/cancel')
  @HttpCode(200)
  @UseGuards(IntegrationUserGuard)
  async cancel(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const input = parseLinkInput(body, ['requestToken', 'code', 'verifier']);
    return this.success(
      await this.links.cancel(
        this.user(request),
        input.requestToken,
        input.code,
        input.verifier,
      ),
    );
  }

  @Post('peer/link/preview')
  @HttpCode(200)
  @UseGuards(IntegrationPeerGuard)
  async preview(@Body() body: unknown) {
    const input = this.peerInput(body);
    return this.success(
      await this.links.preview(
        input.requestToken,
        input.growlyUserId,
        input.growlyEmail,
      ),
    );
  }

  @Post('peer/link/approve')
  @HttpCode(200)
  @UseGuards(IntegrationPeerGuard)
  async approve(@Body() body: unknown) {
    const input = this.peerInput(body);
    return this.success(
      await this.links.approve(
        input.requestToken,
        input.growlyUserId,
        input.growlyEmail,
      ),
    );
  }

  @Post('peer/link/deny')
  @HttpCode(200)
  @UseGuards(IntegrationPeerGuard)
  async deny(@Body() body: unknown) {
    const input = parseLinkInput(body, ['requestToken']);
    return this.success(await this.links.deny(input.requestToken));
  }

  @Post('peer/link/status')
  @HttpCode(200)
  @UseGuards(IntegrationPeerGuard)
  async peerStatus(@Body() body: unknown) {
    const input = parseLinkInput(body, ['growlyUserId']);
    this.validateGrowlyId(input.growlyUserId);
    return this.success(await this.links.getGrowlyLink(input.growlyUserId));
  }

  private peerInput(body: unknown) {
    const input = parseLinkInput(body, [
      'requestToken',
      'growlyUserId',
      'growlyEmail',
    ]);
    this.validateGrowlyId(input.growlyUserId);
    return input;
  }

  @Post('link/revoke')
  @HttpCode(200)
  @UseGuards(IntegrationUserGuard)
  async revoke(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const input = parseLinkInput(body, ['linkId']);
    return this.success(
      await this.links.revokeCashy(
        this.user(request).uid,
        requireLinkId(input.linkId),
      ),
    );
  }

  @Post('peer/link/revoke')
  @HttpCode(200)
  @UseGuards(IntegrationPeerGuard)
  async peerRevoke(@Body() body: unknown) {
    const input = parseLinkInput(body, ['linkId', 'growlyUserId']);
    this.validateGrowlyId(input.growlyUserId);
    return this.success(
      await this.links.revokeGrowly(
        input.growlyUserId,
        requireLinkId(input.linkId),
      ),
    );
  }

  @Post('peer/link/authorize')
  @HttpCode(200)
  @UseGuards(IntegrationPeerGuard)
  async authorize(@Body() body: unknown) {
    const input = parseLinkInput(body, [
      'linkId',
      'growlyUserId',
      'permission',
    ]);
    this.validateGrowlyId(input.growlyUserId);
    return this.success(
      await this.links.authorizeGrowly(
        input.growlyUserId,
        requireLinkId(input.linkId),
        requireLinkPermission(input.permission),
      ),
    );
  }

  private validateGrowlyId(value: string): void {
    if (!/^[a-f0-9]{24}$/i.test(value))
      throw new UnauthorizedException('Cuenta Growly inválida.');
  }

  @Post('peer/link/validate')
  @HttpCode(200)
  @UseGuards(IntegrationPeerGuard)
  async validate(@Body() body: unknown) {
    const input = parseLinkInput(body, ['linkId', 'growlyUserId']);
    this.validateGrowlyId(input.growlyUserId);
    return this.success(
      await this.links.validateGrowlyLink(
        input.growlyUserId,
        requireLinkId(input.linkId),
      ),
    );
  }

  private user(request: AuthenticatedRequest) {
    if (!request.firebaseUser) throw new UnauthorizedException();
    return request.firebaseUser;
  }

  private success<T>(result: T): IntegrationResponse<T> {
    return {
      result,
      message: 'Solicitud completada',
      description: 'Vinculación de cuentas',
      statuscode: 200,
      ok: true,
    };
  }
}
