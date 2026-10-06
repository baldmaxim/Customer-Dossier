// Пары по звучанию названия на PostgreSQL (06.10.2026): «Sminex», «Сминекс» и «Смайнекс» встают в очередь
// «возможный дубль» без слияния; повтор без изменений каталога ничего не читает и не плодит пар; отклонённая
// пара не всплывает; две компании с реквизитами в пару не ставятся.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDb, getPool } from '../db/pool.js';
import { resetAndMigrate } from '../__tests__/integration/db.js';
import { SOUND_PAIR_SCORE, enqueueSoundPairs } from './soundPairs.js';

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

const queue = async () =>
  (
    await getPool().query<{ source: number; target: number; score: string; status: string; reasons: { key: string; sound: string } }>(
      `SELECT source_entity_id::int AS source, target_entity_id::int AS target, score::text, status::text AS status, reasons
       FROM merge_queue WHERE entity_kind = 'company' ORDER BY target_entity_id, source_entity_id`,
    )
  ).rows;

beforeAll(async () => {
  await resetAndMigrate();
});

afterAll(async () => {
  await closeDb();
});

describe('пары «возможный дубль» по звучанию названия', () => {
  it('Sminex, Сминекс и Смайнекс — три ждущие пары, никто не слит', async () => {
    const sminex = await company('Sminex', '7704412966');
    const ru = await company('Сминекс');
    const alt = await company('Смайнекс');

    const result = await enqueueSoundPairs({ limit: 10, dryRun: false });
    expect(result.inserted).toBe(3);
    const rows = await queue();
    expect(rows.map(r => [r.source, r.target])).toEqual(
      expect.arrayContaining([
        [ru, sminex],
        [alt, sminex],
        [alt, ru],
      ]),
    );
    const sound = rows.filter(r => r.reasons.key === 'sound_key');
    expect(sound).toHaveLength(3);
    expect(sound.every(r => r.status === 'pending' && Number(r.score) === SOUND_PAIR_SCORE && r.reasons.sound === 'smnks')).toBe(true);
    const merged = await getPool().query('SELECT count(*)::int AS n FROM companies WHERE merged_into_id IS NOT NULL');
    expect(merged.rows[0]!.n).toBe(0);
  });

  it('каталог не менялся — проход пропущен; принудительный — без новых пар', async () => {
    expect((await enqueueSoundPairs({ limit: 10, dryRun: false })).skipped).toBe(true);
    const forced = await enqueueSoundPairs({ limit: 10, dryRun: false, force: true });
    expect(forced).toMatchObject({ skipped: false, inserted: 0 });
    expect(forced.fresh).toEqual([]);
  });

  it('отклонённая пара не всплывает; две компании с ИНН в пару не встают', async () => {
    await getPool().query(`UPDATE merge_queue SET status = 'rejected' WHERE reasons->>'key' = 'sound_key'`);
    await company('Capital Group', '7707083893');
    await company('Капитал Групп', '7728168971');
    const result = await enqueueSoundPairs({ limit: 10, dryRun: false });
    expect(result.inserted).toBe(0);
    expect((await queue()).filter(r => r.status === 'pending')).toEqual([]);
  });
});
