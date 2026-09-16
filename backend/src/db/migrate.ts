// Раннер миграций: применяет docs/migrations/NNN_*.sql по алфавиту,
// каждый файл — в собственной транзакции, факт применения пишет в schema_migrations.
//
// Запуск: npm run migrate -- --dry                 — план без единой записи в БД
//         npm run migrate                          — применить (кроме destructive)
//         npm run migrate -- --allow-destructive   — применить, включая destructive
//         npm run migrate -- --upto 9              — только до указанного номера (синтетическая legacy-база, этап 09);
//                                                    только в тестовую цель TEST_DATABASE_URL через общий preflight
//
// Повторный запуск ничего не делает: уже применённые файлы пропускаются.
// Применённые файлы не переписываются: история схемы неизменна.
//
// Пул импортируется лениво: для --upto окружение сначала переключается на проверенную тестовую цель.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Pool } from 'pg';

import { prepareTestTargetProcess } from './testTargetBootstrap.js';
import { verifyConnectedTestDatabase } from './testTarget.js';

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
  /**
   * Применить только миграции с номером не выше указанного (например 9 — состояние до этапа 01).
   * Нужно, чтобы собрать синтетическую legacy-базу и проверить на ней апгрейд (этап 09).
   * На рабочей базе смысла не имеет: частично накаченная схема — не поддерживаемое состояние.
   */
  upto?: number;
  pool?: Pool;
  dir?: string;
  log?: (line: string) => void;
}

export const runMigrations = async (options: IRunMigrationsOptions = {}): Promise<IMigrationPlan> => {
  const pool = options.pool ?? (await import('./pool.js')).getPool();
  const dir = options.dir ?? MIGRATIONS_DIR;
  const log = options.log ?? ((line: string) => console.log(line));

  const full = await planMigrations(pool, dir);
  const plan: IMigrationPlan =
    options.upto === undefined
      ? full
      : {
          ...full,
          pending: full.pending.filter(f => Number.parseInt(f.slice(0, 3), 10) <= options.upto!),
          destructivePending: full.destructivePending.filter(d => Number.parseInt(d.filename.slice(0, 3), 10) <= options.upto!),
        };

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

export interface IMigrateArgs {
  dryRun: boolean;
  allowDestructive: boolean;
  upto?: number;
}

const KNOWN_FLAGS = new Set(['--dry', '--allow-destructive', '--upto']);

/** Разбор аргументов CLI. Неизвестный флаг или некорректный --upto — ошибка, а не «нечего применять». */
export const parseMigrateArgs = (argv: readonly string[]): IMigrateArgs => {
  const args: IMigrateArgs = { dryRun: false, allowDestructive: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (!KNOWN_FLAGS.has(arg)) throw new Error(`неизвестный аргумент: ${arg}`);
    if (arg === '--dry') args.dryRun = true;
    if (arg === '--allow-destructive') args.allowDestructive = true;
    if (arg === '--upto') {
      if (args.upto !== undefined) throw new Error('--upto указан дважды');
      const raw = argv[i + 1] ?? '';
      if (!/^\d{1,3}$/.test(raw) || Number(raw) < 1) throw new Error('--upto ожидает номер миграции от 1 до 999');
      args.upto = Number(raw);
      i += 1;
    }
  }
  return args;
};

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectRun) {
  const main = async (): Promise<void> => {
    const args = parseMigrateArgs(process.argv.slice(2));
    // Частично накаченная схема — не поддерживаемое состояние рабочей базы: --upto только в тестовую цель.
    const target = args.upto !== undefined ? prepareTestTargetProcess() : null;
    const { getPool } = await import('./pool.js');
    if (target) await verifyConnectedTestDatabase(getPool(), target);
    await runMigrations(args);
  };
  const close = async (): Promise<void> => (await import('./pool.js')).closeDb();
  main()
    .then(() => close())
    .then(() => process.exit(0))
    .catch(async err => {
      console.error('[migrate] прервано:', err instanceof Error ? err.message : String(err));
      await close().catch(() => undefined);
      process.exit(1);
    });
}
