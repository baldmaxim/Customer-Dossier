// Общие операции интеграционных тестов над тестовой базой.

import { getPool } from '../../db/pool.js';
import { runMigrations } from '../../db/migrate.js';
import { verifyConnectedTestDatabase } from '../../db/testTarget.js';
import { assertPreparedTestTarget } from '../../db/testTargetBootstrap.js';

/** Повторная проверка цели перед каждым разрушительным действием: адрес, база, роль, маркер. */
export const assertIsolatedTarget = async (): Promise<void> => {
  const target = assertPreparedTestTarget();
  await verifyConnectedTestDatabase(getPool(), target);
};

/** Пустая схема public — только в проверенной тестовой базе. */
export const resetSchema = async (): Promise<void> => {
  await assertIsolatedTarget();
  await getPool().query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
};

/** Пустая схема + все миграции, включая destructive (данных в тестовой базе нет). */
export const resetAndMigrate = async (): Promise<void> => {
  await resetSchema();
  await runMigrations({ allowDestructive: true, log: () => undefined });
};

/** Синтетический источник с заданным допуском. Реальных ключей и адресов не содержит. */
export const insertSyntheticSource = async (options: {
  kind: 'telegram' | 'website' | 'manual';
  key: string;
  status?: 'active' | 'paused' | 'broken';
  access?: 'unknown' | 'approved' | 'blocked' | 'revoked' | 'expired';
  ai?: 'unknown' | 'approved' | 'blocked' | 'revoked' | 'expired';
  expiresAt?: Date | null;
  baseUrl?: string | null;
}): Promise<number> => {
  const approving = options.access === 'approved' || options.ai === 'approved';
  const res = await getPool().query<{ id: number }>(
    `INSERT INTO sources (kind, key, title, base_url, status, access_status, ai_processing_status,
                          policy_basis, policy_owner, policy_decided_at, policy_expires_at, is_synthetic,
                          next_run_at)
     VALUES ($1, $2, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, now() - interval '1 minute')
     ON CONFLICT (kind, key) DO UPDATE SET
       status = EXCLUDED.status, access_status = EXCLUDED.access_status,
       ai_processing_status = EXCLUDED.ai_processing_status, policy_basis = EXCLUDED.policy_basis,
       policy_owner = EXCLUDED.policy_owner, policy_decided_at = EXCLUDED.policy_decided_at,
       policy_expires_at = EXCLUDED.policy_expires_at, is_synthetic = true, base_url = EXCLUDED.base_url
     RETURNING id`,
    [
      options.kind,
      options.key,
      options.baseUrl ?? null,
      options.status ?? 'active',
      options.access ?? 'unknown',
      options.ai ?? 'unknown',
      approving ? 'синтетический тест' : null,
      approving ? 'test-suite' : null,
      approving ? new Date() : null,
      options.expiresAt ?? null,
    ],
  );
  const id = res.rows[0]?.id;
  if (id === undefined) throw new Error('не удалось создать синтетический источник');
  return id;
};
