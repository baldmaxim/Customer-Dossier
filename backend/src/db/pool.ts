// PostgreSQL runtime: пул соединений + тонкие хелперы поверх node-postgres.
//
// Безопасность логирования: DATABASE_URL не логируется никогда. Из ошибок pg
// берём только message и code — connectionString может оказаться внутри объекта
// ошибки целиком. Параметры запроса не логируются.

import fs from 'node:fs';
import { Pool, types, type PoolClient, type PoolConfig, type QueryResultRow } from 'pg';

import { env } from '../config/env.js';

// DATE (OID 1082) отдаём строкой 'YYYY-MM-DD'. Иначе pg парсит в JS Date и
// planned_completion/occurred_on приезжают со сдвигом часового пояса.
types.setTypeParser(1082, (val: string) => val);

// pg-types' parseDateArray игнорирует override выше, поэтому date[] (1182)
// перевешиваем на парсер text[] (1009).
const TEXT_ARRAY_OID = 1009 as Parameters<typeof types.getTypeParser>[0];
const DATE_ARRAY_OID = 1182 as Parameters<typeof types.setTypeParser>[0];
types.setTypeParser(DATE_ARRAY_OID, types.getTypeParser(TEXT_ARRAY_OID));

// INT8 (OID 20) по умолчанию приходит строкой из-за риска переполнения Number.
// Все bigint-колонки здесь — последовательности, реальные значения < 2^53.
// Без этого ломаются сравнения id и Map<number, ...>.
types.setTypeParser(20, (val: string) => Number.parseInt(val, 10));

// NUMERIC (OID 1700) тоже приходит строкой. У нас это confidence/score/доли —
// заведомо в пределах double. Метрики иначе пришлось бы парсить в каждом месте.
types.setTypeParser(1700, (val: string) => Number.parseFloat(val));

const buildSsl = (): PoolConfig['ssl'] => {
  if (!env.DATABASE_SSL) return false;
  const rejectUnauthorized = env.DATABASE_SSL_REJECT_UNAUTHORIZED;
  if (env.DATABASE_SSL_CA_PATH) {
    return { rejectUnauthorized, ca: fs.readFileSync(env.DATABASE_SSL_CA_PATH, 'utf8') };
  }
  return { rejectUnauthorized };
};

export const createPgPoolConfig = (overrides: Partial<PoolConfig> = {}): PoolConfig => ({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
  statement_timeout: env.DATABASE_STATEMENT_TIMEOUT_MS,
  // Ждать свободный коннект не вечно: быстрый отказ вместо зависшего хендлера.
  connectionTimeoutMillis: 5000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
  ssl: buildSsl(),
  ...overrides,
});

let _pool: Pool | null = null;

/** Lazy-init singleton. Конструктор Pool соединений ещё не открывает. */
export const getPool = (): Pool => {
  if (_pool) return _pool;
  _pool = new Pool(createPgPoolConfig());
  // Без обработчика 'error' на idle-клиентах Node падает с uncaught exception.
  _pool.on('error', err => {
    const code = (err as { code?: string }).code ?? 'UNKNOWN';
    console.error(`[pg] idle client error: ${code} ${err.message}`);
  });
  return _pool;
};

/** SELECT, массив строк. */
export const query = async <T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params?: readonly unknown[],
): Promise<T[]> => {
  const result = await getPool().query<T>(sql, params as unknown[] | undefined);
  return result.rows;
};

/** SELECT, первая строка или null. */
export const queryOne = async <T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params?: readonly unknown[],
): Promise<T | null> => {
  const result = await getPool().query<T>(sql, params as unknown[] | undefined);
  return result.rows[0] ?? null;
};

/** INSERT/UPDATE/DELETE, возвращает rowCount. */
export const execute = async (sql: string, params?: readonly unknown[]): Promise<number> => {
  const result = await getPool().query(sql, params as unknown[] | undefined);
  return result.rowCount ?? 0;
};

/**
 * Исполнитель SQL: клиент транзакции либо пул. Позволяет писать функции,
 * которые вызываются и сами по себе, и внутри чужой транзакции — критично для
 * резолвинга сущностей, где чтение кандидатов и запись обязаны идти по одному
 * соединению, иначе транзакция не видит собственную незакоммиченную вставку.
 */
export type DbExecutor = Pool | PoolClient;

/** Транзакция. BEGIN/COMMIT/ROLLBACK автоматические, клиент всегда возвращается в пул. */
export const withTransaction = async <T>(fn: (client: PoolClient) => Promise<T>): Promise<T> => {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ROLLBACK на уже сломанном коннекте — игнорируем
    }
    throw err;
  } finally {
    client.release();
  }
};

/** Проверка живости коннекта. Не бросает. */
export const checkDbConnection = async (): Promise<boolean> => {
  try {
    await getPool().query('SELECT 1');
    return true;
  } catch (err) {
    const code = (err as { code?: string }).code ?? 'UNKNOWN';
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[pg] checkDbConnection failed: ${code} ${message}`);
    return false;
  }
};

/** Закрывает пул. Идемпотентно. Вызывать на graceful shutdown. */
export const closeDb = async (): Promise<void> => {
  if (!_pool) return;
  const p = _pool;
  _pool = null;
  await p.end();
};
