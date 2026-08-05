export const privacyRequestTypes = [
  'access',
  'rectification',
  'deletion',
  'portability',
  'objection',
] as const;

export type PrivacyRequestType = (typeof privacyRequestTypes)[number];
export type PrivacyRequestStatus =
  'received' | 'in_review' | 'completed' | 'rejected';

export interface PrivacyRequestRecord {
  id: string;
  uid: string;
  email: string;
  type: PrivacyRequestType;
  details: string;
  status: PrivacyRequestStatus;
  createdAt: string;
  updatedAt: string;
  responseDueAt: string;
}
