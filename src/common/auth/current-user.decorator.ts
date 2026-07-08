import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { DecodedIdToken } from 'firebase-admin/auth';

import type { AuthenticatedRequest } from './firebase-auth.guard';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): DecodedIdToken | undefined => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.firebaseUser;
  },
);
