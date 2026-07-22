import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

import { readOptionalEnv } from '../env';

@Injectable()
export class CronAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const secret = readOptionalEnv('CRON_SECRET');

    if (!secret) {
      throw new UnauthorizedException('Missing cron secret configuration.');
    }

    const request = context.switchToHttp().getRequest<Request>();
    const authorization = request.headers.authorization;

    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing cron bearer token.');
    }

    const token = authorization.slice('Bearer '.length).trim();

    if (!token || token !== secret) {
      throw new UnauthorizedException('Invalid cron bearer token.');
    }

    return true;
  }
}
