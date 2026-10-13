import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { FirebaseAdminService } from '../common/services/firebase.service';
import { AllocationService } from './allocation.service';
import { IntegrationConfig } from './integration.config';
import { allocationPeriod } from './allocation-budget';
import { requireLinkId } from './link-input';

interface LegacyReviewInput {
  id: string;
  period: string;
  usedMinor: number;
  expectedVersion: number;
  reason: string;
}
interface ReviewReceipt extends LegacyReviewInput {
  cashyUserId: string;
  reviewedAt: string;
}
function input(value: unknown): LegacyReviewInput {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException('Revisión inválida.');
  const row = value as Record<string, unknown>,
    keys = ['id', 'period', 'usedMinor', 'expectedVersion', 'reason'];
  if (
    Object.keys(row).length !== keys.length ||
    keys.some((key) => !(key in row)) ||
    typeof row.id !== 'string' ||
    typeof row.period !== 'string' ||
    row.period !== allocationPeriod() ||
    typeof row.usedMinor !== 'number' ||
    !Number.isSafeInteger(row.usedMinor) ||
    row.usedMinor < 0 ||
    typeof row.expectedVersion !== 'number' ||
    !Number.isSafeInteger(row.expectedVersion) ||
    row.expectedVersion < 1 ||
    typeof row.reason !== 'string' ||
    !row.reason.trim() ||
    row.reason.length > 500
  )
    throw new BadRequestException(
      'Indicá el período actual, un importe válido y el motivo de la revisión.',
    );
  return {
    id: requireLinkId(row.id),
    period: row.period,
    usedMinor: row.usedMinor,
    expectedVersion: row.expectedVersion,
    reason: row.reason.trim(),
  };
}
@Injectable()
export class LegacyReviewService {
  constructor(
    private readonly firebase: FirebaseAdminService,
    private readonly allocations: AllocationService,
    private readonly config: IntegrationConfig,
  ) {}
  async review(userId: string, body: unknown) {
    this.config.assertEnabled();
    const data = input(body),
      ref = this.firebase.firestore
        .collection('integration_legacy_budget_reviews')
        .doc(data.id);
    return this.firebase.firestore.runTransaction(async (tx) => {
      const previous = (await tx.get(ref)).data() as ReviewReceipt | undefined;
      if (previous) {
        if (previous.cashyUserId !== userId)
          throw new ForbiddenException('Revisión de otra cuenta.');
        for (const key of Object.keys(data) as (keyof LegacyReviewInput)[])
          if (previous[key] !== data[key])
            throw new ConflictException(
              'La clave de revisión ya se utilizó con otros datos.',
            );
        return { id: data.id, period: data.period, usedMinor: data.usedMinor };
      }
      const result = await this.allocations.read(tx, userId, data.period);
      if (
        !result.budgetDefined ||
        result.allocation.version !== data.expectedVersion
      )
        throw new ConflictException(
          'El presupuesto cambió. Actualizá antes de confirmar la revisión.',
        );
      const allocation = {
        ...result.allocation,
        legacyCommittedMinor: data.usedMinor,
        legacyReviewRequired: false,
        legacyReviewed: true,
        legacyReviewedHash: result.legacySnapshotHash,
        version: result.allocation.version + 1,
      };
      this.allocations.store(tx, userId, allocation);
      tx.create(ref, {
        ...data,
        cashyUserId: userId,
        reviewedAt: new Date().toISOString(),
      } satisfies ReviewReceipt);
      return { id: data.id, period: data.period, usedMinor: data.usedMinor };
    });
  }
}
