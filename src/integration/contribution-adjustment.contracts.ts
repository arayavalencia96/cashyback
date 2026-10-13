export interface ContributionAdjustmentIdentity {
  id: string;
  contributionId: string;
  growlyUserId: string;
  linkId: string;
}
export interface ContributionAdjustmentInput extends ContributionAdjustmentIdentity {
  expectedRevision: number;
  kind: 'edit' | 'void';
  amountMinor: number;
  allocationAmountMinor: number;
  exchangeRateArsPerUsd: number;
}
export interface ContributionAdjustmentReceipt extends ContributionAdjustmentInput {
  status: 'applied' | 'rejected';
  revision: number;
  reason: string;
}
export type ContributionAdjustmentLookup =
  | ContributionAdjustmentReceipt
  | (ContributionAdjustmentIdentity & { status: 'missing' });
