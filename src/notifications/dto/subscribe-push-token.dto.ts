export class SubscribePushTokenDto {
  fid!: string;
  platform!: 'web';
  deviceId!: string;
  userAgent?: string;
}
