// Этап 20D, шаг 2 на настоящей базе (миграция 037): поиск компаний портала в реестре застройщиков ДОМ.РФ.
// Ищутся все компании — заказчики первыми; с ИНН — по ИНН, без — по названию, общее название не ищется.
// Выдача по названию — только совпавшее с названием; решения оператора не перезаписываются повторным
// поиском; подтверждённая страница уходит в очередь чтения. «Искать сейчас» ставит компанию в начало
// очереди. Слияние компаний переносит совпадения и поиск, дубль той же страницы у цели удаляется.
// Данные синтетические, сети нет.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDb, getPool } from '../../db/pool.js';
import { resetAndMigrate } from '../../__tests__/integration/db.js';
import { applyEntityMerge } from '../../resolve/entityMerge.js';
import {
  DomRfCompanyError,
  claimDomRfCompanySearch,
  confirmDomRfCompanyLink,
  domRfSearchUrl,
  linkDomRfCompanyManually,
  listDomRfCompanies,
  parseDomRfSearchCapture,
  rejectDomRfCompanyLink,
  requestDomRfCompanySearch,
  saveDomRfCompanySearch,
} from './domrfCompanies.js';
import { domRfCardUrl } from './domrfCards.js';

const INN = '7700001235';
const pool = getPool;

const company = async (name: string): Promise<number> =>
  (await pool().query<{ id: number }>(`INSERT INTO companies (name, name_norm, name_latin) VALUES ($1, lower($1), lower($1)) RETURNING id`, [name])).rows[0]!.id;

const customerOf = async (companyId: number, project: string): Promise<void> => {
  const projectId = (
    await pool().query<{ id: number }>(`INSERT INTO projects (name, name_norm, name_latin) VALUES ($1, lower($1), lower($1)) RETURNING id`, [project])
  ).rows[0]!.id;
  await pool().query(`INSERT INTO project_participants (project_id, company_id, role) VALUES ($1, $2, 'customer')`, [projectId, companyId]);
};

const results = (...items: Array<[kind: 'developer' | 'group', ref: string, name: string]>) =>
  parseDomRfSearchCapture({ format: 'domrf-search-browser@1', url: domRfSearchUrl('x'), results: items.map(([kind, ref, name]) => ({ kind, ref, name })) });

const linkId = async (companyId: number, kind: string, ref: string): Promise<number> =>
  (await pool().query<{ id: number }>('SELECT id FROM domrf_company_links WHERE company_id = $1 AND kind = $2 AND external_ref = $3', [companyId, kind, ref])).rows[0]!.id;

let alpha = 0;
let beta = 0;
let other = 0;
let generic = 0;

beforeAll(async () => {
  await resetAndMigrate();
  generic = await company('СЗ');
  other = await company('Демо-Гамма Проект');
  alpha = await company('Демо-Альфа Девелопмент');
  beta = await company('Демо-Бета Строй');
  await customerOf(alpha, 'Демо-квартал Альфа');
  await customerOf(beta, 'Демо-квартал Бета');
  await pool().query(
    `INSERT INTO entity_identifiers (company_id, jurisdiction, identifier_type, value, validation_status, origin)
     VALUES ($1, 'RU', 'inn', $2, 'checksum_valid', 'manual')`,
    [beta, INN],
  );
});

afterAll(async () => {
  await closeDb();
});

