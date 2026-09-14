// Раннер миграций: применяет docs/migrations/NNN_*.sql по алфавиту,
// каждый файл — в собственной транзакции, факт применения пишет в schema_migrations.
//
// Запуск: npm run migrate -- --dry                 — план без единой записи в БД
//         npm run migrate                          — применить (кроме destructive)
//         npm run migrate -- --allow-destructive   — применить, включая destructive
//
// Повторный запуск ничего не делает: уже применённые файлы пропускаются.
// Применённые файлы не переписываются: история схемы неизменна.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Pool } from 'pg';

import { getPool, closeDb } from './pool.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// backend/src/db (или backend/dist/db) -> backend/src -> backend -> TG_Info
export const MIGRATIONS_DIR = path.resolve(HERE, '..', '..', '..', 'docs', 'migrations');

const ENSURE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;

/**
 * Миграции, меняющие или удаляющие существующие данные. Применяются только
 * с явным флагом: на рабочей базе это отдельное согласование и backup.
 */
export const DESTRUCTIVE_MIGRATIONS: Readonly<Record<string, string>> = {
  '009_switch_to_russia.sql':
    'обнуляет все events.amount_rub, переименовывает companies.bin и ставит сайты РК на паузу',
};

export const listMigrationFiles = (dir: string = MIGRATIONS_DIR): string[] => {
  if (!fs.existsSync(dir)) {
    throw new Error(`Каталог миграций не найден: ${dir}`);
  }
  return fs
    .readdirSync(dir)
    .filter(f => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en'));
};

export interface IMigrationPlan {
  /** Есть ли таблица schema_migrations (узнаём чтением каталога, без DDL). */
  registryExists: boolean;
  applied: string[];
  pending: string[];
  destructivePending: Array<{ filename: string; effect: string }>;
}

export const planMigrations = async (pool: Pool, dir: string = MIGRATIONS_DIR): Promise<IMigrationPlan> => {
  const registry = await pool.query<{ exists: boolean }>(
    `SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists`,
  );
  const registryExists = registry.rows[0]?.exists ?? false;

  const applied = registryExists
    ? (await pool.query<{ filename: string }>('SELECT filename FROM schema_migrations ORDER BY filename')).rows.map(
        r => r.filename,
      )
    : [];

  const appliedSet = new Set(applied);
  const pending = listMigrationFiles(dir).filter(f => !appliedSet.has(f));
  const destructivePending = pending
    .filter(f => DESTRUCTIVE_MIGRATIONS[f] !== undefined)
    .map(f => ({ filename: f, effect: DESTRUCTIVE_MIGRATIONS[f] ?? '' }));

  return { registryExists, applied, pending, destructivePending };
};

export class DestructiveMigrationError extends Error {
  constructor(readonly files: string[]) {
    super(
      `в плане есть миграции, меняющие существующие данные: ${files.join(', ')}. ` +
        'Сначала backup и отдельное согласование; применить: --allow-destructive',
    );
    this.name = 'DestructiveMigrationError';
  }
}

export interface IRunMigrationsOptions {
  dryRun?: boolean;
  allowDestructive?: boolean;
  pool?: Pool;
  dir?: string;
  log?: (line: string) => void;
}

export const runMigrations = async (options: IRunMigrationsOptions = {}): Promise<IMigrationPlan> => {
  const pool = options.pool ?? getPool();
  const dir = options.dir ?? MIGRATIONS_DIR;
  const log = options.log ?? ((line: string) => console.log(line));

  const plan = await planMigrations(pool, dir);

  if (plan.pending.length === 0) {
    log(`[migrate] нечего применять, все ${plan.applied.length} миграций уже накачены`);
    return plan;
  }

  log(`[migrate] ${options.dryRun ? 'будет применено' : 'к применению'} ${plan.pending.length}:`);
  for (const f of plan.pending) {
    const effect = DESTRUCTIVE_MIGRATIONS[f];
    log(`  - ${f}${effect ? `   ВНИМАНИЕ: ${effect}` : ''}`);
  }
  if (!plan.registryExists) log('[migrate] таблицы schema_migrations нет — база не размечена');

  // Dry-run заканчивается здесь: ни CREATE TABLE, ни INSERT не выполнялись.
  if (options.dryRun) return plan;

  if (plan.destructivePending.length > 0 && !options.allowDestructive) {
    throw new DestructiveMigrationError(plan.destructivePending.map(d => d.filename));
  }

  await pool.query(ENSURE_TABLE_SQL);

  for (const filename of plan.pending) {
    const sql = fs.readFileSync(path.join(dir, filename), 'utf8');
    const client = await pool.connect();
    const startedAt = Date.now();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
      await client.query('COMMIT');
      log(`[migrate] ok   ${filename} (${Date.now() - startedAt} мс)`);
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // коннект уже мог сломаться — не мешаем оригинальной ошибке
      }
      const code = (err as { code?: string }).code ?? 'UNKNOWN';
      const message = err instanceof Error ? err.message : String(err);
      log(`[migrate] FAIL ${filename}: ${code} ${message}`);
      // Останавливаемся на первой ошибке: следующие миграции почти наверняка
      // зависят от этой, и их падение только зашумит вывод.
      throw err;
    } finally {
      client.release();
    }
  }

  log(`[migrate] применено ${plan.pending.length} миграций`);
  return plan;
};

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectRun) {
  runMigrations({
    dryRun: process.argv.includes('--dry'),
    allowDestructive: process.argv.includes('--allow-destructive'),
  })
    .then(() => closeDb())
    .then(() => process.exit(0))
    .catch(async err => {
      console.error('[migrate] прервано:', err instanceof Error ? err.message : String(err));
      await closeDb().catch(() => undefined);
      process.exit(1);
    });
}
