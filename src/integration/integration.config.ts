import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';

@Injectable()
export class IntegrationConfig {
  private readonly logger = new Logger(IntegrationConfig.name);
  readonly enabled: boolean;
  readonly peerApiUrl: string;
  readonly peerFrontendUrl: string;
  readonly callbackUrl: string;
  readonly inboundSecret: string;
  readonly outboundSecret: string;
  readonly requestTimeoutMs: number;
  readonly authorizationTtlSeconds: number;
  readonly reservationTtlSeconds: number;

  constructor(config: ConfigService) {
    const enabled = config.get<string>('INTEGRATION_ENABLED') ?? 'false';
    if (!['true', 'false'].includes(enabled)) {
      throw new Error('INTEGRATION_ENABLED must be true or false.');
    }
    this.enabled = enabled === 'true';
    const required = (name: string): string => {
      const value = config.get<string>(name)?.trim() ?? '';
      if (this.enabled && !value)
        throw new Error('Missing configuration: ' + name);
      return value;
    };
    const url = (name: string): string => {
      const value = required(name);
      if (!value) return '';
      const parsed = new URL(value);
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(
        parsed.hostname,
      );
      if (
        parsed.username ||
        parsed.password ||
        parsed.search ||
        parsed.hash ||
        (parsed.protocol !== 'https:' &&
          !(
            local &&
            parsed.protocol === 'http:' &&
            config.get<string>('NODE_ENV') !== 'production'
          ))
      ) {
        throw new Error('Invalid integration URL: ' + name);
      }
      return value.replace(/\/+$/, '');
    };
    const positiveInteger = (
      name: string,
      fallback: number,
      maximum: number,
    ): number => {
      const value = Number(config.get<string>(name) ?? fallback);
      if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
        throw new Error('Invalid configuration: ' + name);
      }
      return value;
    };
    this.peerApiUrl = url('INTEGRATION_PEER_API_URL');
    this.peerFrontendUrl = url('INTEGRATION_PEER_FRONTEND_URL');
    this.callbackUrl = url('INTEGRATION_CALLBACK_URL');
    this.inboundSecret = required('INTEGRATION_INBOUND_SECRET');
    this.outboundSecret = required('INTEGRATION_OUTBOUND_SECRET');
    if (
      this.enabled &&
      (this.inboundSecret.length < 32 ||
        this.outboundSecret.length < 32 ||
        this.inboundSecret === this.outboundSecret)
    ) {
      throw new Error(
        'Integration requires distinct inbound/outbound secrets of at least 32 characters.',
      );
    }
    this.requestTimeoutMs = positiveInteger(
      'INTEGRATION_REQUEST_TIMEOUT_MS',
      5000,
      30000,
    );
    this.authorizationTtlSeconds = positiveInteger(
      'INTEGRATION_AUTHORIZATION_TTL_SECONDS',
      120,
      600,
    );
    this.reservationTtlSeconds = positiveInteger(
      'INTEGRATION_RESERVATION_TTL_SECONDS',
      300,
      1800,
    );
    this.logger.log(
      JSON.stringify({
        event: 'integration_config_loaded',
        enabled: this.enabled,
        peerApiUrl: this.peerApiUrl,
        peerFrontendUrl: this.peerFrontendUrl,
        callbackUrl: this.callbackUrl,
        inboundSecretLength: this.inboundSecret.length,
        outboundSecretLength: this.outboundSecret.length,
        inboundFingerprint: this.fingerprint(this.inboundSecret),
        outboundFingerprint: this.fingerprint(this.outboundSecret),
        requestTimeoutMs: this.requestTimeoutMs,
      }),
    );
  }

  private fingerprint(value: string): string {
    return value
      ? createHash('sha256').update(value).digest('hex').slice(0, 12)
      : '';
  }

  assertEnabled(): void {
    if (!this.enabled)
      throw new ServiceUnavailableException('Integration is disabled.');
  }
}
