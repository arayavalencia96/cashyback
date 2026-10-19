import { createHash } from 'node:crypto';
import {
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Transaction } from 'firebase-admin/firestore';
import { FirebaseAdminService } from '../common/services/firebase.service';
import { AccountLinkService } from './account-link.service';
import { IntegrationConfig } from './integration.config';
import {
  assignedFromBudget,
  allocationPeriod,
  requireAllocationPeriod,
  safeMinor,
} from './allocation-budget';
import type { AllocationState } from './allocation.contracts';
import type { MonthlyAllocation } from './integration.contracts';

interface StoredMonthlyAllocation extends MonthlyAllocation {
  cashyUserId: string;
  legacyReviewed?: boolean;
  legacyReviewedHash?: string;
}

@Injectable()
export class AllocationService {
  constructor(
    private readonly firebase: FirebaseAdminService,
    private readonly links: AccountLinkService,
    private readonly config: IntegrationConfig,
  ) {}

  ref(userId: string, period: string) {
    const id = createHash('sha256')
      .update(userId + ':' + period)
      .digest('hex');
    return this.firebase.firestore
      .collection('integration_monthly_allocations')
      .doc(id);
  }

  async read(transaction: Transaction, userId: string, period: string) {
    const db = this.firebase.firestore;
    const ref = this.ref(userId, period);
    const budget = (
      await transaction.get(
        db.collection('monthlyBudgets').doc(userId + '_' + period),
      )
    ).data();
    const previous = (await transaction.get(ref)).data() as
      StoredMonthlyAllocation | undefined;
    if (budget && (budget.userId !== userId || budget.monthKey !== period))
      throw new ForbiddenException(
        'El presupuesto no corresponde a esta cuenta y período.',
      );
    if (
      previous &&
      (previous.id !== ref.id ||
        previous.cashyUserId !== userId ||
        previous.period !== period ||
        previous.currency !== 'ARS')
    )
      throw new ServiceUnavailableException('La asignación requiere revisión.');
    const budgetDefined = !!budget && budget.isSalaryDefined !== false;
    const expenses = budgetDefined
      ? (
          await transaction.get(
            db.collection('fixedExpenses').where('userId', '==', userId),
          )
        ).docs.map((doc) => doc.data())
      : [];
    const assignedMinor = budgetDefined
      ? assignedFromBudget(budget, expenses, period)
      : 0;
    const contributedMinor = safeMinor(previous?.contributedMinor ?? 0);
    const reservedMinor = safeMinor(previous?.reservedMinor ?? 0);
    const legacy = await transaction.get(
      db.collection('investments').where('userId', '==', userId),
    );
    const legacyForPeriod = legacy.docs.filter((doc) => {
      const row = doc.data();
      const value: unknown = row.transactionDate ?? row.purchaseDate;
      if (typeof value !== 'string') return false;
      if (/^20\d{2}-\d{2}-\d{2}$/.test(value))
        return value.slice(0, 7) === period;
      const date = new Date(value);
      return (
        Number.isFinite(date.getTime()) && allocationPeriod(date) === period
      );
    });
    const legacySnapshotHash = createHash('sha256')
      .update(
        JSON.stringify(
          legacyForPeriod
            .map((doc) => [
              doc.id,
              Object.entries(doc.data()).sort(([a], [b]) => a.localeCompare(b)),
            ])
            .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
        ),
      )
      .digest('hex');
    const legacyReviewRequired =
      legacyForPeriod.length > 0 &&
      (previous?.legacyReviewed !== true ||
        previous.legacyReviewedHash !== legacySnapshotHash);
    const legacyCommittedMinor = safeMinor(previous?.legacyCommittedMinor ?? 0);
    const changed =
      !previous ||
      previous.assignedMinor !== assignedMinor ||
      !!previous.legacyReviewRequired !== legacyReviewRequired;
    const allocation = this.totals({
      id: ref.id,
      legacyCommittedMinor,
      legacyReviewRequired,
      ...(previous?.legacyReviewed ? { legacyReviewed: true } : {}),
      ...(previous?.legacyReviewedHash
        ? { legacyReviewedHash: previous.legacyReviewedHash }
        : {}),
      period,
      currency: 'ARS',
      assignedMinor,
      contributedMinor,
      reservedMinor,
      availableMinor: 0,
      excessMinor: 0,
      version: previous ? safeMinor(previous.version) + (changed ? 1 : 0) : 1,
    });
    return {
      ref,
      allocation,
      budgetDefined,
      existed: !!previous,
      changed,
      legacySnapshotHash,
    };
  }

