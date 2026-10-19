import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { IntegrationConfig } from './integration.config';
import { IntegrationService } from './integration.service';

async function check(): Promise<void> {
  const config = new IntegrationConfig(new ConfigService());
  const service = new IntegrationService(config);
  config.assertEnabled();
  const ownApi = 'http://localhost:' + (process.env.PORT ?? '3000') + '';
  for (const route of ['status', 'diagnostics', 'peer-health']) {
    const response = await fetch(ownApi + '/integration/' + route, {
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    });
    if (response.status !== 401)
      throw new Error(route + ': expected HTTP 401.');
    console.log(route + ': unauthenticated requests rejected (401)');
  }
  const invalid = await fetch(ownApi + '/integration/peer-health', {
    headers: { Authorization: 'Bearer invalid-credential' },
    signal: AbortSignal.timeout(config.requestTimeoutMs),
  });
  if (invalid.status !== 401)
    throw new Error('Invalid service credential was not rejected.');
  console.log('peer-health: invalid service credential rejected (401)');
  const result = await service.diagnostics();
  console.log(JSON.stringify(result));
}

void check().catch(() => {
  console.error(
    'Integration check failed. Check both backends, ports and local integration configuration.',
  );
  process.exitCode = 1;
});