describe('поиск компаний в реестре застройщиков', () => {
  it('очередь: все компании, заказчик с ИНН первым; общее название помечается, а не ищется; взятый не берётся повторно', async () => {
    expect(await claimDomRfCompanySearch()).toMatchObject({ companyId: beta, query: INN, foundBy: 'inn' });
    expect(await claimDomRfCompanySearch()).toMatchObject({ companyId: alpha, query: 'Демо-Альфа Девелопмент', foundBy: 'name' });
    expect(await claimDomRfCompanySearch()).toMatchObject({ companyId: other, query: 'Демо-Гамма Проект', foundBy: 'name' });
    expect(await claimDomRfCompanySearch()).toBeNull();

    const skipped = (await listDomRfCompanies({ filter: 'notFound' })).items.find(i => i.companyId === generic)!;
    expect(skipped).toMatchObject({ searchedAt: expect.any(Date), lastError: expect.stringContaining('укажите страницу вручную') });
  });

  it('«Искать сейчас» — в начало очереди, даже если компанию ещё не искали', async () => {
    const late = await company('Демо-Дельта Новая');
    expect(await requestDomRfCompanySearch(late)).toBe(true);
    expect(await claimDomRfCompanySearch()).toMatchObject({ companyId: late, foundBy: 'name' });
    expect(await requestDomRfCompanySearch(999_999)).toBe(false);
  });

  it('выдача по названию — только совпавшее с названием; подтверждение ставит страницу в очередь чтения; повторный поиск решений не трогает', async () => {
    const searching = { companyId: alpha, name: 'Демо-Альфа Девелопмент', query: 'Демо-Альфа Девелопмент', foundBy: 'name' as const, attemptCount: 1 };
    const found = results(['group', '55', 'Группа компаний «ДЕМО-АЛЬФА»'], ['developer', '901', 'ООО СЗ ДЕМО-АЛЬФА ДЕВЕЛОПМЕНТ'], ['developer', '902', 'ООО СЗ ДЕМО-БЕТА']);
    expect(await saveDomRfCompanySearch(searching, found)).toBe(2);

    await confirmDomRfCompanyLink(await linkId(alpha, 'group', '55'), 'oper');
    await rejectDomRfCompanyLink(await linkId(alpha, 'developer', '901'), 'oper');
    const card = await pool().query(`SELECT url FROM domrf_cards WHERE kind = 'group' AND external_ref = '55'`);
    expect(card.rows[0]?.url).toBe(domRfCardUrl('group', '55'));

    expect(await saveDomRfCompanySearch(searching, found)).toBe(0);
    const { items, matched, totals } = await listDomRfCompanies({ filter: 'confirmed', q: 'Альфа' });
    expect(matched).toBe(1);
    expect(items[0]!.links.map(l => [l.kind, l.externalRef, l.state])).toEqual([
      ['group', '55', 'confirmed'],
      ['developer', '901', 'rejected'],
    ]);
    expect(items[0]!.roles).toEqual(['customer']);
    expect(totals).toMatchObject({ companies: 5, confirmed: 1 });
    await expect(confirmDomRfCompanyLink(await linkId(alpha, 'group', '55'), 'oper')).rejects.toBeInstanceOf(DomRfCompanyError);
  });

  it('вручную — сразу подтверждённая страница; ссылка не на реестр — отказ', async () => {
    await linkDomRfCompanyManually(beta, domRfCardUrl('developer', '777'), 'oper');
    const row = (await listDomRfCompanies({ filter: 'confirmed' })).items.find(i => i.companyId === beta)!;
    expect(row.links).toEqual([expect.objectContaining({ kind: 'developer', externalRef: '777', state: 'confirmed', foundBy: 'manual' })]);
    await expect(linkDomRfCompanyManually(beta, 'https://example.com/застройщик/1', 'oper')).rejects.toBeInstanceOf(DomRfCompanyError);
  });

  it('слияние переносит совпадения и поиск к цели; та же страница у цели — строка источника удаляется', async () => {
    const dup = await company('Демо-Альфа Дубль');
    await customerOf(dup, 'Демо-квартал Дубль');
    const searching = { companyId: dup, name: 'Демо-Альфа Дубль', query: 'Демо-Альфа Дубль', foundBy: 'name' as const, attemptCount: 1 };
    await pool().query(`INSERT INTO domrf_company_searches (company_id, query, found_by) VALUES ($1, 'Демо-Альфа Дубль', 'name')`, [dup]);
    await saveDomRfCompanySearch(searching, results(['group', '55', 'ДЕМО-АЛЬФА'], ['group', '66', 'ДЕМО-АЛЬФА ДУБЛЬ']));

    const versions = (await pool().query<{ id: number; version: number }>('SELECT id, version FROM companies WHERE id = ANY($1::bigint[])', [[dup, alpha]])).rows;
    await applyEntityMerge({
      kind: 'company',
      sourceId: dup,
      targetId: alpha,
      expectedSourceVersion: versions.find(v => v.id === dup)!.version,
      expectedTargetVersion: versions.find(v => v.id === alpha)!.version,
      idempotencyKey: 'domrf-company-merge-0001',
      actor: 'int-test',
    });

    const links = (await pool().query<{ kind: string; external_ref: string; state: string }>(
      'SELECT kind, external_ref, state FROM domrf_company_links WHERE company_id = $1 ORDER BY kind, external_ref', [alpha],
    )).rows;
    expect(links).toEqual([
      { kind: 'developer', external_ref: '901', state: 'rejected' },
      { kind: 'group', external_ref: '55', state: 'confirmed' },
      { kind: 'group', external_ref: '66', state: 'pending' },
    ]);
    expect((await pool().query('SELECT 1 FROM domrf_company_links WHERE company_id = $1', [dup])).rowCount).toBe(0);
    expect((await pool().query('SELECT company_id FROM domrf_company_searches WHERE company_id = ANY($1::bigint[])', [[dup, alpha]])).rows).toEqual([{ company_id: alpha }]);
  });
});
