// Один раз на запуск интеграционного профиля: цель проверяется до всего
// остального. Без выделенной и размеченной тестовой базы профиль падает, а не
// «пропускает» тесты: тихий пропуск легко принять за PASS.

import pg from 'pg';

import { assertTestDatabaseUrl, verifyConnectedTestDatabase } from '../../db/testTarget.js';
import { readDotenvDatabaseUrl } from '../../db/testTargetBootstrap.js';

export default async (): Promise<void> => {
  const target = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL, [process.env.DATABASE_URL, readDotenvDatabaseUrl()]);
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1, ssl: false });
  try {
    await verifyConnectedTestDatabase(pool, target);
  } finally {
    await pool.end();
  }
  // Цель печатается обезличенно: без логина и пароля.
  console.log(`[integration] тестовая цель: ${target.host}:${target.port}/${target.database}`);
};
