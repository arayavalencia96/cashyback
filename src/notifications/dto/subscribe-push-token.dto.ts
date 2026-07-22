export class SubscribePushTokenDto {
  token!: string;
  platform!: 'web';
  deviceId!: string;
  userAgent?: string;
}
