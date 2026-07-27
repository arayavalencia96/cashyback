jest.mock('./brevo.service', () => ({
  BrevoService: class BrevoService {},
}));

import type { BrevoService, TransactionalEmailInput } from './brevo.service';
import { EmailService } from './email.service';

describe('EmailService', () => {
  const sendTransactionalEmail = jest.fn<
    Promise<void>,
    [TransactionalEmailInput]
  >();
  const originalMailSupport = process.env.MAIL_SUPPORT;

  beforeAll(() => {
    process.env.MAIL_SUPPORT = 'Cashy <support@cashy.app>';
  });

  afterAll(() => {
    if (originalMailSupport === undefined) {
      delete process.env.MAIL_SUPPORT;
    } else {
      process.env.MAIL_SUPPORT = originalMailSupport;
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    sendTransactionalEmail.mockResolvedValue(undefined);
  });

  it('renders and delegates account emails to Brevo', async () => {
    const service = new EmailService({
      sendTransactionalEmail,
    } as unknown as BrevoService);

    await service.sendBlockedCodeEmail({
      uid: 'uid-1',
      email: 'user@cashy.app',
      code: '123456',
      requestedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      name: 'Cashy User',
      isResend: false,
    });
    await service.sendPasswordResetEmail({
      uid: 'uid-1',
      email: 'user@cashy.app',
      name: 'Cashy User',
      resetLink: 'https://cashy.app/set-new-password?session=test',
    });

    const blockedEmail = sendTransactionalEmail.mock.calls[0][0];
    const passwordEmail = sendTransactionalEmail.mock.calls[1][0];

    expect(blockedEmail.to).toBe('user@cashy.app');
    expect(blockedEmail.subject).toBe('Tu cuenta fue bloqueada');
    expect(blockedEmail.replyTo).toEqual({ email: 'support@cashy.app' });
    expect(blockedEmail.htmlContent).toContain('123456');
    expect(passwordEmail.subject).toBe('Restablecer contrasena');
    expect(passwordEmail.htmlContent).toContain(
      'https://cashy.app/set-new-password?session&#x3D;test',
    );
  });

  it('renders a resent code without reply-to when support is absent', async () => {
    delete process.env.MAIL_SUPPORT;
    delete process.env.MAIL_FROM;
    const service = new EmailService({
      sendTransactionalEmail,
    } as unknown as BrevoService);

    await service.sendBlockedCodeEmail({
      uid: 'uid-1',
      email: 'user@cashy.app',
      code: '654321',
      requestedAt: 'invalid-date',
      expiresAt: 'invalid-date',
      isResend: true,
    });

    const email = sendTransactionalEmail.mock.calls[0][0];
    expect(email.subject).toBe('Nuevo codigo de desbloqueo');
    expect(email.replyTo).toBeUndefined();
    expect(email.htmlContent).toContain('654321');
  });

  it('wraps provider failures as internal server errors', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation();
    sendTransactionalEmail.mockRejectedValue('provider unavailable');
    const service = new EmailService({
      sendTransactionalEmail,
    } as unknown as BrevoService);

    await expect(
      service.sendPasswordResetEmail({
        uid: 'uid-1',
        email: 'user@cashy.app',
        resetLink: 'https://cashy.app/reset',
      }),
    ).rejects.toThrow('Error al enviar el correo');

    consoleError.mockRestore();
  });

  it('preserves an Error message returned by the provider', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation();
    process.env.MAIL_SUPPORT = 'support@cashy.app';
    sendTransactionalEmail.mockRejectedValue(new Error('Brevo unavailable'));
    const service = new EmailService({
      sendTransactionalEmail,
    } as unknown as BrevoService);

    await expect(
      service.sendPasswordResetEmail({
        uid: 'uid-1',
        email: 'user@cashy.app',
        resetLink: 'https://cashy.app/reset',
      }),
    ).rejects.toThrow('Brevo unavailable');

    consoleError.mockRestore();
  });
});
