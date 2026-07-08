import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';

import { FirebaseAdminService } from '../services/firebase.service';

export interface AuthenticatedRequest extends Request {
  firebaseUser?: DecodedIdToken;
}

@Injectable()
export class FirebaseAuthGuard implements CanActivate {
  constructor(private readonly firebaseAdminService: FirebaseAdminService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;

    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing Firebase bearer token.');
    }

    const token = authorization.slice('Bearer '.length).trim();

    if (!token) {
      throw new UnauthorizedException('Missing Firebase bearer token.');
    }

    try {
      request.firebaseUser =
        await this.firebaseAdminService.auth.verifyIdToken(token);

      return true;
    } catch {
      throw new UnauthorizedException('Invalid Firebase bearer token.');
    }
  }
}
