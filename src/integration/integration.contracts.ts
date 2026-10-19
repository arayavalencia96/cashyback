export type IntegrationApplication = 'cashy' | 'growly';
export type IntegrationPermission =
  | 'allocations:read'
  | 'contributions:write'
  | 'contributions:read'
  | 'portfolio:read';
export type AccountLinkStatus =
  'not-linked' | 'active' | 'revocation-pending' | 'revoked';
export type ContributionStatus =
  'reserved' | 'confirmed' | 'cancelled' | 'reconciliation-required';

export interface IntegrationResponse<T> {
  result: T;
  message: string;
  description: string;
  statuscode: number;
  ok: boolean;
}

export interface AccountLink {
  id: string;
  cashyUserId: string;
  growlyUserId: string;
  status: AccountLinkStatus;
  permissions: IntegrationPermission[];
  linkedAt: string;
}

export interface MonthlyAllocation {
  legacyCommittedMinor?: number;
  legacyReviewRequired?: boolean;
  id: string;
  period: string;
  currency: 'ARS';
  assignedMinor: number;
  contributedMinor: number;
  reservedMinor: number;
  availableMinor: number;
  excessMinor: number;
  version: number;
}

export interface AllocationContribution {
  id: string;
  allocationId: string;
  linkId: string;
  growlyMovementId: string;
  idempotencyKey: string;
  status: ContributionStatus;
  amountMinor: number;
  currency: 'ARS' | 'USD';
  allocationAmountMinor: number;
  exchangeRateArsPerUsd: number;
}

export interface IntegrationPeerHealth {
  application: IntegrationApplication;
  protocolVersion: 1;
  status: 'ok';
}

export interface IntegrationStatus {
  application: IntegrationApplication;
  enabled: boolean;
  accountLinkingAvailable: boolean;
  peerApplication: IntegrationApplication;
  peerFrontendUrl: string;
}

export interface IntegrationDiagnostics {
  application: IntegrationApplication;
  peerApplication: IntegrationApplication;
  transport: 'reachable';
  protocolVersion: 1;
}
