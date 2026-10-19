import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  GoneException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { FirebaseAdminService } from '../common/services/firebase.service';
import { IntegrationConfig } from './integration.config';
import { requireLinkToken } from './link-input';
import { ACCOUNT_LINK_PERMISSIONS } from './link.contracts';
import type { IntegrationPermission } from './integration.contracts';
import type {
  AccountLinkState,
  AccountLinkView,
  LinkConsent,
  LinkRedirect,
  StartLinkResult,
  RevocationReceipt,
  LinkedAccountIdentity,
} from './link.contracts';

interface StoredRequest {
  renewLinkId?: string;
  permissions?: IntegrationPermission[];
  cashyUserId: string;
  cashyEmail: string;
  challenge: string;
  state: string;
  expiresAt: number;
  status: 'pending' | 'approved' | 'completed' | 'cancelled';
  growlyUserId?: string;
  growlyEmail?: string;
  authorizationCodeHash?: string;
  linkId?: string;
  cashyGeneration?: number;
  growlyGeneration?: number;
}

interface StoredLink extends AccountLinkView {
  cashyUserId: string;
  growlyUserId: string;
  status: 'active' | 'revoked';
  revokedAt?: string;
  revokedBy?: 'cashy' | 'growly' | 'account-unavailable';
}

@Injectable()
export class AccountLinkService {
  constructor(
    private readonly firebase: FirebaseAdminService,
    private readonly config: IntegrationConfig,
  ) {}

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private requestRef(token: string) {
    return this.firebase.firestore
      .collection('integration_link_requests')
      .doc(this.hash(requireLinkToken(token)));
  }

  private cashyRef(userId: string) {
    return this.firebase.firestore
      .collection('integration_cashy_links')
      .doc(this.hash(userId));
  }

  private growlyRef(userId: string) {
    return this.firebase.firestore
      .collection('integration_growly_links')
      .doc(this.hash(userId));
  }

  private generationRef(application: 'cashy' | 'growly', userId: string) {
    return this.firebase.firestore
      .collection('integration_link_generations')
      .doc(application + '-' + this.hash(userId));
  }

  private linkRef(linkId: string) {
    return this.firebase.firestore
      .collection('integration_account_links')
      .doc(linkId);
  }

  private notLinked(): AccountLinkState {
    return {
      status: 'not-linked',
      enabled: this.config.enabled,
      peerFrontendUrl: this.config.peerFrontendUrl,
    };
  }

  private view(link: StoredLink): AccountLinkView {
    return {
      id: link.id,
      cashyEmail: link.cashyEmail,
      growlyEmail: link.growlyEmail,
      linkedAt: link.linkedAt,
      permissions: [...link.permissions],
    };
  }

  private validRequest(data: StoredRequest | undefined): StoredRequest {
    if (!data || data.status === 'cancelled')
      throw new GoneException('La solicitud fue cancelada o no existe.');
    if (data.status !== 'completed' && data.expiresAt <= Date.now())
      throw new GoneException(
        'La solicitud venció. Iniciá una nueva conexión desde Cashy.',
      );
    return data;
  }

  async getCashyLink(userId: string): Promise<AccountLinkState> {
    const link = (await this.cashyRef(userId).get()).data() as
      StoredLink | undefined;
    return link ? this.refreshLink(link) : this.notLinked();
  }

  async getGrowlyLink(userId: string): Promise<AccountLinkState> {
    this.config.assertEnabled();
    const index = (await this.growlyRef(userId).get()).data() as
      { cashyUserId: string } | undefined;
    if (!index) return this.notLinked();
    const link = (await this.cashyRef(index.cashyUserId).get()).data() as
      StoredLink | undefined;
    if (!link || link.growlyUserId !== userId)
      throw new ConflictException('El vínculo requiere revisión.');
    return this.refreshLink(link);
  }

