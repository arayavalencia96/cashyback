import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { buildErrorResponse } from '../api-response';
import { RATE_LIMIT_RULES_KEY } from './rate-limit.constants';
import { RateLimitStorageService } from './rate-limit.storage';
import type { RateLimitKeySource, RateLimitRule } from './rate-limit.types';

interface RateLimitRequestLike {
  ip?: string;
  body?: Record<string, unknown>;
  params?: Record<string, string>;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimitStorage: RateLimitStorageService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rules = this.reflector.getAllAndOverride<RateLimitRule[]>(
      RATE_LIMIT_RULES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!rules?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RateLimitRequestLike>();

    for (const rule of rules) {
      const key = this.buildKey(request, rule);

      if (!key) {
        continue;
      }

      const bucketKey = this.buildBucketKey(context, rule, key);
      const result = await this.rateLimitStorage.consume(
        bucketKey,
        rule.windowMs,
        rule.limit,
      );

      if (result.allowed) {
        continue;
      }

      throw new HttpException(
        buildErrorResponse(
          rule.message ?? 'Demasiados intentos',
          rule.description ??
            `Volvé a intentarlo más tarde. Reintentá en aproximadamente ${result.retryAfterSeconds} segundos.`,
          HttpStatus.TOO_MANY_REQUESTS,
        ),
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  private buildBucketKey(
    context: ExecutionContext,
    rule: RateLimitRule,
    key: string,
  ): string {
    const handlerName = context.getHandler().name;
    const className = context.getClass().name;

    return `${className}:${handlerName}:${rule.limit}:${rule.windowMs}:${key}`;
  }

  private buildKey(
    request: RateLimitRequestLike,
    rule: RateLimitRule,
  ): string | null {
    const values = rule.keyBy
      .map((source) => this.resolveSourceValue(request, source))
      .filter((value): value is string => value.length > 0);

    if (!values.length) {
      return null;
    }

    return values.join('|');
  }

  private resolveSourceValue(
    request: RateLimitRequestLike,
    source: RateLimitKeySource,
  ): string {
    switch (source) {
      case 'ip':
        return (request.ip ?? '').trim().toLowerCase();
      case 'body.email':
        return this.asString(request.body?.email);
      case 'body.sessionId':
        return this.asString(request.body?.sessionId);
      case 'body.token':
        return this.asString(request.body?.token);
      case 'params.uid':
        return this.asString(request.params?.uid);
      default:
        return '';
    }
  }

  private asString(value: unknown): string {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
  }
}

