export type BlockCodeStatus = 'pending' | 'verified' | 'expired';

export interface UserBlockCodeRecord {
  uid: string;
  email: string;
  codeHash: string;
  requestedAt: string;
  requestedAtMs: number;
  expiresAt: string;
  expiresAtMs: number;
  status: BlockCodeStatus;
  disabled: boolean;
  name: string;
  attemptCount: number;
  verifiedAt?: string;
  passwordResetSentAt?: string;
  passwordResetResendCount?: number;
  updatedAt: string;
}

export interface BlockCodeEmailPayload {
  uid: string;
  email: string;
  code: string;
  requestedAt: string;
  name: string;
  expiresAt: string;
  isResend?: boolean;
}

export interface PasswordResetEmailPayload {
  uid: string;
  email: string;
  resetLink: string;
  name: string;
}

export interface ToggleUserStatusPayload {
  uid: string;
  disabled: boolean;
}
