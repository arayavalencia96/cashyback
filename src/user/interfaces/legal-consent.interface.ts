export const CURRENT_TERMS_VERSION = '2026-08-03';
export const CURRENT_PRIVACY_VERSION = '2026-08-04-v2';

export type AnalyticsConsentState = 'accepted' | 'rejected' | 'not_decided';

export interface LegalConsentRecord {
  termsVersion: string;
  privacyVersion: string;
  acceptedAt: string;
  analyticsConsent: AnalyticsConsentState;
  analyticsConsentAt: string | null;
}
