import { BadRequestException } from '@nestjs/common';
import { contributionIdentity } from './contribution-input';
import { requireLinkId } from './link-input';
import type {
  ContributionAdjustmentIdentity,
  ContributionAdjustmentInput,
} from './contribution-adjustment.contracts';

function body(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException('Corrección inválida.');
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).length !== keys.length ||
    keys.some((key) => !(key in row))
  )
    throw new BadRequestException('Campos de corrección inválidos.');
  return row;
}
const keys = ['id', 'contributionId', 'growlyUserId', 'linkId'];
function identity(
  row: Record<string, unknown>,
): ContributionAdjustmentIdentity {
  const actor = contributionIdentity({
    id: row.id,
    growlyUserId: row.growlyUserId,
    linkId: row.linkId,
  });
  if (typeof row.contributionId !== 'string')
    throw new BadRequestException('Aporte inválido.');
  return { ...actor, contributionId: requireLinkId(row.contributionId) };
}
export function adjustmentIdentity(
  value: unknown,
): ContributionAdjustmentIdentity {
  return identity(body(value, keys));
}
export function adjustmentInput(value: unknown): ContributionAdjustmentInput {
  const row = body(value, [
    ...keys,
    'expectedRevision',
    'kind',
    'amountMinor',
    'allocationAmountMinor',
    'exchangeRateArsPerUsd',
  ]);
  const revision = row.expectedRevision,
    amount = row.amountMinor,
    cost = row.allocationAmountMinor,
    rate = row.exchangeRateArsPerUsd;
  if (
    typeof revision !== 'number' ||
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    revision >= Number.MAX_SAFE_INTEGER ||
    typeof amount !== 'number' ||
    !Number.isSafeInteger(amount) ||
    amount < 0 ||
    typeof cost !== 'number' ||
    !Number.isSafeInteger(cost) ||
    cost < 0 ||
    typeof rate !== 'number' ||
    !Number.isFinite(rate) ||
    rate <= 0 ||
    rate > Number.MAX_SAFE_INTEGER / 1e8 ||
    Number(rate.toFixed(8)) !== rate ||
    !['edit', 'void'].includes(String(row.kind)) ||
    (row.kind === 'void'
      ? amount !== 0 || cost !== 0
      : amount === 0 || cost === 0)
  )
    throw new BadRequestException('Importes de corrección inválidos.');
  return {
    ...identity(row),
    expectedRevision: revision,
    kind: row.kind as 'edit' | 'void',
    amountMinor: amount,
    allocationAmountMinor: cost,
    exchangeRateArsPerUsd: rate,
  };
}
