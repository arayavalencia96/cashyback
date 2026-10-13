import { timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { IntegrationConfig } from './integration.config';

@Injectable()
export class IntegrationPeerGuard implements CanActivate {
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
      throw new UnauthorizedException('Invalid integration credential.');
    }
    return true;
  }
}
