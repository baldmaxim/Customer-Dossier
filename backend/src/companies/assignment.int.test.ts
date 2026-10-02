// Назначение имени без ИНН на настоящей базе (миграция 043, ADR-016, этап 23D): кандидаты — похожие юрлица
// портала и пары «возможный дубль» с вердиктом модели, подсказки Фокуса с отметкой «уже в портале»;
// «это юрлицо с ИНН» — реквизит на карточку (чужой — отказ с указанием владельца, опечатка — отказ);
// «не компания» — уходит из «Без ИНН», «Вернуть» — возвращает; слияние уносит подсказки и не переносит
// действующую «не компания» на цель. Данные синтетические, сети нет.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDb, getPool, withTransaction } from '../db/pool.js';
import { resetAndMigrate } from '../__tests__/integration/db.js';
import { loadCatalog } from '../api/companyCatalog.js';
import { applyEntityMerge } from '../resolve/entityMerge.js';
import { dismissCompany, identifyCompany, loadAssignment, restoreCompany } from './assignment.js';

const INN_LEGAL = '7707083893';
const INN_FREE = '500100732259';
const pool = getPool;

const company = async (name: string, latin: string, type = 'unknown'): Promise<number> =>
  (await pool().query<{ id: number }>(
    `INSERT INTO companies (name, name_norm, name_latin, entity_type) VALUES ($1, lower($1), $2, $3) RETURNING id`,
    [name, latin, type],
  )).rows[0]!.id;

const inn = async (companyId: number, value: string): Promise<void> => {
  await pool().query(
    `INSERT INTO entity_identifiers (company_id, jurisdiction, identifier_type, value, validation_status, origin)
     VALUES ($1, 'RU', 'inn', $2, 'checksum_valid', 'manual')`,
    [companyId, value],
  );
};

const identify = (companyId: number, raw: string) => withTransaction(client => identifyCompany(client, { companyId, raw, actor: 'oper' }));

let legal = 0;
let mention = 0;
let other = 0;

beforeAll(async () => {
  await resetAndMigrate();
  legal = await company('Демострой', 'demostroi', 'legal_entity');
  await inn(legal, INN_LEGAL);
  mention = await company('Демострой', 'demostroi');
  other = await company('Ромашка', 'romashka');
  await pool().query(
    `INSERT INTO merge_queue (entity_kind, source_entity_id, target_entity_id, score, reasons, model_verdict, model_reason)
     VALUES ('company', $1, $2, 0.8, '{}', 'same', 'одно и то же имя, реквизит у юрлица')`,
    [mention, legal],
  );
  await pool().query(
    `INSERT INTO company_name_suggestions (company_id, inn, payload, rank) VALUES ($1, $2, '{"name":"ООО \\"ДЕМОСТРОЙ\\""}', 0), ($1, $3, '{"name":"ООО \\"ДЕМОСТРОЙ ЮГ\\""}', 1)`,
    [mention, INN_LEGAL, INN_FREE],
  );
});

afterAll(async () => {
  await closeDb();
});

describe('назначение имени без ИНН', () => {
  it('кандидаты: юрлицо портала с вердиктом модели; подсказка Фокуса с этим ИНН — «уже в портале»', async () => {
    const view = await loadAssignment(pool(), mention);
    expect(view?.state).toBe('unidentified');
    expect(view?.portal[0]).toMatchObject({ companyId: legal, inn: INN_LEGAL, modelVerdict: 'same', mergeQueueId: expect.any(Number) });
    expect(view?.egrul).toMatchObject([
      { inn: INN_LEGAL, name: 'ООО "ДЕМОСТРОЙ"', existingCompanyId: legal },
      { inn: INN_FREE, existingCompanyId: null },
    ]);
    expect((await loadAssignment(pool(), legal))?.state).toBe('identified');
  });

  it('«это юрлицо с ИНН»: чужой реквизит — отказ с владельцем, опечатка — отказ, свободный — на карточку', async () => {
    expect(await identify(other, INN_LEGAL)).toMatchObject({ ok: false, reason: 'identifier_taken', companyId: legal });
    expect(await identify(other, '7707083894')).toEqual({ ok: false, reason: 'bad_checksum' });
    expect(await identify(other, INN_FREE)).toMatchObject({ ok: true });
    const row = (await pool().query('SELECT entity_type FROM companies WHERE id = $1', [other])).rows[0];
    expect(row).toEqual({ entity_type: 'legal_entity' });
    expect((await loadAssignment(pool(), other))?.state).toBe('identified');
  });

  it('«не компания» убирает имя из «Без ИНН», «Вернуть» возвращает', async () => {
    const before = await loadCatalog({ view: 'unidentified', watch: false, role: 'any', sort: 'objects' });
    expect(before.items.find(r => r.companyId === mention)).toMatchObject({ hints: 3 });
    await dismissCompany(pool(), mention, 'это фамилия журналиста', 'oper');
    const hidden = await loadCatalog({ view: 'unidentified', watch: false, role: 'any', sort: 'objects' });
    expect(hidden.items.some(r => r.companyId === mention)).toBe(false);
    expect(hidden.counts.dismissed).toBe(1);
    expect((await loadAssignment(pool(), mention))?.dismissal).toMatchObject({ reason: 'это фамилия журналиста', by: 'oper' });
    await restoreCompany(pool(), mention, 'oper');
    const back = await loadCatalog({ view: 'unidentified', watch: false, role: 'any', sort: 'objects' });
    expect(back.items.some(r => r.companyId === mention)).toBe(true);
  });

  it('«это компания X» — слияние: подсказки упоминания удаляются, действующая «не компания» на цель не переходит', async () => {
    await dismissCompany(pool(), mention, 'ошибочно отмечено', 'oper');
    const versions = (await pool().query<{ id: number; version: number }>('SELECT id, version FROM companies WHERE id = ANY($1::bigint[])', [[mention, legal]])).rows;
    await applyEntityMerge({
      kind: 'company',
      sourceId: mention,
      targetId: legal,
      expectedSourceVersion: versions.find(v => v.id === mention)!.version,
      expectedTargetVersion: versions.find(v => v.id === legal)!.version,
      idempotencyKey: 'assignment-merge-0001',
      actor: 'int-test',
    });
    expect((await pool().query('SELECT 1 FROM company_name_suggestions WHERE company_id = ANY($1::bigint[])', [[mention, legal]])).rowCount).toBe(0);
    expect((await pool().query('SELECT 1 FROM company_dismissals WHERE company_id = $1 AND revoked_at IS NULL', [legal])).rowCount).toBe(0);
    expect((await loadAssignment(pool(), legal))?.state).toBe('identified');
  });
});
