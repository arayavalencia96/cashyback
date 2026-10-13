import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { FirebaseAdminService } from '../common/services/firebase.service';
import type { AuthenticatedRequest } from '../common/auth/firebase-auth.guard';

@Injectable()
export class IntegrationUserGuard implements CanActivate {
  constructor(private readonly firebase: FirebaseAdminService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization ?? '';
    if (!authorization.startsWith('Bearer '))
      throw new UnauthorizedException('Iniciá sesión en Cashy.');
    try {
      const user = await this.firebase.auth.verifyIdToken(
        authorization.slice(7),
        true,
      );
      if (!user.email_verified || !user.email)
        throw new Error('Unverified account');
      request.firebaseUser = user;
      return true;
    } catch {
      throw new UnauthorizedException(
        'La sesión de Cashy no es válida o el correo no está verificado.',
      );
    }
  }
}
