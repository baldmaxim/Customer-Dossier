// Этап 20D на настоящей базе (миграция 035): кандидаты со страниц застройщика и группы ДОМ.РФ.
// Объект, уже стоящий в сборе, кандидатом не становится; решение оператора не перезаписывается
// следующим чтением страницы; «подтвердить» и «заменить» ставят ссылку в обычную очередь сбора;
// заказчик находится по ИНН со страницы застройщика. Объекты страницы, которую оператор подтвердил
// как страницу компании («Это он»), встают в сбор сами (ADR-012 п. 32); снятая карточка объекта
// перечитывается через неделю. Данные синтетические, сети нет.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDb, getPool, withTransaction } from '../../db/pool.js';
import { resetAndMigrate } from '../../__tests__/integration/db.js';
import {
  AUTO_CONFIRM_ACTOR,
  DomRfCandidateError,
  autoConfirmLinkedDomRfCandidates,
  confirmDomRfCandidate,
  confirmDomRfCandidates,
  listDomRfCandidates,
  rejectDomRfCandidate,
  replaceDomRfCandidate,
  upsertDomRfCandidates,
} from './domrfCandidates.js';
import { domRfCardUrl, domRfObjectUrl, parseDomRfCardCapture, saveScannedDomRfCard } from './domrfCards.js';
import { TARGET_TTL_DAYS, claimDomRfTarget, listDomRfTargets, markDomRfCaptured, registerDomRfTarget } from './domrfTargets.js';

const INN = '7700001235';

const card = (objects: string[], ref = '901') =>
  parseDomRfCardCapture({
    format: 'domrf-card-browser@1',
    url: domRfCardUrl('developer', ref),
    kind: 'developer',
    externalRef: ref,
    title: 'ООО СЗ ДЕМО-ПРАКТИКА',
    documentTitle: 'ООО СЗ ДЕМО-ПРАКТИКА',
    inn: INN,
    kpp: null,
    ogrn: null,
    legalAddress: null,
    groupRef: null,
    groupName: null,
    objects: objects.map(ref => ({ ref, status: 'Строится', name: `Демо-дом ${ref}`, place: 'г. Москва' })),
  });

const scan = (objects: string[], ref = '901'): Promise<number> =>
  withTransaction(async client => {
    const capture = card(objects, ref);
    await saveScannedDomRfCard(client, capture);
    return upsertDomRfCandidates(client, capture);
  });

const idOf = async (ref: string): Promise<number> =>
  Number((await getPool().query<{ id: string }>('SELECT id FROM domrf_candidates WHERE external_ref = $1', [ref])).rows[0]?.id);

beforeAll(async () => {
  await resetAndMigrate();
});

afterAll(async () => {
  await closeDb();
});

describe('domrf_candidates', () => {
  it('объект, уже стоящий в сборе, кандидатом не становится; заказчик — по ИНН со страницы застройщика', async () => {
    await registerDomRfTarget({ url: domRfObjectUrl('7001') });
    const company = (
      await getPool().query<{ id: number }>(
        `INSERT INTO companies (name, name_norm, name_latin) VALUES ('ООО СЗ Демо-Практика', 'сз демо практика', 'sz demo praktika') RETURNING id`,
      )
    ).rows[0]!.id;
    await getPool().query(
      `INSERT INTO entity_identifiers (company_id, jurisdiction, identifier_type, value, validation_status, origin)
       VALUES ($1, 'RU', 'inn', $2, 'checksum_valid', 'manual')`,
      [company, INN],
    );

    expect(await scan(['7001', '7002', '7003', '7004'])).toBe(3);
    const { items, sources } = await listDomRfCandidates('pending');
    expect(items.map(i => i.externalRef)).toEqual(['7002', '7003', '7004']);
    expect(items[0]).toMatchObject({ label: 'Демо-дом 7002', details: 'Строится · г. Москва', foundViaKind: 'developer', foundViaRef: '901' });
    expect(sources).toEqual([expect.objectContaining({ kind: 'developer', externalRef: '901', inn: INN, companyId: company, pending: 3 })]);
  });

  it('подтвердить — ссылка в очереди сбора; отклонить — остаётся отклонённым после нового чтения страницы', async () => {
    await confirmDomRfCandidate(await idOf('7002'), 'alpha');
    expect((await listDomRfTargets()).map(t => t.externalRef).sort()).toEqual(['7001', '7002']);

    await rejectDomRfCandidate(await idOf('7003'), 'alpha', 'другой корпус');
    expect(await scan(['7001', '7002', '7003', '7004', '7005'])).toBe(1);
    const decided = (await listDomRfCandidates('decided')).items;
    expect(decided.map(i => [i.externalRef, i.state, i.decidedBy])).toEqual([
      ['7002', 'confirmed', 'alpha'],
      ['7003', 'rejected', 'alpha'],
    ]);
    expect((await listDomRfCandidates('pending')).items.map(i => i.externalRef)).toEqual(['7004', '7005']);
  });

  it('заменить — в сбор встаёт указанная карточка; решённого кандидата заново не решить', async () => {
    await replaceDomRfCandidate(await idOf('7004'), 'alpha', domRfObjectUrl('8001'));
    expect((await listDomRfTargets()).map(t => t.externalRef).sort()).toEqual(['7001', '7002', '8001']);
    const replaced = (await listDomRfCandidates('decided')).items.find(i => i.externalRef === '7004');
    expect(replaced).toMatchObject({ state: 'replaced', replacementRef: '8001' });

    await expect(confirmDomRfCandidate(await idOf('7004'), 'alpha')).rejects.toBeInstanceOf(DomRfCandidateError);
    await expect(replaceDomRfCandidate(await idOf('7005'), 'alpha', domRfObjectUrl('7005'))).rejects.toThrow(/та же карточка/);

    const batch = await confirmDomRfCandidates([await idOf('7005'), await idOf('7002')], 'beta');
    expect(batch.confirmed).toBe(1);
    expect(batch.failed).toEqual([expect.objectContaining({ id: await idOf('7002') })]);
  });

  it('база держит инварианты: неизвестное состояние и решение без даты не записать', async () => {
    await expect(getPool().query(`UPDATE domrf_candidates SET state = 'unknown' WHERE external_ref = '7005'`)).rejects.toThrow(/domrf_candidates_state/);
    await expect(getPool().query(`UPDATE domrf_candidates SET decided_at = NULL WHERE external_ref = '7005'`)).rejects.toThrow(/domrf_candidates_decided/);
  });
});

