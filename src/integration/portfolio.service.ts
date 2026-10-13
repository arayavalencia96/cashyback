import {
  BadGatewayException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AccountLinkService } from './account-link.service';
import { IntegrationConfig } from './integration.config';
import {
  isPortfolioSummary,
  type PortfolioSummary,
} from './portfolio.contracts';

@Injectable()
export class PortfolioService {
  constructor(
    private readonly links: AccountLinkService,
    private readonly config: IntegrationConfig,
  ) {}
  async get(userId: string): Promise<PortfolioSummary> {
    this.config.assertEnabled();
    const state = await this.links.getCashyLink(userId);
    if (
      state.status !== 'active' ||
      !state.link.permissions.includes('portfolio:read')
    )
      throw new ForbiddenException(
        'Vinculá las cuentas y autorizá la consulta de cartera de Growly.',
      );
    const linkId = state.link.id;
    const growlyUserId = await this.links.authorizedGrowlyUserId(
      userId,
      linkId,
      'portfolio:read',
    );
    let result: PortfolioSummary;
    try {
      const response = await fetch(
        this.config.peerApiUrl + '/integration/peer/portfolio',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + this.config.outboundSecret,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ growlyUserId, linkId }),
          signal: AbortSignal.timeout(this.config.requestTimeoutMs),
          redirect: 'error',
        },
      );
      if (response.status === 403)
        throw new ForbiddenException(
          'El acceso compartido fue revocado o suspendido.',
        );
      if (!response.ok) throw new Error('Growly no disponible.');
      const value: unknown = await response.json();
      if (
        !value ||
        typeof value !== 'object' ||
        !('ok' in value) ||
        value.ok !== true ||
        !('statuscode' in value) ||
        value.statuscode !== 200 ||
        !('result' in value) ||
        !isPortfolioSummary(value.result)
      )
        throw new BadGatewayException('Resumen de Growly incompatible.');
      result = value.result;
    } catch (error) {
      if (
        error instanceof ForbiddenException ||
        error instanceof BadGatewayException
      )
        throw error;
      throw new ServiceUnavailableException(
        'No se pudo consultar el resumen actualizado de Growly.',
      );
    }
    await this.links.authorizedGrowlyUserId(userId, linkId, 'portfolio:read');
    return result;
  }
}
