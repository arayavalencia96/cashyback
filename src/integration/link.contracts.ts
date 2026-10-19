import type { IntegrationPermission } from './integration.contracts';
export const ACCOUNT_LINK_PERMISSIONS: IntegrationPermission[] = [
  'allocations:read',
  'contributions:write',
  'contributions:read',
  'portfolio:read',
];

export interface AccountLinkView {
  id: string;
  cashyEmail: string;
  growlyEmail: string;
  linkedAt: string;
  permissions: IntegrationPermission[];
}

export type AccountLinkState =
  | { status: 'not-linked'; enabled: boolean; peerFrontendUrl: string }
  | {
      status: 'active';
      enabled: boolean;
      peerFrontendUrl: string;
      link: AccountLinkView;
      detailsFresh: boolean;
      accessAvailable: boolean;
    }
  | {
      status: 'revocation-pending';
      enabled: boolean;
      peerFrontendUrl: string;
      link: AccountLinkView;
      requestedAt: string;
    };

export interface RevocationReceipt {
  linkId: string;
  status: 'revoked';
  revokedAt: string;
}

export type LinkedAccountIdentity =
  | { available: false }
  | { available: true; email: string; accessAllowed: boolean };

export interface StartLinkRequest {
  codeChallenge: string;
  state: string;
}

export interface StartLinkResult {
  requestToken: string;
  authorizationUrl: string;
  expiresAt: string;
}

export interface LinkConsent {
  growlyUserId: string;
  cashyEmail: string;
  growlyEmail: string;
  expiresAt: string;
  permissions: IntegrationPermission[];
}

export interface LinkRedirect {
  redirectUrl: string;
}
