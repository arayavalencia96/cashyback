import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns the service health status', () => {
    const controller = new HealthController();

    expect(controller.health()).toEqual({
      result: {
        status: 'ok',
        timestamp: expect.any(String) as string,
      },
      message: 'Service is healthy',
      description: 'The application is running and ready to receive requests.',
      statuscode: 200,
      ok: true,
    });
  });
});
