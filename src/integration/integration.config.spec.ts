import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { IntegrationConfig } from './integration.config';

const enabledConfig = {
  INTEGRATION_ENABLED: 'true',
  INTEGRATION_PEER_API_URL: 'http://localhost:3001/api/v1/',
  INTEGRATION_PEER_FRONTEND_URL: 'http://localhost:5173/',
  INTEGRATION_CALLBACK_URL: 'http://localhost:4200/integrations/callback',
  INTEGRATION_INBOUND_SECRET: 'i'.repeat(32),
  INTEGRATION_OUTBOUND_SECRET: 'o'.repeat(32),
  NODE_ENV: 'development',
};

describe('IntegrationConfig', () => {
  it('loads enabled local integration and normalizes trailing slashes', () => {
    const config = new IntegrationConfig(new ConfigService(enabledConfig));

    expect(config.enabled).toBe(true);
    expect(config.peerApiUrl).toBe('http://localhost:3001/api/v1');
    expect(config.peerFrontendUrl).toBe('http://localhost:5173');
  });

  it('requires distinct secrets with at least 32 characters', () => {
    expect(
      () =>
        new IntegrationConfig(
          new ConfigService({
            ...enabledConfig,
            INTEGRATION_OUTBOUND_SECRET:
              enabledConfig.INTEGRATION_INBOUND_SECRET,
          }),
        ),
    ).toThrow('distinct inbound/outbound secrets');
  });

  it('rejects plain HTTP peer URLs in production', () => {
    expect(
      () =>
        new IntegrationConfig(
          new ConfigService({ ...enabledConfig, NODE_ENV: 'production' }),
        ),
    ).toThrow('Invalid integration URL');
  });

  it('reports disabled integration through the public guard', () => {
    const config = new IntegrationConfig(
      new ConfigService({ INTEGRATION_ENABLED: 'false' }),
    );

    expect(() => config.assertEnabled()).toThrow(ServiceUnavailableException);
  });
});
