// Проверка перед стартом пилота (этап 19). Только чтение целевой базы (DATABASE_URL): имя базы, допуск названных источников,
// неприменённые миграции. Ничего не включает, не пишет и не обращается к сети источников или модели.
//
//   npm run pilot:check -- --manifest <pilot-manifest.json>
//
// Exit 0 — READY_TO_START (решение о старте всё равно за владельцем); exit 1 — BLOCKED или ошибка.

import fs from 'node:fs';

import { env } from '../config/env.js';
import { closeDb, getPool } from '../db/pool.js';
import { planMigrations } from '../db/migrate.js';
import type { PermissionStatus } from '../ingest/policy.js';
import { pilotGate } from './pilotManifest.js';

const argv = process.argv.slice(2);
const file = argv[argv.indexOf('--manifest') + 1];

const main = async (): Promise<void> => {
  if (!argv.includes('--manifest') || !file) {
    console.error('[pilot] укажите --manifest <файл>');
    process.exitCode = 1;
    return;
  }
  const manifest: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  const pool = getPool();
  const database = (await pool.query<{ db: string }>('SELECT current_database() AS db')).rows[0]!.db;
  const sources = (
    await pool.query<{ key: string; kind: string; accessStatus: PermissionStatus; aiProcessingStatus: PermissionStatus; policyExpiresAt: Date | null }>(
      `SELECT key, kind::text AS kind, access_status AS "accessStatus", ai_processing_status AS "aiProcessingStatus", policy_expires_at AS "policyExpiresAt" FROM sources`,
    )
  ).rows;
  const plan = await planMigrations(pool);
  const result = pilotGate({ manifest, env, connectedDatabase: database, sources, pendingMigrations: plan.pending });

  console.log(`[pilot] ${result.version}: ${result.verdict} (база «${database}»)`);
  for (const b of result.blockers) console.log(`[pilot] БЛОК: ${b}`);
  for (const w of result.warnings) console.log(`[pilot] внимание: ${w}`);
  console.log(`[pilot] сбор разрешён: ${result.allowedSteps.collect.join(', ') || 'нет'}; ИИ-обработка: ${result.allowedSteps.ai.join(', ') || 'нет'}`);
  if (result.verdict !== 'READY_TO_START') process.exitCode = 1;
  else console.log('[pilot] проверка пройдена; старт и каждый шаг — решение и действие владельца');
};

main()
  .catch(err => {
    console.error('[pilot] прервано:', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(() => closeDb().catch(() => undefined));
