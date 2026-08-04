import { Logger } from '@nestjs/common';
import type { DocumentData } from 'firebase-admin/firestore';

import { loadDotEnv } from '../common/env';
import { FirebaseAdminService } from '../common/services/firebase.service';

interface RetentionCollectionConfig {
  collectionName: string;
  sourceField: string;
  retentionMs: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const APPLY_CHANGES = process.argv.includes('--apply');
const BATCH_SIZE = 400;
const logger = new Logger('RetentionBackfill');

const retentionCollections: RetentionCollectionConfig[] = [
  {
    collectionName: 'user_block_codes',
    sourceField: 'expiresAt',
    retentionMs: DAY_MS,
  },
  {
    collectionName: 'user_password_recovery_sessions',
    sourceField: 'expiresAt',
    retentionMs: DAY_MS,
  },
  {
    collectionName: 'user_login_attempts',
    sourceField: 'updatedAt',
    retentionMs: 90 * DAY_MS,
  },
  {
    collectionName: 'due_reminder_notification_log',
    sourceField: 'sentAt',
    retentionMs: 30 * DAY_MS,
  },
];

function parseDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function resolveDeleteAt(
  data: DocumentData,
  config: RetentionCollectionConfig,
): Date | null {
  if (data['deleteAt'] !== undefined && data['deleteAt'] !== null) {
    return null;
  }

  const sourceDate = parseDate(data[config.sourceField]);
  return sourceDate
    ? new Date(sourceDate.getTime() + config.retentionMs)
    : null;
}

async function backfillRetention(): Promise<void> {
  loadDotEnv();
  const firebase = new FirebaseAdminService();

  try {
    for (const config of retentionCollections) {
      const snapshot = await firebase.firestore
        .collection(config.collectionName)
        .get();
      const updates = snapshot.docs.flatMap((document) => {
        const deleteAt = resolveDeleteAt(document.data(), config);
        return deleteAt ? [{ reference: document.ref, deleteAt }] : [];
      });

      logger.log(
        `${config.collectionName}: ${updates.length} documentos para actualizar de ${snapshot.size}.`,
      );

      if (!APPLY_CHANGES) {
        continue;
      }

      for (let index = 0; index < updates.length; index += BATCH_SIZE) {
        const batch = firebase.firestore.batch();

        for (const update of updates.slice(index, index + BATCH_SIZE)) {
          batch.update(update.reference, { deleteAt: update.deleteAt });
        }

        await batch.commit();
      }
    }

    logger.log(
      APPLY_CHANGES
        ? 'Backfill de retención aplicado correctamente.'
        : 'Simulación finalizada. Ejecutá con --apply para guardar los cambios.',
    );
  } finally {
    await firebase.firestore.terminate();
  }
}

void backfillRetention().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(`No se pudo completar el backfill: ${message}`);
  process.exitCode = 1;
});
