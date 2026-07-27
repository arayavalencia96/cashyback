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

  /**
   * Aplica todas las reglas de rate limit configuradas para el endpoint.
   *
   * @param context Contexto HTTP con handler, clase y solicitud.
   * @returns `true` cuando ninguna regla supera su límite.
   * @throws HttpException Si una regla excede la cantidad permitida.
   */
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

  /**
   * Construye la clave única del bucket para una regla y endpoint.
   *
   * @param context Contexto usado para identificar clase y handler.
   * @param rule Regla de rate limit aplicada.
   * @param key Identidad normalizada del consumidor.
   * @returns Clave completa del bucket.
   */
  private buildBucketKey(
    context: ExecutionContext,
    rule: RateLimitRule,
    key: string,
  ): string {
    const handlerName = context.getHandler().name;
    const className = context.getClass().name;

    return `${className}:${handlerName}:${rule.limit}:${rule.windowMs}:${key}`;
  }

  /**
   * Resuelve y combina los valores configurados para identificar al consumidor.
   *
   * @param request Datos disponibles de la solicitud.
   * @param rule Regla que define las fuentes de la clave.
   * @returns Clave combinada o `null` si no hay valores utilizables.
   */
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

  /**
   * Obtiene de la solicitud el valor indicado por una fuente de rate limit.
   *
   * @param request Datos disponibles de la solicitud.
   * @param source Fuente configurada en la regla.
   * @returns Valor normalizado o cadena vacía.
   */
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

  /**
   * Normaliza un valor desconocido como texto utilizable en una clave.
   *
   * @param value Valor que se debe convertir.
   * @returns Texto sin espacios y en minúsculas o cadena vacía.
   */
  private asString(value: unknown): string {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
  }
}
