import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { IntegrationConfig } from './integration.config';
import type {
  IntegrationDiagnostics,
  IntegrationPeerHealth,
  IntegrationResponse,
  IntegrationStatus,
} from './integration.contracts';

@Injectable()
export class IntegrationService {
  constructor(private readonly config: IntegrationConfig) {}

  status(): IntegrationStatus {
    return {
      application: 'cashy',
      enabled: this.config.enabled,
      accountLinkingAvailable: this.config.enabled,
      peerApplication: 'growly',
      peerFrontendUrl: this.config.peerFrontendUrl,
    };
  }

  peerHealth(): IntegrationPeerHealth {
    return { application: 'cashy', protocolVersion: 1, status: 'ok' };
  }

  async diagnostics(): Promise<IntegrationDiagnostics> {
    this.config.assertEnabled();
    try {
      const response = await fetch(
        this.config.peerApiUrl + '/integration/peer-health',
        {
          headers: { Authorization: 'Bearer ' + this.config.outboundSecret },
          signal: AbortSignal.timeout(this.config.requestTimeoutMs),
          redirect: 'error',
        },
      );
      if (!response.ok) throw new Error('Peer rejected the request.');
      const body: unknown = await response.json();
      if (!this.isPeerResponse(body))
        throw new Error('Incompatible integration response.');
      return {
        application: 'cashy',
        peerApplication: 'growly',
        transport: 'reachable',
        protocolVersion: 1,
      };
    } catch {
      throw new ServiceUnavailableException(
        'Integration peer is unavailable or incompatible.',
      );
    }
  }

  private isPeerResponse(
    value: unknown,
  ): value is IntegrationResponse<IntegrationPeerHealth> {
    if (
      !value ||
      typeof value !== 'object' ||
      !('result' in value) ||
      !('ok' in value) ||
      value.ok !== true ||
      !('statuscode' in value) ||
      value.statuscode !== 200
    )
      return false;
    const result = value.result;
    return (
      !!result &&
      typeof result === 'object' &&
      'application' in result &&
      result.application === 'growly' &&
      'protocolVersion' in result &&
      result.protocolVersion === 1 &&
      'status' in result &&
      result.status === 'ok'
    );
  }
}