  async start(
    user: DecodedIdToken,
    challenge: string,
    state: string,
    renew = false,
  ): Promise<StartLinkResult> {
    this.config.assertEnabled();
    requireLinkToken(challenge);
    requireLinkToken(state);
    const token = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + this.config.authorizationTtlSeconds * 1000;
    await this.firebase.firestore.runTransaction(async (tx) => {
      const [account, generation] = await Promise.all([
        tx.get(this.cashyRef(user.uid)),
        tx.get(this.generationRef('cashy', user.uid)),
      ]);
      if (account.exists && !renew)
        throw new ConflictException('Tu cuenta Cashy ya está vinculada.');
      const existing = account.data() as StoredLink | undefined;
      if (renew && (!existing || existing.status !== 'active'))
        throw new ConflictException('No hay una conexión activa para renovar.');
      tx.create(this.requestRef(token), {
        permissions: [...ACCOUNT_LINK_PERMISSIONS],
        ...(renew && existing ? { renewLinkId: existing.id } : {}),
        cashyUserId: user.uid,
        cashyEmail: user.email ?? '',
        challenge,
        state,
        expiresAt,
        status: 'pending',
        cashyGeneration:
          (generation.data() as { version: number } | undefined)?.version ?? 0,
      } satisfies StoredRequest);
    });
    const url = new URL('/integrations/connect', this.config.peerFrontendUrl);
    url.hash = new URLSearchParams({ requestToken: token }).toString();
    return {
      requestToken: token,
      authorizationUrl: url.toString(),
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  async preview(
    token: string,
    growlyUserId: string,
    growlyEmail: string,
  ): Promise<LinkConsent> {
    this.config.assertEnabled();
    const request = this.validRequest(
      (await this.requestRef(token).get()).data() as StoredRequest | undefined,
    );
    if (request.status !== 'pending')
      throw new ConflictException('Esta solicitud ya fue utilizada.');
    const [cashy, growly, generation] = await Promise.all([
      this.cashyRef(request.cashyUserId).get(),
      this.growlyRef(growlyUserId).get(),
      this.generationRef('cashy', request.cashyUserId).get(),
    ]);
    if (
      ((generation.data() as { version: number } | undefined)?.version ?? 0) !==
      (request.cashyGeneration ?? 0)
    ) {
      throw new GoneException(
        'La solicitud es anterior a una desvinculación. Iniciá una nueva conexión.',
      );
    }
    this.assertLinkAvailability(
      request,
      cashy.data() as StoredLink | undefined,
      growly.data() as { cashyUserId: string; linkId: string } | undefined,
      growlyUserId,
    );
    return {
      cashyEmail: request.cashyEmail,
      growlyUserId,
      growlyEmail,
      expiresAt: new Date(request.expiresAt).toISOString(),
      permissions: request.permissions ?? [
        'allocations:read',
        'contributions:write',
        'contributions:read',
      ],
    };
  }

  async approve(
    token: string,
    growlyUserId: string,
    growlyEmail: string,
  ): Promise<LinkRedirect> {
    this.config.assertEnabled();
    const code = randomBytes(32).toString('base64url');
    const request = await this.firebase.firestore.runTransaction(async (tx) => {
      const ref = this.requestRef(token);
      const data = this.validRequest(
        (await tx.get(ref)).data() as StoredRequest | undefined,
      );
      if (data.status !== 'pending')
        throw new ConflictException('Esta solicitud ya fue utilizada.');
      const [cashy, growly, cashyGeneration, growlyGeneration] =
        await Promise.all([
          tx.get(this.cashyRef(data.cashyUserId)),
          tx.get(this.growlyRef(growlyUserId)),
          tx.get(this.generationRef('cashy', data.cashyUserId)),
          tx.get(this.generationRef('growly', growlyUserId)),
        ]);
      if (
        ((cashyGeneration.data() as { version: number } | undefined)?.version ??
          0) !== (data.cashyGeneration ?? 0)
      ) {
        throw new GoneException(
          'La solicitud es anterior a una desvinculación. Iniciá una nueva conexión.',
        );
      }
      this.assertLinkAvailability(
        data,
        cashy.data() as StoredLink | undefined,
        growly.data() as { cashyUserId: string; linkId: string } | undefined,
        growlyUserId,
      );
      tx.update(ref, {
        status: 'approved',
        growlyUserId,
        growlyEmail,
        authorizationCodeHash: this.hash(code),
        growlyGeneration:
          (growlyGeneration.data() as { version: number } | undefined)
            ?.version ?? 0,
      });
      return data;
    });
    return this.redirect({ requestToken: token, state: request.state, code });
  }

  async deny(token: string): Promise<LinkRedirect> {
    this.config.assertEnabled();
    const request = await this.firebase.firestore.runTransaction(async (tx) => {
      const ref = this.requestRef(token);
      const data = this.validRequest(
        (await tx.get(ref)).data() as StoredRequest | undefined,
      );
      if (data.status !== 'pending')
        throw new ConflictException('Esta solicitud ya fue utilizada.');
      tx.update(ref, { status: 'cancelled' });
      return data;
    });
    return this.redirect({
      requestToken: token,
      state: request.state,
      denied: 'true',
    });
  }

  async complete(
    user: DecodedIdToken,
    token: string,
    code: string,
    verifier: string,
  ): Promise<AccountLinkView> {
    this.config.assertEnabled();
    requireLinkToken(code);
    requireLinkToken(verifier);
    const proof = createHash('sha256').update(verifier).digest('base64url');
    const linkId = randomUUID();
    return this.firebase.firestore.runTransaction(async (tx) => {
      const ref = this.requestRef(token);
      const request = this.validRequest(
        (await tx.get(ref)).data() as StoredRequest | undefined,
      );
      if (
        request.cashyUserId !== user.uid ||
        !this.equal(request.challenge, proof) ||
        !request.authorizationCodeHash ||
        !this.equal(request.authorizationCodeHash, this.hash(code))
      ) {
        throw new UnauthorizedException(
          'La solicitud no corresponde a esta cuenta o a este navegador.',
        );
      }
      if (request.status !== 'approved' && request.status !== 'completed') {
        throw new ConflictException(
          'La solicitud no tiene consentimiento confirmado.',
        );
      }
      if (!request.growlyUserId || !request.growlyEmail)
        throw new BadRequestException('Solicitud incompleta.');
      const [cashy, growly, cashyGeneration, growlyGeneration] =
        await Promise.all([
          tx.get(this.cashyRef(user.uid)),
          tx.get(this.growlyRef(request.growlyUserId)),
          tx.get(this.generationRef('cashy', user.uid)),
          tx.get(this.generationRef('growly', request.growlyUserId)),
        ]);
      if (
        ((cashyGeneration.data() as { version: number } | undefined)?.version ??
          0) !== (request.cashyGeneration ?? 0) ||
        ((growlyGeneration.data() as { version: number } | undefined)
          ?.version ?? 0) !== (request.growlyGeneration ?? 0)
      ) {
        throw new GoneException(
          'La autorización es anterior a una desvinculación. Iniciá una nueva conexión.',
        );
      }
      if (request.status === 'completed') {
        const existing = cashy.data() as StoredLink | undefined;
        if (!existing || existing.id !== request.linkId)
          throw new ConflictException('El vínculo cambió.');
        return this.view(existing);
      }
      this.assertLinkAvailability(
        request,
        cashy.data() as StoredLink | undefined,
        growly.data() as { cashyUserId: string; linkId: string } | undefined,
        request.growlyUserId,
      );
      if (request.renewLinkId) {
        const existing = cashy.data() as StoredLink;
        const audit = (await tx.get(this.linkRef(existing.id))).data() as
          StoredLink | undefined;
        if (
          !audit ||
          audit.status !== 'active' ||
          audit.cashyUserId !== user.uid ||
          audit.growlyUserId !== request.growlyUserId
        )
          throw new ConflictException('La conexión cambió.');
        const renewed: StoredLink = {
          ...existing,
          cashyEmail: user.email ?? '',
          growlyEmail: request.growlyEmail,
          permissions: request.permissions ?? existing.permissions,
        };
        tx.set(this.cashyRef(user.uid), renewed);
        tx.set(this.linkRef(existing.id), renewed);
        tx.create(
          this.firebase.firestore
            .collection('integration_link_permission_reviews')
            .doc(this.hash(token)),
          {
            linkId: existing.id,
            cashyUserId: user.uid,
            growlyUserId: request.growlyUserId,
            previousPermissions: existing.permissions,
            permissions: renewed.permissions,
            reviewedAt: new Date().toISOString(),
          },
        );
        tx.update(ref, { status: 'completed', linkId: existing.id });
        return this.view(renewed);
      }
      const link: StoredLink = {
        id: linkId,
        cashyUserId: user.uid,
        cashyEmail: user.email ?? '',
        growlyUserId: request.growlyUserId,
        growlyEmail: request.growlyEmail,
        linkedAt: new Date().toISOString(),
        permissions: request.permissions ?? [
          'allocations:read',
          'contributions:write',
          'contributions:read',
        ],
        status: 'active',
      };
      tx.create(this.cashyRef(user.uid), link);
      tx.create(
        this.firebase.firestore
          .collection('integration_account_links')
          .doc(linkId),
        link,
      );
      tx.create(this.growlyRef(request.growlyUserId), {
        cashyUserId: user.uid,
        linkId,
      });
      tx.update(ref, { status: 'completed', linkId });
      return this.view(link);
    });
  }

  private assertLinkAvailability(
    request: Pick<StoredRequest, 'renewLinkId' | 'cashyUserId'>,
    cashy: StoredLink | undefined,
    growly: { cashyUserId: string; linkId: string } | undefined,
    growlyUserId: string,
  ): void {
    if (request.renewLinkId) {
      if (
        !cashy ||
        cashy.status !== 'active' ||
        cashy.id !== request.renewLinkId ||
        cashy.cashyUserId !== request.cashyUserId ||
        cashy.growlyUserId !== growlyUserId ||
        growly?.linkId !== request.renewLinkId ||
        growly.cashyUserId !== request.cashyUserId
      )
        throw new ConflictException(
          'La renovación requiere las mismas cuentas vinculadas. Iniciá sesión en la cuenta Growly original.',
        );
    } else if (cashy || growly)
      throw new ConflictException(
        'Una de estas cuentas ya tiene una conexión activa.',
      );
  }

  private equal(left: string, right: string): boolean {
    const a = Buffer.from(left),
      b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  async review(
    user: DecodedIdToken,
    token: string,
    code: string,
    verifier: string,
  ) {
    this.config.assertEnabled();
    const request = this.validRequest(
      (await this.requestRef(token).get()).data() as StoredRequest | undefined,
    );
    this.assertProof(request, user, code, verifier);
    return {
      cashyEmail: user.email ?? '',
      growlyEmail: request.growlyEmail,
      expiresAt: new Date(request.expiresAt).toISOString(),
    };
  }

  async cancel(
    user: DecodedIdToken,
    token: string,
    code: string,
    verifier: string,
  ) {
    this.config.assertEnabled();
    await this.firebase.firestore.runTransaction(async (tx) => {
      const ref = this.requestRef(token);
      const request = this.validRequest(
        (await tx.get(ref)).data() as StoredRequest | undefined,
      );
      this.assertProof(request, user, code, verifier);
      if (request.status === 'completed')
        throw new ConflictException('La conexión ya fue confirmada.');
      tx.update(ref, { status: 'cancelled' });
    });
    return { cancelled: true };
  }

  private assertProof(
    request: StoredRequest,
    user: DecodedIdToken,
    code: string,
    verifier: string,
  ): void {
    requireLinkToken(code);
    requireLinkToken(verifier);
    const proof = createHash('sha256').update(verifier).digest('base64url');
    if (
      request.cashyUserId !== user.uid ||
      !this.equal(request.challenge, proof) ||
      !request.authorizationCodeHash ||
      !this.equal(request.authorizationCodeHash, this.hash(code))
    ) {
      throw new UnauthorizedException(
        'La solicitud no corresponde a esta cuenta o a este navegador.',
      );
    }
    if (request.status !== 'approved' && request.status !== 'completed') {
      throw new ConflictException(
        'La solicitud no tiene consentimiento confirmado.',
      );
    }
    if (!request.growlyUserId || !request.growlyEmail)
      throw new BadRequestException('Solicitud incompleta.');
  }

  async revokeCashy(
    userId: string,
    linkId: string,
  ): Promise<RevocationReceipt> {
    return this.revoke('cashy', userId, linkId, 'cashy');
  }

  async revokeGrowly(
    userId: string,
    linkId: string,
  ): Promise<RevocationReceipt> {
    this.config.assertEnabled();
    return this.revoke('growly', userId, linkId, 'growly');
  }

  private async revoke(
    actor: 'cashy' | 'growly',
    userId: string,
    linkId: string,
    reason: 'cashy' | 'growly' | 'account-unavailable',
  ): Promise<RevocationReceipt> {
    return this.firebase.firestore.runTransaction(async (tx) => {
      const ref = this.linkRef(linkId);
      const link = (await tx.get(ref)).data() as StoredLink | undefined;
      if (!link) throw new NotFoundException('La conexión no existe.');
      if (
        (actor === 'cashy' ? link.cashyUserId : link.growlyUserId) !== userId
      ) {
        throw new ForbiddenException('La conexión no pertenece a esta cuenta.');
      }
      if (link.status === 'revoked') {
        if (!link.revokedAt)
          throw new ConflictException(
            'El historial de la conexión requiere revisión.',
          );
        return { linkId, status: 'revoked', revokedAt: link.revokedAt };
      }
      const [cashy, growly, cashyGeneration, growlyGeneration] =
        await Promise.all([
          tx.get(this.cashyRef(link.cashyUserId)),
          tx.get(this.growlyRef(link.growlyUserId)),
          tx.get(this.generationRef('cashy', link.cashyUserId)),
          tx.get(this.generationRef('growly', link.growlyUserId)),
        ]);
      const revokedAt = new Date().toISOString();
      tx.update(ref, { status: 'revoked', revokedAt, revokedBy: reason });
      if (cashy.data()?.id === linkId)
        tx.delete(this.cashyRef(link.cashyUserId));
      if (growly.data()?.linkId === linkId)
        tx.delete(this.growlyRef(link.growlyUserId));
      tx.set(this.generationRef('cashy', link.cashyUserId), {
        version:
          ((cashyGeneration.data() as { version: number } | undefined)
            ?.version ?? 0) + 1,
      });
      tx.set(this.generationRef('growly', link.growlyUserId), {
        version:
          ((growlyGeneration.data() as { version: number } | undefined)
            ?.version ?? 0) + 1,
      });
      return { linkId, status: 'revoked', revokedAt };
    });
  }

  async authorizeGrowly(
    userId: string,
    linkId: string,
    permission: IntegrationPermission,
  ): Promise<AccountLinkView> {
    this.config.assertEnabled();
    const link = (await this.linkRef(linkId).get()).data() as
      StoredLink | undefined;
    if (
      !link ||
      link.status !== 'active' ||
      link.growlyUserId !== userId ||
      !link.permissions.includes(permission)
    ) {
      throw new ForbiddenException('La conexión no autoriza esta operación.');
    }
    const state = await this.refreshLink(link);
    if (state.status !== 'active' || state.link.id !== linkId) {
      throw new ForbiddenException('La conexión fue revocada.');
    }
    if (!state.detailsFresh)
      throw new ServiceUnavailableException(
        'No se pudo verificar el acceso de las cuentas vinculadas.',
      );
    if (!state.accessAvailable)
      throw new ForbiddenException('El acceso compartido está suspendido.');
    const latest = (await this.linkRef(linkId).get()).data() as
      StoredLink | undefined;
    if (!latest || latest.status !== 'active')
      throw new ForbiddenException('La conexión fue revocada.');
    return state.link;
  }

  async authorizedGrowlyUserId(
    userId: string,
    linkId: string,
    permission: IntegrationPermission,
  ): Promise<string> {
    const record = (await this.linkRef(linkId).get()).data() as
      StoredLink | undefined;
    if (!record || record.cashyUserId !== userId)
      throw new ForbiddenException('La conexión no pertenece a esta cuenta.');
    await this.authorizeGrowly(record.growlyUserId, linkId, permission);
    return record.growlyUserId;
  }

  async authorizedCashyUserId(
    userId: string,
    linkId: string,
    permission: IntegrationPermission,
  ): Promise<string> {
    await this.authorizeGrowly(userId, linkId, permission);
    const link = (await this.linkRef(linkId).get()).data() as
      StoredLink | undefined;
    if (
      !link ||
      link.status !== 'active' ||
      link.growlyUserId !== userId ||
      !link.permissions.includes(permission) ||
      !(await this.validateGrowlyLink(userId, linkId)).authorized
    )
      throw new ForbiddenException('La conexión no autoriza esta operación.');
    return link.cashyUserId;
  }

  async validateGrowlyLink(
    userId: string,
    linkId: string,
  ): Promise<{ authorized: boolean }> {
    this.config.assertEnabled();
    const link = (await this.linkRef(linkId).get()).data() as
      StoredLink | undefined;
    if (!link || link.status !== 'active' || link.growlyUserId !== userId)
      return { authorized: false };
    const [cashy, growly] = await Promise.all([
      this.cashyRef(link.cashyUserId).get(),
      this.growlyRef(userId).get(),
    ]);
    return {
      authorized:
        cashy.data()?.id === linkId && growly.data()?.linkId === linkId,
    };
  }

  private async refreshLink(link: StoredLink): Promise<AccountLinkState> {
    if (link.status !== 'active') return this.notLinked();
    let cashyEmail = link.cashyEmail;
    let accessAvailable = false;
    try {
      const user = await this.firebase.getUser(link.cashyUserId);
      if (user.disabled || !user.email) {
        await this.revoke(
          'cashy',
          link.cashyUserId,
          link.id,
          'account-unavailable',
        );
        return this.notLinked();
      }
      cashyEmail = user.email;
      accessAvailable = user.emailVerified;
    } catch (error: unknown) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'auth/user-not-found'
      ) {
        await this.revoke(
          'cashy',
          link.cashyUserId,
          link.id,
          'account-unavailable',
        );
        return this.notLinked();
      }
      throw new ServiceUnavailableException(
        'No se pudo verificar la cuenta Cashy.',
      );
    }
    let growlyEmail = link.growlyEmail;
    let detailsFresh = false;
    if (this.config.enabled) {
      try {
        const identity = await this.growlyIdentity(link);
        if (!identity.available) {
          await this.revoke(
            'cashy',
            link.cashyUserId,
            link.id,
            'account-unavailable',
          );
          return this.notLinked();
        }
        growlyEmail = identity.email;
        accessAvailable = accessAvailable && identity.accessAllowed;
        detailsFresh = true;
      } catch (error) {
        if (!(error instanceof ServiceUnavailableException)) throw error;
        accessAvailable = false;
      }
    }
    const updated = await this.firebase.firestore.runTransaction(async (tx) => {
      const [pointer, history] = await Promise.all([
        tx.get(this.cashyRef(link.cashyUserId)),
        tx.get(this.linkRef(link.id)),
      ]);
      const current = pointer.data() as StoredLink | undefined;
      const audit = history.data() as StoredLink | undefined;
      if (
        !current ||
        current.id !== link.id ||
        current.status !== 'active' ||
        audit?.status !== 'active'
      )
        return undefined;
      const changes = { cashyEmail, growlyEmail };
      if (
        current.cashyEmail !== cashyEmail ||
        current.growlyEmail !== growlyEmail
      ) {
        tx.update(this.cashyRef(link.cashyUserId), changes);
        tx.update(this.linkRef(link.id), changes);
      }
      return { ...current, ...changes };
    });
    return updated
      ? {
          status: 'active',
          enabled: this.config.enabled,
          peerFrontendUrl: this.config.peerFrontendUrl,
          link: this.view(updated),
          detailsFresh,
          accessAvailable: accessAvailable && this.config.enabled,
        }
      : this.notLinked();
  }

  private async growlyIdentity(
    link: StoredLink,
  ): Promise<LinkedAccountIdentity> {
    try {
      const response = await fetch(
        this.config.peerApiUrl + '/integration/peer/link/account',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + this.config.outboundSecret,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            growlyUserId: link.growlyUserId,
            linkId: link.id,
          }),
          signal: AbortSignal.timeout(this.config.requestTimeoutMs),
          redirect: 'error',
        },
      );
      const body: unknown = await response.json();
      if (
        !response.ok ||
        !body ||
        typeof body !== 'object' ||
        !('ok' in body) ||
        body.ok !== true ||
        !('result' in body) ||
        !body.result ||
        typeof body.result !== 'object' ||
        !('available' in body.result)
      ) {
        throw new Error('Invalid identity response');
      }
      if (body.result.available === false) return { available: false };
      if (
        body.result.available === true &&
        'email' in body.result &&
        typeof body.result.email === 'string' &&
        'accessAllowed' in body.result &&
        typeof body.result.accessAllowed === 'boolean'
      ) {
        return {
          available: true,
          email: body.result.email,
          accessAllowed: body.result.accessAllowed,
        };
      }
      throw new Error('Invalid identity response');
    } catch {
      throw new ServiceUnavailableException(
        'No se pudo actualizar el correo de Growly.',
      );
    }
  }

  private redirect(params: Record<string, string>): LinkRedirect {
    const url = new URL(this.config.callbackUrl);
    url.hash = new URLSearchParams(params).toString();
    return { redirectUrl: url.toString() };
  }
}
