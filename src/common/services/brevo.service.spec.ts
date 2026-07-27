const mockSendTransacEmail = jest.fn<
  Promise<void>,
  [Record<string, unknown>]
>();

jest.mock('@getbrevo/brevo', () => {
  class BrevoClient {
    transactionalEmails = {
      sendTransacEmail: mockSendTransacEmail,
    };
  }

  return {
    BrevoClient,
    Brevo: {
      UnauthorizedError: class UnauthorizedError extends Error {},
      TooManyRequestsError: class TooManyRequestsError extends Error {},
    },
    BrevoError: class BrevoError extends Error {
      statusCode = 500;
    },
    BrevoTimeoutError: class BrevoTimeoutError extends Error {},
  };
});

import { BrevoService } from './brevo.service';
import { Brevo, BrevoError, BrevoTimeoutError } from '@getbrevo/brevo';

describe('BrevoService', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSendTransacEmail.mockResolvedValue(undefined);
    process.env.BREVO_API_KEY = 'test-key';
    process.env.BREVO_SENDER_EMAIL = 'noreply@cashy.app';
    process.env.BREVO_SENDER_NAME = 'Cashy';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('builds and sends a transactional email', async () => {
    const service = new BrevoService();

    await service.sendTransactionalEmail({
      to: 'user@cashy.app',
      name: 'User',
      subject: 'Test',
      htmlContent: '<p>Cashy</p>',
    });

    expect(mockSendTransacEmail.mock.calls[0][0]).toEqual({
      subject: 'Test',
      htmlContent: '<p>Cashy</p>',
      sender: { email: 'noreply@cashy.app', name: 'Cashy' },
      to: [{ email: 'user@cashy.app', name: 'User' }],
    });
  });

  it('reads a named sender from MAIL_FROM', async () => {
    delete process.env.BREVO_SENDER_EMAIL;
    delete process.env.BREVO_SENDER_NAME;
    process.env.MAIL_FROM = '"Cashy App" <noreply@cashy.app>';
    const service = new BrevoService();

    await service.sendTransactionalEmail({
      to: 'user@cashy.app',
      subject: 'Test',
      htmlContent: '<p>Cashy</p>',
    });

    expect(mockSendTransacEmail.mock.calls[0][0]).toMatchObject({
      sender: { email: 'noreply@cashy.app', name: 'Cashy App' },
    });
  });

  it('uses the MAIL_FROM name with an explicit sender email', async () => {
    delete process.env.BREVO_SENDER_NAME;
    process.env.MAIL_FROM = 'Cashy Team <legacy@cashy.app>';
    const service = new BrevoService();

    await service.sendTransactionalEmail({
      to: 'user@cashy.app',
      subject: 'Test',
      htmlContent: '<p>Cashy</p>',
    });

    expect(mockSendTransacEmail.mock.calls[0][0]).toMatchObject({
      sender: { email: 'noreply@cashy.app', name: 'Cashy Team' },
    });
  });

  it('accepts a plain MAIL_FROM address', async () => {
    delete process.env.BREVO_SENDER_EMAIL;
    delete process.env.BREVO_SENDER_NAME;
    process.env.MAIL_FROM = 'noreply@cashy.app';
    const service = new BrevoService();

    await service.sendTransactionalEmail({
      to: 'user@cashy.app',
      subject: 'Test',
      htmlContent: '<p>Cashy</p>',
    });

    expect(mockSendTransacEmail.mock.calls[0][0]).toMatchObject({
      sender: { email: 'noreply@cashy.app' },
    });
  });

  it('requires a sender configuration', () => {
    delete process.env.BREVO_SENDER_EMAIL;
    delete process.env.BREVO_SENDER_NAME;
    delete process.env.MAIL_FROM;

    expect(() => new BrevoService()).toThrow('BREVO_SENDER_EMAIL or MAIL_FROM');
  });

  it.each([
    [new Brevo.UnauthorizedError(), 'Brevo API key invalida'],
    [new Brevo.TooManyRequestsError(), 'Brevo limito'],
    [new BrevoTimeoutError(), 'Brevo excedio'],
    [new BrevoError('server error'), 'Brevo API error 500'],
    [new Error('network'), 'network'],
  ])('maps provider errors', async (error, expectedMessage) => {
    mockSendTransacEmail.mockRejectedValue(error);
    const service = new BrevoService();

    await expect(
      service.sendTransactionalEmail({
        to: 'user@cashy.app',
        subject: 'Test',
        htmlContent: '<p>Cashy</p>',
      }),
    ).rejects.toThrow(expectedMessage);
  });
});
