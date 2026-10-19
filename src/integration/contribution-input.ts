import { BadRequestException } from '@nestjs/common';
import type {
  ContributionIdentity,
  ReserveContributionInput,
} from './contribution.contracts';
import { requireLinkId } from './link-input';

function input(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException('Aporte inválido.');
  const body = value as Record<string, unknown>;
  if (
    Object.keys(body).length !== keys.length ||
    keys.some((key) => !(key in body))
  )
    throw new BadRequestException('Campos de aporte inválidos.');
  return body;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || value.length > 100)
    throw new BadRequestException('Identificador de aporte inválido.');
  return value;
}
export function contributionIdentity(body: unknown): ContributionIdentity {
  const value = input(body, ['id', 'growlyUserId', 'linkId']);
  return identity(value);
}
function identity(value: Record<string, unknown>): ContributionIdentity {
  const growlyUserId = text(value.growlyUserId);
  if (!/^[a-f0-9]{24}$/i.test(growlyUserId))
    throw new BadRequestException('Cuenta Growly inválida.');
  return {
    id: requireLinkId(text(value.id)),
    linkId: requireLinkId(text(value.linkId)),
    growlyUserId,
  };
}
export function reserveInput(body: unknown): ReserveContributionInput {
  const value = input(body, [
    'id',
    'growlyUserId',
    'linkId',
    'growlyMovementId',
    'allocationId',
    'period',
    'currency',
    'amountMinor',
    'allocationAmountMinor',
    'exchangeRateArsPerUsd',
    'validUntil',
  ]);
  const actor = identity(value);
  const growlyMovementId = text(value.growlyMovementId),
    allocationId = text(value.allocationId),
    period = text(value.period),
    validUntil = text(value.validUntil);
  if (
    !/^[a-f0-9]{24}$/.test(growlyMovementId) ||
    !/^[a-f0-9]{64}$/.test(allocationId) ||
    !/^20\d{2}-(0[1-9]|1[0-2])$/.test(period) ||
    !Number.isFinite(Date.parse(validUntil))
  )
    throw new BadRequestException('Metadatos de aporte inválidos.');
  const amountMinor = value.amountMinor,
    allocationAmountMinor = value.allocationAmountMinor,
    rate = value.exchangeRateArsPerUsd;
  if (
    typeof amountMinor !== 'number' ||
    !Number.isSafeInteger(amountMinor) ||
    amountMinor <= 0 ||
    typeof allocationAmountMinor !== 'number' ||
    !Number.isSafeInteger(allocationAmountMinor) ||
    allocationAmountMinor <= 0 ||
    typeof rate !== 'number' ||
    !Number.isFinite(rate) ||
    rate <= 0 ||
    rate > Number.MAX_SAFE_INTEGER / 1e8 ||
    Number(rate.toFixed(8)) !== rate
  )
    throw new BadRequestException('Importes de aporte inválidos.');
  const currency = value.currency;
  if (currency !== 'ARS' && currency !== 'USD')
    throw new BadRequestException('Moneda inválida.');
  const expected =
    currency === 'ARS'
      ? amountMinor
      : Number(
          (BigInt(amountMinor) * BigInt(rate.toFixed(8).replace('.', '')) +
            50000000n) /
            100000000n,
        );
  if ((currency === 'ARS' && rate !== 1) || expected !== allocationAmountMinor)
    throw new BadRequestException('Conversión de aporte incompatible.');
  return {
    ...actor,
    growlyMovementId,
    allocationId,
    period,
    validUntil,
    currency,
    amountMinor,
    allocationAmountMinor,
    exchangeRateArsPerUsd: rate,
  };
}
