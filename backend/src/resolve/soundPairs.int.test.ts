// Пары по звучанию названия на PostgreSQL (06.10.2026): «Sminex», «Сминекс» и «Смайнекс» встают в очередь
// «возможный дубль» без слияния; повтор без изменений каталога ничего не читает и не плодит пар; отклонённая
// пара не всплывает; две компании с реквизитами в пару не ставятся.

import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
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

const ORIGIN = 'http://127.0.0.1:5173';
let server: http.Server;
let port = 0;

const similar = (companyId: number): Promise<Array<{ id: number; modelVerdict: string | null }>> =>
  new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method: 'GET', path: `/api/companies/${companyId}/similar`, headers: { host: `127.0.0.1:${port}`, origin: ORIGIN } },
      res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => resolve((JSON.parse(data) as { items: Array<{ id: number; modelVerdict: string | null }> }).items));
      },
    );
    req.on('error', reject);
    req.end();
  });

let sminex = 0;
let ru = 0;
let alt = 0;

beforeAll(async () => {
  await resetAndMigrate();
  server = http.createServer(createApp({ allowedOrigins: [ORIGIN] }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await closeDb();
});

describe('пары «возможный дубль» по звучанию названия', () => {
  it('Sminex, Сминекс и Смайнекс — три ждущие пары, никто не слит', async () => {
    sminex = await company('Sminex', '7704412966');
    ru = await company('Сминекс');
    alt = await company('Смайнекс');

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

  it('плашка «Похожие компании»: пары очереди видны; «та же» по модели — первой, «разные» — скрыта', async () => {
    // У «Sminex» триграммы «Смайнекс» не находят — её приносит только пара очереди.
    expect((await similar(sminex)).map(s => s.id).sort()).toEqual([ru, alt].sort());
    await getPool().query(
      `UPDATE merge_queue SET model_verdict = CASE WHEN least(source_entity_id, target_entity_id) = $1 AND greatest(source_entity_id, target_entity_id) = $2
                                                   THEN 'same' ELSE 'different' END
       WHERE reasons->>'key' = 'sound_key' AND $3 IN (source_entity_id, target_entity_id)`,
      [Math.min(sminex, alt), Math.max(sminex, alt), sminex],
    );
    expect(await similar(sminex)).toEqual([expect.objectContaining({ id: alt, modelVerdict: 'same' })]);
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
