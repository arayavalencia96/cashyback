export class ManualPasswordUpdateDto {
  sessionId?: string;
  token?: string;
  newPassword!: string;
}
