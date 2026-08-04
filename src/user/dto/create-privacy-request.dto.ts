import type { PrivacyRequestType } from '../interfaces/privacy-request.interface';

export class CreatePrivacyRequestDto {
  type!: PrivacyRequestType;

  details!: string;
}
