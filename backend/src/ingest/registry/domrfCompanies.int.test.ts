// Этап 20D, шаг 2 на настоящей базе (миграция 037): поиск компаний портала в реестре застройщиков ДОМ.РФ.
// Ищутся все компании — заказчики первыми; с ИНН — по ИНН, без — по названию, общее название не ищется.
// Выдача по названию — только совпавшее с названием; решения оператора не перезаписываются повторным
// поиском; подтверждённая страница уходит в очередь чтения. «Искать сейчас» ставит компанию в начало
// очереди. «Это он» — одна запись на компанию: выбор закрывает остальные, страница закрытой снимается с
// чтения вместе с ещё не решёнными объектами; «Отменить» возвращает всё как было. Слияние компаний переносит
// совпадения и поиск, дубль той же страницы у цели удаляется.
// Данные синтетические, сети нет.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDb, getPool } from '../../db/pool.js';
import { resetAndMigrate } from '../../__tests__/integration/db.js';
import { applyEntityMerge } from '../../resolve/entityMerge.js';
import {
  CHOSEN_OTHER_NOTE,
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
  undoDomRfCompanyLink,
} from './domrfCompanies.js';
import { WITHDRAWN_NOTE, domRfCardUrl } from './domrfCards.js';

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

    // Выбор группы закрывает застройщика: компании соответствует одна запись.
    expect(await confirmDomRfCompanyLink(await linkId(alpha, 'group', '55'), 'oper')).toEqual({ closed: 1, reopened: 0, withdrawnObjects: 0 });
    await expect(rejectDomRfCompanyLink(await linkId(alpha, 'developer', '901'), 'oper')).rejects.toBeInstanceOf(DomRfCompanyError);
    const card = await pool().query(`SELECT url FROM domrf_cards WHERE kind = 'group' AND external_ref = '55'`);
    expect(card.rows[0]?.url).toBe(domRfCardUrl('group', '55'));

    expect(await saveDomRfCompanySearch(searching, found)).toBe(0);
    const { items, matched, totals } = await listDomRfCompanies({ filter: 'confirmed', q: 'Альфа' });
    expect(matched).toBe(1);
    expect(items[0]!.links.map(l => [l.kind, l.externalRef, l.state])).toEqual([
      ['group', '55', 'confirmed'],
      ['developer', '901', 'rejected'],
    ]);
    expect(items[0]!.links[1]!.decisionNote).toBe(CHOSEN_OTHER_NOTE);
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

  it('одна запись на компанию: другой выбор снимает прежнюю страницу и её объекты; «Отменить» возвращает', async () => {
    const add = async (kind: 'developer' | 'group', ref: string): Promise<number> =>
      (
        await pool().query<{ id: number }>(
          `INSERT INTO domrf_company_links (company_id, kind, external_ref, name, found_by, rank) VALUES ($1, $2, $3, 'ГАММА', 'name', 1) RETURNING id`,
          [other, kind, ref],
        )
      ).rows[0]!.id;
    const [first, second, group] = [await add('developer', '801'), await add('developer', '802'), await add('group', '803')];
    expect(await confirmDomRfCompanyLink(first, 'oper')).toMatchObject({ closed: 2 });

    // Страница 801 прочитана: два объекта ждут решения, второй есть и на другой странице в чтении.
    await pool().query(`UPDATE domrf_cards SET object_refs = '{5001,5002}', scanned_at = now() WHERE kind = 'developer' AND external_ref = '801'`);
    await pool().query(`INSERT INTO domrf_cards (kind, external_ref, url, object_refs) VALUES ('group', '999', $1, '{5002}')`, [domRfCardUrl('group', '999')]);
    for (const ref of ['5001', '5002']) {
      await pool().query(
        `INSERT INTO domrf_candidates (external_ref, url, label, found_via_kind, found_via_ref) VALUES ($1, $2, $1, 'developer', '801')`,
        [ref, `https://example.invalid/${ref}`],
      );
    }
    const objects = async (): Promise<Array<{ external_ref: string; state: string; decision_note: string | null }>> =>
      (await pool().query('SELECT external_ref, state, decision_note FROM domrf_candidates WHERE external_ref IN ($1, $2) ORDER BY external_ref', ['5001', '5002'])).rows;
    const withdrawn = async (ref: string): Promise<boolean> =>
      (await pool().query<{ w: boolean }>(`SELECT withdrawn_at IS NOT NULL AS w FROM domrf_cards WHERE kind = 'developer' AND external_ref = $1`, [ref])).rows[0]!.w;

    // Инженер передумал: «Это он» — второй застройщик. Первый закрыт, его страница снята, объект только с неё — тоже.
    expect(await confirmDomRfCompanyLink(second, 'oper')).toEqual({ closed: 1, reopened: 0, withdrawnObjects: 1 });
    expect(await withdrawn('801')).toBe(true);
    expect(await objects()).toEqual([
      { external_ref: '5001', state: 'rejected', decision_note: WITHDRAWN_NOTE },
      { external_ref: '5002', state: 'pending', decision_note: null },
    ]);

    // «Отменить» у выбранного: закрытые его выбором снова ждут решения, его страница снята.
    expect(await undoDomRfCompanyLink(second, 'oper')).toEqual({ closed: 0, reopened: 2, withdrawnObjects: 0 });
    const states = (await pool().query<{ id: number; state: string }>('SELECT id, state FROM domrf_company_links WHERE id = ANY($1::bigint[]) ORDER BY id', [[first, second, group]])).rows;
    expect(states.map(r => r.state)).toEqual(['pending', 'pending', 'pending']);
    expect(await withdrawn('802')).toBe(true);
    await expect(undoDomRfCompanyLink(second, 'oper')).rejects.toBeInstanceOf(DomRfCompanyError);

    // Снова выбрали первого: страница вернулась в чтение, её объект — в «Объекты».
    await confirmDomRfCompanyLink(first, 'oper');
    expect(await withdrawn('801')).toBe(false);
    expect((await objects())[0]).toEqual({ external_ref: '5001', state: 'pending', decision_note: null });
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
