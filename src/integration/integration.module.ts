import { Module } from '@nestjs/common';
import { PortfolioService } from './portfolio.service';
import { LegacyReviewService } from './legacy-review.service';
import { PortfolioController } from './portfolio.controller';
import { ContributionService } from './contribution.service';
import { ContributionAdjustmentService } from './contribution-adjustment.service';
import { ContributionController } from './contribution.controller';
import { AllocationController } from './allocation.controller';
import { AllocationService } from './allocation.service';
import { AccountLinkController } from './account-link.controller';
import { AccountLinkService } from './account-link.service';
import { IntegrationUserGuard } from './integration-user.guard';
import { ConfigModule } from '@nestjs/config';
import { CommonModule } from '../common/common.module';
import { IntegrationConfig } from './integration.config';
import { IntegrationController } from './integration.controller';
import { IntegrationPeerGuard } from './integration-peer.guard';
import { IntegrationService } from './integration.service';

@Module({
  imports: [ConfigModule, CommonModule],
  controllers: [
    PortfolioController,
    IntegrationController,
    AccountLinkController,
    AllocationController,
    ContributionController,
  ],
  providers: [
    LegacyReviewService,
    PortfolioService,
    ContributionAdjustmentService,
    IntegrationConfig,
    IntegrationPeerGuard,
    IntegrationService,
    IntegrationUserGuard,
    AccountLinkService,
    AllocationService,
    ContributionService,
  ],
  exports: [IntegrationService, AccountLinkService],
})
export class IntegrationModule {}
