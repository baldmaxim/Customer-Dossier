// headline@1 на реальной базе: допуск, идемпотентность и выбор редакций.
// Модель подменена: любой её вызов здесь — факт, который тест проверяет явно.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDb, getPool } from '../db/pool.js';
import { insertSyntheticSource, resetAndMigrate } from '../__tests__/integration/db.js';
import { storeDocument } from '../ingest/store.js';
import type { ILlmResult } from '../llm/client.js';
import type { IHeadline } from '../llm/headline/schema.js';
import { ensureHeadline, revisionsWithoutHeadline, runHeadlinePass, type HeadlineCaller } from './service.js';

const calls: string[] = [];

/** Подменённая модель: возвращает тему и записывает, что её звали. */
const caller = (topic = 'Конкурс на корпус три жилого комплекса'): HeadlineCaller => async input => {
  calls.push(input.body.slice(0, 20));
  return {
    ok: true,
    data: { topic } satisfies IHeadline,
    usage: { tokensIn: 100, tokensOut: 10, latencyMs: 5 },
    rawResponse: JSON.stringify({ topic }),
  } satisfies ILlmResult<IHeadline>;
};

const store = async (sourceId: number, externalId: string, body: string): Promise<number> => {
  const result = await storeDocument({
    sourceId,
    sourceRunId: null,
    externalId,
    url: null,
    title: null,
    body,
    publishedAt: new Date('2026-09-20T09:00:00Z'),
    forwardFrom: null,
  });
  return result.revisionId!;
};

const TEXT = 'Заказчик объявил конкурс на строительство корпуса 3 жилого комплекса «Пример» в Москве.';

beforeAll(async () => {
  await resetAndMigrate();
});

afterAll(async () => {
  await closeDb();
});

describe('тема публикации (headline@1)', () => {
  it('без ИИ-допуска модель не вызывается и темы нет', async () => {
    const sourceId = await insertSyntheticSource({ kind: 'telegram', key: 'headline_no_ai', access: 'approved', ai: 'unknown' });
    const revisionId = await store(sourceId, 'h1', TEXT);
    calls.length = 0;

    const result = await ensureHeadline(revisionId, caller());

    expect(result.outcome).toBe('refused_policy');
    expect(calls).toEqual([]);
    const rows = await getPool().query('SELECT 1 FROM revision_headlines WHERE revision_id = $1', [revisionId]);
    expect(rows.rowCount).toBe(0);
    // Редакция без допуска не попадает и в выборку прохода.
    expect(await revisionsWithoutHeadline(50)).not.toContain(revisionId);
  });

  it('с допуском тема сохраняется один раз: повтор модель не зовёт', async () => {
    const sourceId = await insertSyntheticSource({ kind: 'telegram', key: 'headline_ok', access: 'approved', ai: 'approved' });
    const revisionId = await store(sourceId, 'h2', TEXT);
    calls.length = 0;

    const first = await ensureHeadline(revisionId, caller());
    expect(first).toMatchObject({ outcome: 'saved', topic: 'Конкурс на корпус три жилого комплекса' });
    expect(calls).toHaveLength(1);

    // Вторая тема той же конфигурации не создаётся, даже если модель ответила бы иначе.
    const second = await ensureHeadline(revisionId, caller('другая тема'));
    expect(second).toMatchObject({ outcome: 'exists', topic: 'Конкурс на корпус три жилого комплекса' });
    expect(calls).toHaveLength(1);

    const rows = await getPool().query<{ n: number }>(
      'SELECT count(*)::int AS n FROM revision_headlines WHERE revision_id = $1',
      [revisionId],
    );
    expect(rows.rows[0]!.n).toBe(1);
  });

  it('проход берёт только редакции допущенных источников без темы', async () => {
    const sourceId = await insertSyntheticSource({ kind: 'telegram', key: 'headline_pass', access: 'approved', ai: 'approved' });
    const revisionId = await store(sourceId, 'h3', `${TEXT} Подписывайтесь на канал.`);
    calls.length = 0;

    const pass = await runHeadlinePass(50, caller('Строительство корпуса три идёт по плану'));

    expect(pass.some(r => r.revisionId === revisionId && r.outcome === 'saved')).toBe(true);
    expect(await revisionsWithoutHeadline(50)).not.toContain(revisionId);
    // Повторный проход по тем же данным модель не зовёт.
    const before = calls.length;
    await runHeadlinePass(50, caller());
    expect(calls).toHaveLength(before);
  });

  it('тема остаётся неизменной: правка и удаление строки запрещены', async () => {
    const sourceId = await insertSyntheticSource({ kind: 'telegram', key: 'headline_immutable', access: 'approved', ai: 'approved' });
    const revisionId = await store(sourceId, 'h4', TEXT);
    await ensureHeadline(revisionId, caller());

    await expect(
      getPool().query('UPDATE revision_headlines SET topic = $2 WHERE revision_id = $1', [revisionId, 'подмена']),
    ).rejects.toThrow();
    await expect(getPool().query('DELETE FROM revision_headlines WHERE revision_id = $1', [revisionId])).rejects.toThrow();
  });
});
