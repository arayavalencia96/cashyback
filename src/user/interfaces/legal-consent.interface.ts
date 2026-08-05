export const CURRENT_TERMS_VERSION = '2026-08-05-v3';
export const CURRENT_PRIVACY_VERSION = '2026-08-05-v5';
export const MINIMUM_USER_AGE = 18;

export type AnalyticsConsentState = 'accepted' | 'rejected' | 'not_decided';

export interface LegalConsentRecord {
  termsVersion: string;
  privacyVersion: string;
  minimumAge: number;
  minimumAgeConfirmed: true;
  acceptedAt: string;
  analyticsConsent: AnalyticsConsentState;
  analyticsConsentAt: string | null;
}