describe('объекты подтверждённой страницы компании (ADR-012 п. 32)', () => {
  it('«Это он» по странице — её кандидаты в сборе без отдельного решения; отклонённый остаётся отклонённым', async () => {
    const company = (
      await getPool().query<{ id: number }>(
        `INSERT INTO companies (name, name_norm, name_latin) VALUES ('ООО СЗ Авто', 'сз авто', 'sz avto') RETURNING id`,
      )
    ).rows[0]!.id;
    expect(await scan(['7101', '7102', '7103'], '902')).toBe(3);
    await rejectDomRfCandidate(await idOf('7103'), 'alpha', 'не наш дом');

    // Страница ещё не подтверждена — ничего не происходит.
    expect(await autoConfirmLinkedDomRfCandidates()).toBe(0);

    await getPool().query(
      `INSERT INTO domrf_company_links (company_id, kind, external_ref, name, found_by, state, decided_by, decided_at)
       VALUES ($1, 'developer', '902', 'ООО СЗ АВТО', 'inn', 'confirmed', 'alpha', now())`,
      [company],
    );
    expect(await autoConfirmLinkedDomRfCandidates()).toBe(2);
    expect(await autoConfirmLinkedDomRfCandidates()).toBe(0);

    const decided = (await listDomRfCandidates('decided')).items.filter(i => i.foundViaRef === '902');
    expect(decided.map(i => [i.externalRef, i.state, i.decidedBy])).toEqual([
      ['7101', 'confirmed', AUTO_CONFIRM_ACTOR],
      ['7102', 'confirmed', AUTO_CONFIRM_ACTOR],
      ['7103', 'rejected', 'alpha'],
    ]);
    const targets = (await listDomRfTargets()).map(t => t.externalRef);
    expect(targets).toEqual(expect.arrayContaining(['7101', '7102']));
    expect(targets).not.toContain('7103');
  });

  it('страница снята с чтения — её кандидаты сами в сбор не идут', async () => {
    const company = (
      await getPool().query<{ id: number }>(
        `INSERT INTO companies (name, name_norm, name_latin) VALUES ('ООО СЗ Снято', 'сз снято', 'sz snyato') RETURNING id`,
      )
    ).rows[0]!.id;
    expect(await scan(['7201'], '903')).toBe(1);
    await getPool().query(
      `INSERT INTO domrf_company_links (company_id, kind, external_ref, name, found_by, state, decided_by, decided_at)
       VALUES ($1, 'developer', '903', 'ООО СЗ СНЯТО', 'inn', 'confirmed', 'alpha', now())`,
      [company],
    );
    await getPool().query(`UPDATE domrf_cards SET withdrawn_at = now() WHERE kind = 'developer' AND external_ref = '903'`);
    expect(await autoConfirmLinkedDomRfCandidates()).toBe(0);
    expect((await listDomRfCandidates('pending')).items.map(i => i.externalRef)).toContain('7201');
  });

  it('снятая карточка объекта перечитывается, когда снимку больше недели', async () => {
    // Все поставленные — сняты: очередь пуста.
    for (const t of await listDomRfTargets()) {
      await withTransaction(client => markDomRfCaptured(client, t.externalRef, null, null));
    }
    expect(await claimDomRfTarget()).toBeNull();

    await getPool().query(
      `UPDATE domrf_targets SET captured_at = now() - make_interval(days => $1 + 1), requested_at = now() - make_interval(days => $1 + 2)
       WHERE external_ref = '7101'`,
      [TARGET_TTL_DAYS],
    );
    expect((await claimDomRfTarget())?.externalRef).toBe('7101');
  });
});
