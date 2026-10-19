import { timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { IntegrationConfig } from './integration.config';

@Injectable()
export class IntegrationPeerGuard implements CanActivate {
  private readonly logger = new Logger(IntegrationPeerGuard.name);

  constructor(private readonly config: IntegrationConfig) {}

  canActivate(context: ExecutionContext): boolean {
    this.config.assertEnabled();
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization ?? '';
    const presented = Buffer.from(
      header.startsWith('Bearer ') ? header.slice(7) : '',
    );
    const expected = Buffer.from(this.config.inboundSecret);
    if (
      presented.length !== expected.length ||
      !timingSafeEqual(presented, expected)
    ) {
      this.logger.warn(
        JSON.stringify({
          event: 'integration_peer_credential_rejected',
          method: request.method,
          path: request.originalUrl,
          hasBearerPrefix: header.startsWith('Bearer '),
          presentedLength: presented.length,
          expectedLength: expected.length,
        }),
      );
      throw new UnauthorizedException('Invalid integration credential.');
    }
    return true;
  }
}