  async readStored(
    transaction: Transaction,
    userId: string,
    period: string,
  ): Promise<MonthlyAllocation> {
    const ref = this.ref(userId, period);
    const record = (await transaction.get(ref)).data() as
      StoredMonthlyAllocation | undefined;
    if (
      !record ||
      record.id !== ref.id ||
      record.cashyUserId !== userId ||
      record.period !== period ||
      record.currency !== 'ARS'
    )
      throw new ServiceUnavailableException('La asignación requiere revisión.');
    return this.totals(record);
  }

  totals(allocation: MonthlyAllocation): MonthlyAllocation {
    safeMinor(allocation.assignedMinor);
    safeMinor(allocation.version);
    const occupied = safeMinor(
      safeMinor(allocation.contributedMinor) +
        safeMinor(allocation.reservedMinor) +
        safeMinor(allocation.legacyCommittedMinor ?? 0),
    );
    return {
      ...allocation,
      availableMinor: allocation.legacyReviewRequired
        ? 0
        : Math.max(0, allocation.assignedMinor - occupied),
      excessMinor: Math.max(0, occupied - allocation.assignedMinor),
    };
  }

  store(
    transaction: Transaction,
    userId: string,
    allocation: MonthlyAllocation,
  ): void {
    transaction.set(this.ref(userId, allocation.period), {
      ...this.totals(allocation),
      cashyUserId: userId,
      updatedAt: new Date().toISOString(),
    });
  }

  async forGrowly(
    userId: string,
    linkId: string,
    period: unknown,
  ): Promise<AllocationState> {
    const selected = requireAllocationPeriod(period);
    const cashyUserId = await this.links.authorizedCashyUserId(
      userId,
      linkId,
      'allocations:read',
    );
    return this.snapshot(cashyUserId, selected, { userId, linkId });
  }

  forCashy(userId: string, period: unknown): Promise<AllocationState> {
    this.config.assertEnabled();
    return this.snapshot(userId, requireAllocationPeriod(period));
  }

  private publicAllocation(allocation: MonthlyAllocation): MonthlyAllocation {
    return {
      id: allocation.id,
      period: allocation.period,
      currency: allocation.currency,
      assignedMinor: allocation.assignedMinor,
      contributedMinor: allocation.contributedMinor,
      reservedMinor: allocation.reservedMinor,
      availableMinor: allocation.availableMinor,
      excessMinor: allocation.excessMinor,
      version: allocation.version,
      legacyCommittedMinor: allocation.legacyCommittedMinor ?? 0,
      legacyReviewRequired: allocation.legacyReviewRequired ?? false,
    };
  }

  private async snapshot(
    userId: string,
    period: string,
    grant?: { userId: string; linkId: string },
  ): Promise<AllocationState> {
    return this.firebase.firestore.runTransaction(async (transaction) => {
      if (grant) {
        const link = (
          await transaction.get(
            this.firebase.firestore
              .collection('integration_account_links')
              .doc(grant.linkId),
          )
        ).data();
        if (
          !link ||
          link.status !== 'active' ||
          link.cashyUserId !== userId ||
          link.growlyUserId !== grant.userId ||
          !Array.isArray(link.permissions) ||
          !link.permissions.includes('allocations:read')
        )
          throw new ForbiddenException(
            'La conexión no autoriza esta consulta.',
          );
      }
      const result = await this.read(transaction, userId, period);
      if (!result.budgetDefined && !result.existed)
        return { status: 'not-configured', period };
      if (result.changed) this.store(transaction, userId, result.allocation);
      return {
        status: 'available',
        allocation: this.publicAllocation(result.allocation),
        budgetDefined: result.budgetDefined,
      };
    });
  }
}
