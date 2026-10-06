// Вкладка «Карточки» на настоящей базе: тысячи ссылок — страницами; «ждут», «ошибка» и «прочитаны»
// не пересекаются; причина ошибки группируется без адресов и номеров объектов, но код ответа различает;
// поиск — по номеру ДОМ.РФ и названию объекта портала. Данные синтетические, сети нет.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDb, getPool } from '../../db/pool.js';
import { resetAndMigrate } from '../../__tests__/integration/db.js';
import { domRfObjectUrl } from './domrfCards.js';
import { pageDomRfTargets, registerDomRfTarget } from './domrfTargets.js';

const set = (ref: string, sql: string, params: unknown[] = []): Promise<unknown> =>
  getPool().query(`UPDATE domrf_targets SET ${sql} WHERE external_ref = $1`, [ref, ...params]);

beforeAll(async () => {
  await resetAndMigrate();
  const project = (
    await getPool().query<{ id: number }>(`INSERT INTO projects (name, name_norm, name_latin) VALUES ('ЖК Адмирал', 'адмирал', 'admiral') RETURNING id`)
  ).rows[0]!.id;
  for (const ref of ['50001', '50002', '50003', '50004', '50005', '50006']) await registerDomRfTarget({ url: domRfObjectUrl(ref) });
  await registerDomRfTarget({ url: domRfObjectUrl('50007'), projectId: project });
  // 50001–50002 ждут; 50003–50005 — ошибки (две — один таймаут на разных адресах); 50006–50007 прочитаны.
  await set('50003', `last_error = $2, last_attempt_at = now() - interval '2 days'`, [
    'page.goto: Timeout 45000ms exceeded.\nCall log:\n  - navigating to "https://наш.дом.рф/объект/50003"',
  ]);
  await set('50004', `last_error = $2, last_attempt_at = now()`, [
    'page.goto: Timeout 45000ms exceeded.\nCall log:\n  - navigating to "https://наш.дом.рф/объект/50004"',
  ]);
  await set('50005', `last_error = $2, last_attempt_at = now()`, ['страница ДОМ.РФ ответила HTTP 404']);
  await set('50006', `captured_at = now() + interval '1 second'`);
  await set('50007', `captured_at = now() - interval '3 days', requested_at = now() - interval '4 days'`);
});

afterAll(async () => {
  await closeDb();
});

describe('страница карточек ДОМ.РФ', () => {
  it('числа состояний не пересекаются; за сутки — только свежие', async () => {
    const page = await pageDomRfTargets({ filter: 'all', page: 1, limit: 50 });
    expect(page.counts).toEqual({ all: 7, waiting: 2, error: 3, captured: 2 });
    expect(page.total).toBe(7);
    expect(page.day).toEqual({ captured: 1, failed: 2 });
  });

  it('причина — без адреса и номера: два таймаута — одна строка, HTTP 404 — своя', async () => {
    const { reasons } = await pageDomRfTargets({ filter: 'error', page: 1, limit: 50 });
    expect(reasons).toEqual([
      { reason: 'page.goto: Timeout 45000ms exceeded.', count: 2 },
      { reason: 'страница ДОМ.РФ ответила HTTP 404', count: 1 },
    ]);
    const timeouts = await pageDomRfTargets({ filter: 'error', reason: 'page.goto: Timeout 45000ms exceeded.', page: 1, limit: 50 });
    expect(timeouts.items.map(t => t.externalRef)).toEqual(['50004', '50003']);
    expect(timeouts.total).toBe(2);
  });

  it('«ждут» — в порядке очереди; поиск по номеру и по объекту портала', async () => {
    expect((await pageDomRfTargets({ filter: 'waiting', page: 1, limit: 50 })).items.map(t => t.externalRef)).toEqual(['50001', '50002']);
    expect((await pageDomRfTargets({ filter: 'all', q: '50005', page: 1, limit: 50 })).items.map(t => t.externalRef)).toEqual(['50005']);
    const byName = await pageDomRfTargets({ filter: 'captured', q: 'адмирал', page: 1, limit: 50 });
    expect(byName.items.map(t => [t.externalRef, t.projectName])).toEqual([['50007', 'ЖК Адмирал']]);
  });

  it('страницы: total — по фильтру, последняя страница — остаток', async () => {
    const first = await pageDomRfTargets({ filter: 'all', page: 1, limit: 3 });
    const last = await pageDomRfTargets({ filter: 'all', page: 3, limit: 3 });
    expect(first.items).toHaveLength(3);
    expect(last.items).toHaveLength(1);
    expect(new Set([...first.items, ...last.items].map(t => t.id)).size).toBe(4);
    expect(last.total).toBe(7);
  });
});
