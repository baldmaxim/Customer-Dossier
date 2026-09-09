// Раннер миграций: применяет docs/migrations/NNN_*.sql по алфавиту,
// каждый файл — в собственной транзакции, факт применения пишет в schema_migrations.
//
// Запуск: npm run migrate  (из backend/)
//         npm run migrate -- --dry   — показать, что будет применено, и выйти.
//
// Повторный запуск ничего не делает: уже применённые файлы пропускаются.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getPool, closeDb } from './pool.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// backend/src/db -> backend/src -> backend -> TG_Info
const MIGRATIONS_DIR = path.resolve(HERE, '..', '..', '..', 'docs', 'migrations');

const ENSURE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;

const listMigrationFiles = (): string[] => {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    throw new Error(`Каталог миграций не найден: ${MIGRATIONS_DIR}`);
  }
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en'));
};

export const runMigrations = async (dryRun = false): Promise<void> => {
  const pool = getPool();
  await pool.query(ENSURE_TABLE_SQL);

  const applied = new Set(
    (await pool.query<{ filename: string }>('SELECT filename FROM schema_migrations')).rows.map(
      r => r.filename,
    ),
  );

  const pending = listMigrationFiles().filter(f => !applied.has(f));

  if (pending.length === 0) {
    console.log(`[migrate] нечего применять, все ${applied.size} миграций уже накачены`);
    return;
  }

  if (dryRun) {
    console.log(`[migrate] будет применено ${pending.length}:`);
    for (const f of pending) console.log(`  - ${f}`);
    return;
  }

  for (const filename of pending) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');
    const client = await pool.connect();
    const startedAt = Date.now();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
      await client.query('COMMIT');
      console.log(`[migrate] ok   ${filename} (${Date.now() - startedAt} мс)`);
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // коннект уже мог сломаться — не мешаем оригинальной ошибке
      }
      const code = (err as { code?: string }).code ?? 'UNKNOWN';
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[migrate] FAIL ${filename}: ${code} ${message}`);
      // Останавливаемся на первой ошибке: следующие миграции почти наверняка
      // зависят от этой, и их падение только зашумит вывод.
      throw err;
    } finally {
      client.release();
    }
  }

  console.log(`[migrate] применено ${pending.length} миграций`);
};

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectRun) {
  const dryRun = process.argv.includes('--dry');
  runMigrations(dryRun)
    .then(() => closeDb())
    .then(() => process.exit(0))
    .catch(async err => {
      console.error('[migrate] прервано:', err instanceof Error ? err.message : String(err));
      await closeDb().catch(() => undefined);
      process.exit(1);
    });
}
