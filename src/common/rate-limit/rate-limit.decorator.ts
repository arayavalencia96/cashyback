import { SetMetadata } from '@nestjs/common';

import { RATE_LIMIT_RULES_KEY } from './rate-limit.constants';
import type { RateLimitRule } from './rate-limit.types';

export const RateLimit = (...rules: RateLimitRule[]) =>
  SetMetadata(RATE_LIMIT_RULES_KEY, rules);
