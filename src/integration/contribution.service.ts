import { createHash } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { FirebaseAdminService } from '../common/services/firebase.service';
import { AccountLinkService } from './account-link.service';
import { AllocationService } from './allocation.service';
import { allocationPeriod, safeMinor } from './allocation-budget';
import { IntegrationConfig } from './integration.config';
import type {
  ContributionIdentity,
  ContributionLookup,
  ContributionReceipt,
  ReserveContributionInput,
} from './contribution.contracts';

interface StoredContribution extends ReserveContributionInput {
  cashyUserId: string;
  fingerprint: string;
  status: ContributionReceipt['status'];
  expiresAt: string;
  reason: string;
}

@Injectable()
export class ContributionService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private sweeping = false;
  private readonly logger = new Logger(ContributionService.name);
  constructor(
    private readonly firebase: FirebaseAdminService,
    private readonly links: AccountLinkService,
    private readonly allocations: AllocationService,
    private readonly config: IntegrationConfig,
  ) {}

  private ref(id: string) {
    return this.firebase.firestore
      .collection('integration_allocation_contributions')
      .doc(id);
  }
  private active(id: string) {
    return this.firebase.firestore
      .collection('integration_active_reservations')
      .doc(id);
  }
  private fingerprint(input: ReserveContributionInput): string {
    return createHash('sha256')
      .update(
        JSON.stringify([
          input.id,
          input.growlyUserId,
          input.linkId,
          input.growlyMovementId,
          input.allocationId,
          input.period,
          input.currency,
          input.amountMinor,
          input.allocationAmountMinor,
          input.exchangeRateArsPerUsd,
          input.validUntil,
        ]),
      )
      .digest('hex');
  }
  private owned(record: StoredContribution, actor: ContributionIdentity): void {
    if (
      record.growlyUserId !== actor.growlyUserId ||
      record.linkId !== actor.linkId ||
      record.id !== actor.id
    )
      throw new ForbiddenException('El aporte no pertenece a esta conexión.');
  }
  private matching(
    record: StoredContribution,
    input: ReserveContributionInput,
  ): void {
    this.owned(record, input);
    if (record.fingerprint !== this.fingerprint(input))
      throw new ConflictException(
        'La clave de aporte ya fue utilizada con otros datos.',
      );
  }
  private receipt(record: StoredContribution): ContributionReceipt {
    const {
      id,
      status,
      allocationId,
      allocationAmountMinor,
      growlyMovementId,
      expiresAt,
      reason,
    } = record;
    return {
      id,
      status,
      allocationId,
      allocationAmountMinor,
      growlyMovementId,
      expiresAt,
      reason,
    };
  }
  async lookup(actor: ContributionIdentity): Promise<ContributionLookup> {
    this.config.assertEnabled();
    const record = (await this.ref(actor.id).get()).data() as
      StoredContribution | undefined;
    if (!record) return { id: actor.id, status: 'missing' };
    this.owned(record, actor);
    if (
      record.status === 'reserved' &&
      Date.parse(record.expiresAt) <= Date.now()
    )
      return this.cancel(record, 'Reserva vencida');
    return this.receipt(record);
  }

  async reserve(input: ReserveContributionInput): Promise<ContributionReceipt> {
    this.config.assertEnabled();
    const previous = (await this.ref(input.id).get()).data() as
      StoredContribution | undefined;
    if (previous) {
      this.matching(previous, input);
      return (await this.lookup(input)) as ContributionReceipt;
    }
    const userId = await this.links.authorizedCashyUserId(
      input.growlyUserId,
      input.linkId,
      'contributions:write',
    );
    return this.firebase.firestore.runTransaction(async (transaction) => {
      const existing = (await transaction.get(this.ref(input.id))).data() as
        StoredContribution | undefined;
      if (existing) {
        this.matching(existing, input);
        return this.receipt(existing);
      }
      if (
        input.period !== allocationPeriod() ||
        Date.parse(input.validUntil) <= Date.now()
      )
        throw new ConflictException(
          'La preparación venció o pertenece a otro mes.',
        );
      const link = (
        await transaction.get(
          this.firebase.firestore
            .collection('integration_account_links')
            .doc(input.linkId),
        )
      ).data();
      if (
        !link ||
        link.status !== 'active' ||
        link.cashyUserId !== userId ||
        link.growlyUserId !== input.growlyUserId ||
        !Array.isArray(link.permissions) ||
        !link.permissions.includes('contributions:write')
      )
        throw new ForbiddenException('La conexión no autoriza el aporte.');
      const result = await this.allocations.read(
        transaction,
        userId,
        input.period,
      );
      if (!result.budgetDefined || result.allocation.id !== input.allocationId)
        throw new ConflictException('El presupuesto ya no está disponible.');
      if (input.allocationAmountMinor > result.allocation.availableMinor)
        throw new ConflictException(
          'El aporte supera el presupuesto disponible.',
        );
      const record: StoredContribution = {
        ...input,
        cashyUserId: userId,
        fingerprint: this.fingerprint(input),
        status: 'reserved',
        reason: '',
        expiresAt: new Date(
          Math.min(
            Date.parse(input.validUntil),
            Date.now() + this.config.reservationTtlSeconds * 1000,
          ),
        ).toISOString(),
      };
      this.allocations.store(transaction, userId, {
        ...result.allocation,
        reservedMinor: safeMinor(
          result.allocation.reservedMinor + input.allocationAmountMinor,
        ),
        version: result.allocation.version + 1,
      });
      transaction.create(this.ref(input.id), record);
      transaction.set(this.active(input.id), { expiresAt: record.expiresAt });
      return this.receipt(record);
    });
  }

  async confirm(actor: ContributionIdentity): Promise<ContributionReceipt> {
    this.config.assertEnabled();
    const record = (await this.ref(actor.id).get()).data() as
      StoredContribution | undefined;
    if (!record) throw new ConflictException('El aporte no fue reservado.');
    this.owned(record, actor);
    if (record.status !== 'reserved') return this.receipt(record);
    try {
      await this.links.authorizedCashyUserId(
        actor.growlyUserId,
        actor.linkId,
        'contributions:write',
      );
    } catch (error) {
      if (error instanceof ForbiddenException)
        return this.cancel(record, 'Conexión revocada o suspendida');
      throw error;
    }
    return this.finish(record, true, '');
  }

  async cancel(
    input: ReserveContributionInput,
    reason = 'Aporte cancelado',
  ): Promise<ContributionReceipt> {
    this.config.assertEnabled();
    return this.finish(input, false, reason);
  }

  private async finish(
    input: ReserveContributionInput,
    confirm: boolean,
    reason: string,
  ): Promise<ContributionReceipt> {
    return this.firebase.firestore.runTransaction(async (transaction) => {
      const record = (await transaction.get(this.ref(input.id))).data() as
        StoredContribution | undefined;
      if (!record) {
        if (confirm) throw new ConflictException('El aporte no fue reservado.');
        // Evita que una reserva tardía reviva una operación ya cancelada.
        const tombstone: StoredContribution = {
          ...input,
          cashyUserId: '',
          fingerprint: this.fingerprint(input),
          status: 'cancelled',
          expiresAt: input.validUntil,
          reason,
        };
        transaction.create(this.ref(input.id), tombstone);
        return this.receipt(tombstone);
      }
      this.matching(record, input);
      if (record.status !== 'reserved') return this.receipt(record);
      let commit = confirm && Date.parse(record.expiresAt) > Date.now();
      if (confirm) {
        const link = (
          await transaction.get(
            this.firebase.firestore
              .collection('integration_account_links')
              .doc(record.linkId),
          )
        ).data();
        commit =
          commit &&
          !!link &&
          link.status === 'active' &&
          link.growlyUserId === record.growlyUserId &&
          link.cashyUserId === record.cashyUserId &&
          Array.isArray(link.permissions) &&
          link.permissions.includes('contributions:write');
      }
      const allocation = commit
        ? (
            await this.allocations.read(
              transaction,
              record.cashyUserId,
              record.period,
            )
          ).allocation
        : await this.allocations.readStored(
            transaction,
            record.cashyUserId,
            record.period,
          );
      const reservedMinor = safeMinor(
        allocation.reservedMinor - record.allocationAmountMinor,
      );
      this.allocations.store(transaction, record.cashyUserId, {
        ...allocation,
        reservedMinor,
        contributedMinor: safeMinor(
          allocation.contributedMinor +
            (commit ? record.allocationAmountMinor : 0),
        ),
        version: allocation.version + 1,
      });
      const completed: StoredContribution = {
        ...record,
        status: commit ? 'confirmed' : 'cancelled',
        reason: commit ? '' : reason || 'Reserva vencida o conexión revocada',
      };
      transaction.set(this.ref(input.id), completed);
      transaction.delete(this.active(input.id));
      return this.receipt(completed);
    });
  }

  onModuleInit(): void {
    if (!this.config.enabled) return;
    this.timer = setInterval(() => void this.expire(), 60000);
    this.timer.unref();
    void this.expire();
  }
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
  async expire(): Promise<void> {
    if (this.sweeping || !this.config.enabled) return;
    this.sweeping = true;
    try {
      const expired = await this.firebase.firestore
        .collection('integration_active_reservations')
        .where('expiresAt', '<=', new Date().toISOString())
        .limit(100)
        .get();
      for (const entry of expired.docs) {
        const record = (await this.ref(entry.id).get()).data() as
          StoredContribution | undefined;
        if (record?.status === 'reserved')
          await this.cancel(record, 'Reserva vencida');
      }
    } catch {
      this.logger.warn(
        'No se pudo completar la limpieza de reservas; se reintentará.',
      );
    } finally {
      this.sweeping = false;
    }
  }
}
