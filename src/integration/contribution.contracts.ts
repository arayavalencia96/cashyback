export interface ReserveContributionInput {
  id: string;
  growlyUserId: string;
  growlyMovementId: string;
  linkId: string;
  allocationId: string;
  period: string;
  currency: 'ARS' | 'USD';
  amountMinor: number;
  allocationAmountMinor: number;
  exchangeRateArsPerUsd: number;
  validUntil: string;
}
export interface ContributionIdentity {
  id: string;
  growlyUserId: string;
  linkId: string;
}
export interface ContributionReceipt {
  id: string;
  status: 'reserved' | 'confirmed' | 'cancelled';
  allocationId: string;
  allocationAmountMinor: number;
  growlyMovementId: string;
  expiresAt: string;
  reason: string;
}
export type ContributionLookup =
  ContributionReceipt | { id: string; status: 'missing' };
