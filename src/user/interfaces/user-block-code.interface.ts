export type BlockCodeStatus = 'pending' | 'verified' | 'expired';
export type PasswordRecoverySessionStatus = 'active' | 'consumed' | 'expired';

export interface UserBlockCodeRecord {
  uid: string;
  email: string;
  codeHash: string;
  requestedAt: string;
  requestedAtMs: number;
  expiresAt: string;
  expiresAtMs: number;
  deleteAt: Date;
  status: BlockCodeStatus;
  disabled: boolean;
  name: string;
  attemptCount: number;
  verifiedAt?: string;
  passwordResetSentAt?: string;
  passwordResetResendCount?: number;
  passwordResetPending?: boolean;
  passwordChangedAt?: string;
  updatedAt: string;
}

export interface PasswordRecoverySessionRecord {
  uid: string;
  email: string;
  purpose: 'password_reset';
  status: PasswordRecoverySessionStatus;
  createdAt: string;
  createdAtMs: number;
  expiresAt: string;
  expiresAtMs: number;
  deleteAt: Date;
  updatedAt: string;
  usedAt?: string;
  passwordChangedAt?: string;
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

export interface RequestBlockCodeResult {
  uid: string;
  email: string;
  disabled: boolean;
  expiresAt: string;
}

export interface VerifyBlockCodeResult {
  uid: string;
  email: string;
  disabled: boolean;
  status: 'verified';
  resetLinkSent: boolean;
}

export interface ResendPasswordResetResult {
  uid: string;
  email: string;
  resetLinkSent: boolean;
  passwordResetResendCount: number;
}

export interface ToggleUserStatusResult {
  uid: string;
  disabled: boolean;
}

export interface RegisterLoginAttemptResult {
  uid: string;
  email: string;
  attemptCount: number;
  remainingAttempts: number;
  blocked: boolean;
  codeSent: boolean;
  expiresAt?: string;
}

export interface ResetLoginAttemptResult {
  uid: string;
  email: string;
  attemptCount: 0;
}

export interface ManualPasswordUpdateResult {
  uid: string;
  email: string;
  passwordUpdated: boolean;
  passwordChangedAt: string;
}

export interface UserLoginAttemptRecord {
  email: string;
  uid: string;
  attemptCount: number;
  blocked: boolean;
  lastAttemptAt: string;
  updatedAt: string;
  blockedAt?: string;
  deleteAt: Date;
}

export interface PasswordRecoverySessionSnapshot extends PasswordRecoverySessionRecord {
  sessionIdHash: string;
}

export interface CheckBlockStatusResult {
  blocked: boolean;
  uid: string;
  email: string;
  disabled: boolean;
  codeSent: boolean;
  expiresAt?: string;
  passwordResetPending?: boolean;
}
