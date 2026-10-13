import { BadRequestException } from '@nestjs/common';
import type { IntegrationPermission } from './integration.contracts';

export function requireLinkId(value: string): string {
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      value,
    )
  ) {
    throw new BadRequestException('Identificador de conexión inválido.');
  }
  return value;
}

export function requireLinkPermission(value: string): IntegrationPermission {
  if (
    ![
      'allocations:read',
      'contributions:write',
      'contributions:read',
      'portfolio:read',
    ].includes(value)
  ) {
    throw new BadRequestException('Permiso de integración inválido.');
  }
  return value as IntegrationPermission;
}

export function parseLinkInput(
  value: unknown,
  keys: readonly string[],
): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('Solicitud de vinculación inválida.');
  }
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).length !== keys.length ||
    keys.some((key) => !(key in input))
  ) {
    throw new BadRequestException('Campos de vinculación inválidos.');
  }
  const result: Record<string, string> = {};
  for (const key of keys) {
    const item = input[key];
    if (typeof item !== 'string' || !item.length || item.length > 320) {
      throw new BadRequestException('Campo de vinculación inválido: ' + key);
    }
    result[key] = item;
  }
  return result;
}

export function requireLinkToken(value: string): string {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new BadRequestException('Código de vinculación inválido.');
  }
  return value;
}
