// Разбор пар «возможный дубль» моделью на PostgreSQL (02.10.2026). Модель подменена: проверяется, что
// правило «разные ИНН» решает без неё, что вердикт пишется рядом с парой, что «different» с применением
// отклоняет пару от имени модели, а «same» без MERGE_APPLY_ENABLED не сливает и говорит почему.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDb, getPool } from '../db/pool.js';
import { resetAndMigrate } from '../__tests__/integration/db.js';
import { runModelReviewPass, type EntityMatchCaller } from './modelReview.js';

const company = async (name: string, inn: string | null = null): Promise<number> => {
  const id = (
    await getPool().query<{ id: number }>(
      `INSERT INTO companies (name, name_norm, name_latin, entity_type) VALUES ($1, lower($1), lower($1), 'legal_entity') RETURNING id`,
      [name],
    )
  ).rows[0]!.id;
  if (inn) {
    await getPool().query(
      `INSERT INTO entity_identifiers (company_id, jurisdiction, identifier_type, value, validation_status, origin)
       VALUES ($1, 'RU', 'inn', $2, 'checksum_valid', 'manual')`,
      [id, inn],
    );
  }
  return id;
};

const pair = async (source: number, target: number): Promise<number> =>
  (
    await getPool().query<{ id: number }>(
      `INSERT INTO merge_queue (entity_kind, source_entity_id, target_entity_id, score, reasons) VALUES ('company', $1, $2, 0.9, '{}') RETURNING id`,
      [source, target],
    )
  ).rows[0]!.id;

const row = async (id: number) =>
  (
    await getPool().query<{ status: string; model_verdict: string | null; decided_by: string | null; decision_note: string | null }>(
      'SELECT status::text AS status, model_verdict, decided_by, decision_note FROM merge_queue WHERE id = $1',
      [id],
    )
  ).rows[0]!;

const answer = (verdict: 'same' | 'different' | 'unsure'): EntityMatchCaller & { calls: string[] } => {
  const calls: string[] = [];
  const caller = (async (body: string) => {
    calls.push(body);
    return { ok: true, data: { verdict, reason: `тест: ${verdict}` } };
  }) as EntityMatchCaller & { calls: string[] };
  caller.calls = calls;
  return caller;
};

beforeAll(async () => {
  await resetAndMigrate();
});

afterAll(async () => {
  await closeDb();
});

describe('разбор пар «возможный дубль» моделью', () => {
  it('разные ИНН — different правилом, модель не зовётся; с применением пара отклонена моделью', async () => {
    const q = await pair(await company('Демо-Альфа', '7704412966'), await company('Демо-Альфа', '7736050003'));
    const caller = answer('same');
    const [result] = await runModelReviewPass({ limit: 10, apply: true, caller });
    expect(caller.calls).toHaveLength(0);
    expect(result).toMatchObject({ queueId: q, verdict: 'different', by: 'rule', action: 'rejected' });
    expect(await row(q)).toMatchObject({ status: 'rejected', model_verdict: 'different' });
    expect((await row(q)).decided_by).toMatch(/^model:/);
  });

  it('без применения — только вердикт; пара ждёт оператора', async () => {
    const q = await pair(await company('Демо-Бета'), await company('Демо-Бета'));
    const [result] = await runModelReviewPass({ limit: 10, apply: false, caller: answer('different') });
    expect(result).toMatchObject({ queueId: q, verdict: 'different', by: 'model', action: 'judged' });
    expect(await row(q)).toMatchObject({ status: 'pending', model_verdict: 'different', decided_by: null });
  });

  it('same без MERGE_APPLY_ENABLED не сливает и пишет почему; повторно та же модель пару не берёт', async () => {
    const q = await pair(await company('Демо-Гамма'), await company('Демо-Гамма'));
    const caller = answer('same');
    const results = await runModelReviewPass({ limit: 10, apply: true, caller });
    expect(results.find(r => r.queueId === q)).toMatchObject({ verdict: 'same', action: 'blocked' });
    expect(await row(q)).toMatchObject({ status: 'pending', model_verdict: 'same' });
    expect(await runModelReviewPass({ limit: 10, apply: true, caller })).toEqual([]);
  });
});
