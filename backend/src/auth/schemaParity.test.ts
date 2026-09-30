// Списки в коде и CHECK в базе (миграции 031, 033) обязаны совпадать: вид события, которого нет
// в CHECK, уронил бы запись журнала посреди входа или заявки, а роль или состояние заявки из базы,
// неизвестные коду, — чтение пользователя (pgStore.toUser). Без базы: читаются сами миграции.

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { listMigrationFiles, MIGRATIONS_DIR } from '../db/migrate.js';
import { ROLES } from './permissions.js';
import { AUTH_EVENTS, REGISTRATION_STATES } from './store.js';

/** Значения из последнего по номеру миграции `<имя> CHECK (<колонка> IN (...))`. */
const lastCheckValues = (constraint: string): string[] => {
  const re = new RegExp(String.raw`${constraint}\s+CHECK\s*\(\s*\w+\s+IN\s*\(([^)]*)\)`, 'g');
  let last: string | null = null;
  for (const file of listMigrationFiles()) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    for (const m of sql.matchAll(re)) last = m[1] ?? null;
  }
  if (last === null) throw new Error(`ограничение ${constraint} не найдено в миграциях`);
  return [...last.matchAll(/'([^']+)'/g)].map(m => m[1] ?? '');
};

describe('списки auth в коде совпадают с CHECK в базе', () => {
  it('виды событий журнала входа', () => {
    expect([...lastCheckValues('auth_events_event_known')].sort()).toEqual([...AUTH_EVENTS].sort());
  });

  it('роли и состояния заявки', () => {
    expect([...lastCheckValues('users_role_known')].sort()).toEqual([...ROLES].sort());
    expect([...lastCheckValues('users_registration_known')].sort()).toEqual([...REGISTRATION_STATES].sort());
  });
});
