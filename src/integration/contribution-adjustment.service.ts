import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { FirebaseAdminService } from '../common/services/firebase.service';
import { AllocationService } from './allocation.service';
import { AccountLinkService } from './account-link.service';
import { IntegrationConfig } from './integration.config';
import { safeMinor } from './allocation-budget';
import type { ReserveContributionInput } from './contribution.contracts';
import type {
  ContributionAdjustmentIdentity,
  ContributionAdjustmentInput,
  ContributionAdjustmentLookup,
  ContributionAdjustmentReceipt,
} from './contribution-adjustment.contracts';

interface ContributionRecord extends ReserveContributionInput {
  cashyUserId: string;
  status: string;
  revision?: number;
  effective?: {
    amountMinor: number;
    allocationAmountMinor: number;
    exchangeRateArsPerUsd: number;
  };
  voided?: boolean;
}
@Injectable()
export class ContributionAdjustmentService {
  constructor(
    private readonly firebase: FirebaseAdminService,
    private readonly links: AccountLinkService,
    private readonly allocations: AllocationService,
    private readonly config: IntegrationConfig,
  ) {}
  private ref(id: string) {
    return this.firebase.firestore
      .collection('integration_contribution_adjustments')
      .doc(id);
  }
  private owned(
    receipt: ContributionAdjustmentReceipt,
    actor: ContributionAdjustmentIdentity,
  ): void {
    if (
      receipt.id !== actor.id ||
      receipt.contributionId !== actor.contributionId ||
      receipt.growlyUserId !== actor.growlyUserId ||
      receipt.linkId !== actor.linkId
    )
      throw new ForbiddenException('Corrección de otra cuenta.');
  }
  private matching(
    receipt: ContributionAdjustmentReceipt,
    input: ContributionAdjustmentInput,
  ): void {
    this.owned(receipt, input);
    for (const key of [
      'expectedRevision',
      'kind',
      'amountMinor',
      'allocationAmountMinor',
      'exchangeRateArsPerUsd',
    ] as const)
      if (receipt[key] !== input[key])
        throw new ConflictException(
          'La clave de corrección ya fue utilizada con otros datos.',
        );
  }
  async lookup(
    actor: ContributionAdjustmentIdentity,
  ): Promise<ContributionAdjustmentLookup> {
    this.config.assertEnabled();
    const receipt = (await this.ref(actor.id).get()).data() as
      ContributionAdjustmentReceipt | undefined;
    if (!receipt) return { ...actor, status: 'missing' };
    this.owned(receipt, actor);
    return receipt;
  }
  async apply(
    input: ContributionAdjustmentInput,
    reject = false,
  ): Promise<ContributionAdjustmentReceipt> {
    this.config.assertEnabled();
    const previous = (await this.ref(input.id).get()).data() as
      ContributionAdjustmentReceipt | undefined;
    if (previous) {
      this.matching(previous, input);
      return previous;
    }
    let authorizedUser = '';
    try {
      if (!reject)
        authorizedUser = await this.links.authorizedCashyUserId(
          input.growlyUserId,
          input.linkId,
          'contributions:write',
        );
    } catch (error) {
      if (!(error instanceof ForbiddenException)) throw error;
    }
    return this.firebase.firestore.runTransaction(async (tx) => {
      const previous = (await tx.get(this.ref(input.id))).data() as
        ContributionAdjustmentReceipt | undefined;
      if (previous) {
        this.matching(previous, input);
        return previous;
      }
      const ref = this.firebase.firestore
        .collection('integration_allocation_contributions')
        .doc(input.contributionId);
      const record = (await tx.get(ref)).data() as
        ContributionRecord | undefined;
      if (
        !record ||
        record.growlyUserId !== input.growlyUserId ||
        record.linkId !== input.linkId
      )
        throw new ForbiddenException('Aporte de otra cuenta o inexistente.');
      const link = (
        await tx.get(
          this.firebase.firestore
            .collection('integration_account_links')
            .doc(input.linkId),
        )
      ).data();
      const revision = record.revision ?? 1;
      const result: ContributionAdjustmentReceipt = {
        ...input,
        revision,
        status: 'rejected',
        reason: '',
      };
      if (
        !authorizedUser ||
        record.cashyUserId !== authorizedUser ||
        !link ||
        link.status !== 'active' ||
        link.cashyUserId !== authorizedUser ||
        link.growlyUserId !== input.growlyUserId ||
        !Array.isArray(link.permissions) ||
        !link.permissions.includes('contributions:write')
      )
        result.reason = 'La vinculación fue revocada o suspendida.';
      else if (
        record.status !== 'confirmed' ||
        record.voided ||
        revision !== input.expectedRevision
      )
        result.reason = 'El aporte cambió o ya fue anulado.';
      else {
        const expected =
          record.currency === 'ARS'
            ? input.amountMinor
            : Number(
                (BigInt(input.amountMinor) *
                  BigInt(
                    input.exchangeRateArsPerUsd.toFixed(8).replace('.', ''),
                  ) +
                  50000000n) /
                  100000000n,
              );
        if (
          (record.currency === 'ARS' && input.exchangeRateArsPerUsd !== 1) ||
          expected !== input.allocationAmountMinor
        )
          throw new ConflictException(
            'Conversión incompatible con la moneda original.',
          );
        const delta =
          input.allocationAmountMinor -
          (record.effective?.allocationAmountMinor ??
            record.allocationAmountMinor);
        const allocation =
          delta > 0
            ? (
                await this.allocations.read(
                  tx,
                  record.cashyUserId,
                  record.period,
                )
              ).allocation
            : await this.allocations.readStored(
                tx,
                record.cashyUserId,
                record.period,
              );
        if (delta > allocation.availableMinor)
          result.reason =
            'La corrección supera el disponible del mes original.';
        else {
          this.allocations.store(tx, record.cashyUserId, {
            ...allocation,
            contributedMinor: safeMinor(allocation.contributedMinor + delta),
            version: allocation.version + 1,
          });
          result.status = 'applied';
          result.revision = revision + 1;
          tx.set(ref, {
            ...record,
            revision: result.revision,
            effective: {
              amountMinor: input.amountMinor,
              allocationAmountMinor: input.allocationAmountMinor,
              exchangeRateArsPerUsd: input.exchangeRateArsPerUsd,
            },
            voided: input.kind === 'void',
          });
        }
      }
      tx.create(this.ref(input.id), result);
      return result;
    });
  }
}
