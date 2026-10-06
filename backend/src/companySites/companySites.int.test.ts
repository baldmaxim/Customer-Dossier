// Этап 25A на настоящей базе (миграция 045): сайты компаний — очередь поиска, журнал расхода, кандидаты и
// решения оператора, перенос при слиянии. Сети и модели нет: выдача поиска подаётся готовой (saveSiteSearch).
// Очередь: юрлица с реквизитом и группы, заказчики первыми; без реквизита и не группа — не ищется; общее
// название группы помечается. Решение оператора не перезаписывается повторным поиском; отклонённый хост не
// возвращается и не считается находкой. Лимит — до запроса и под блокировкой.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDb, getPool } from '../db/pool.js';
import { resetAndMigrate } from '../__tests__/integration/db.js';
import { applyEntityMerge } from '../resolve/entityMerge.js';
import {
  CompanySiteError,
  GENERIC_NAME_ERROR,
  claimSiteSearch,
  confirmSiteCandidate,
  finishSiteSearch,
  linkSiteManually,
  listCompanySites,
  loadCompanySites,
  loadSearchTargetByTaxId,
  rejectSiteCandidate,
  requestSiteSearch,
  reserveSiteSearch,
  saveSiteCheck,
  saveSiteSearch,
  siteSearchUsedLastDay,
  uncheckedCandidates,
} from './store.js';
import type { IAcceptedSite } from './url.js';

const INN = '7700001235';
const pool = getPool;

const company = async (name: string, entityType = 'legal_entity'): Promise<number> =>
  (
    await pool().query<{ id: number }>(
      `INSERT INTO companies (name, name_norm, name_latin, entity_type) VALUES ($1, lower($1), lower($1), $2) RETURNING id`,
      [name, entityType],
    )
  ).rows[0]!.id;

const customerOf = async (companyId: number, project: string): Promise<void> => {
  const projectId = (
    await pool().query<{ id: number }>(`INSERT INTO projects (name, name_norm, name_latin) VALUES ($1, lower($1), lower($1)) RETURNING id`, [project])
  ).rows[0]!.id;
  await pool().query(`INSERT INTO project_participants (project_id, company_id, role) VALUES ($1, $2, 'customer')`, [projectId, companyId]);
};

const site = (host: string): IAcceptedSite => ({ host, url: `https://${host}/`, reason: 'в выдаче', title: host, snippet: null });

const save = (companyId: number, accepted: IAcceptedSite[]) =>
  saveSiteSearch(companyId, { query: 'q', outcome: accepted.length > 0 ? 'found' : 'none', resultCount: 5, accepted, model: 'test-model', promptVersion: 'site-search@1', refreshDays: 90 });

const candidateId = async (companyId: number, host: string): Promise<number> =>
  (await pool().query<{ id: number }>('SELECT id FROM company_site_candidates WHERE company_id = $1 AND host = $2', [companyId, host])).rows[0]!.id;

let alpha = 0;
let beta = 0;
let group = 0;
let generic = 0;

beforeAll(async () => {
  await resetAndMigrate();
  await company('Демо без реквизита');
  generic = await company('ГК', 'group');
  group = await company('Демо-Гамма', 'group');
  alpha = await company('Демо-Альфа Девелопмент');
  beta = await company('Демо-Бета Строй');
  await customerOf(beta, 'Демо-квартал Бета');
  for (const [id, inn] of [[alpha, '7700001228'], [beta, INN]] as const) {
    await pool().query(
      `INSERT INTO entity_identifiers (company_id, jurisdiction, identifier_type, value, validation_status, origin)
       VALUES ($1, 'RU', 'inn', $2, 'checksum_valid', 'manual')`,
      [id, inn],
    );
  }
});

afterAll(async () => {
  await closeDb();
});

describe('сайты компаний: очередь и поиск', () => {
  it('очередь: заказчик с ИНН первым, затем юрлицо с ИНН, затем группа; без реквизита — нет; общее название — пометка', async () => {
    const first = await claimSiteSearch();
    expect(first).toMatchObject({ companyId: beta, taxId: INN, isGroup: false, projects: ['Демо-квартал Бета'] });
    expect(await claimSiteSearch()).toMatchObject({ companyId: alpha, taxId: '7700001228' });
    expect(await claimSiteSearch()).toMatchObject({ companyId: group, isGroup: true, taxId: null });
    expect(await claimSiteSearch()).toBeNull();
    const marked = await pool().query<{ last_error: string; outcome: string }>('SELECT last_error, outcome FROM company_site_searches WHERE company_id = $1', [generic]);
    expect(marked.rows[0]).toEqual({ last_error: GENERIC_NAME_ERROR, outcome: 'none' });
    expect(await loadSearchTargetByTaxId(INN)).toMatchObject({ companyId: beta, name: 'Демо-Бета Строй' });
  });

  it('выдача: кандидаты ждут решения; повтор не трогает решение; одни отклонённые — не находка', async () => {
    expect(await save(beta, [site('beta.ru'), site('beta-stroy.ru')])).toEqual({ inserted: 2, outcome: 'found' });
    await rejectSiteCandidate(await candidateId(beta, 'beta-stroy.ru'), 'oper', 'другая компания');
    expect(await save(beta, [site('beta-stroy.ru')])).toEqual({ inserted: 0, outcome: 'none' });
    const state = (await pool().query<{ state: string }>(`SELECT state FROM company_site_candidates WHERE company_id = $1 AND host = 'beta-stroy.ru'`, [beta])).rows[0];
    expect(state?.state).toBe('rejected');
    // Пока есть ждущий решения кандидат, компания в очередь не встаёт даже после «Искать снова».
    expect(await requestSiteSearch(beta, 'oper')).toBe(true);
    expect(await claimSiteSearch()).toBeNull();
  });

  it('решения: «Это сайт компании» один раз; «Указать вручную» — сразу подтверждён; справочник — отказ', async () => {
    const id = await candidateId(beta, 'beta.ru');
    // 25B: подтверждённый сайт сразу становится источником чтения.
    expect(await confirmSiteCandidate(id, 'oper')).toEqual({ companyId: beta, host: 'beta.ru', sourceId: expect.any(Number) });
    await expect(confirmSiteCandidate(id, 'oper')).rejects.toMatchObject({ code: 'already_decided' });
    await expect(rejectSiteCandidate(999_999, 'oper', null)).rejects.toBeInstanceOf(CompanySiteError);
    const manual = await linkSiteManually(alpha, 'https://www.alpha-dev.ru/contacts', 'oper');
    expect(manual).toMatchObject({ companyId: alpha, host: 'alpha-dev.ru' });
    await expect(linkSiteManually(alpha, 'https://www.rusprofile.ru/id/1', 'oper')).rejects.toMatchObject({ code: 'invalid' });
    await expect(linkSiteManually(alpha, 'не адрес', 'oper')).rejects.toMatchObject({ code: 'invalid' });
    // Тот же хост у другой компании — подсказка оператору.
    await save(group, [site('beta.ru')]);
    const groupSites = await loadCompanySites(group);
    expect(groupSites.candidates[0]).toMatchObject({ host: 'beta.ru', state: 'pending', sharedWith: [{ companyId: beta, name: 'Демо-Бета Строй' }] });
  });

  it('проверка: сначала ждущие решения, отклонённые не проверяются; признаки записываются', async () => {
    const list = await uncheckedCandidates(10);
    expect(list[0]).toMatchObject({ host: 'beta.ru', companyName: 'Демо-Гамма' });
    expect(list.map(c => c.host)).not.toContain('beta-stroy.ru');
    const target = list.find(c => c.companyName === 'Демо-Бета Строй')!;
    expect(target.inn).toBe(INN);
    await saveSiteCheck(target.id, { status: 'ok', pageTitle: 'Бета', innOnPage: true, ogrnOnPage: null, nameOnPage: true, otherInns: ['7700001228'], error: null, pagesRead: 2 });
    const sites = await loadCompanySites(beta);
    expect(sites.candidates[0]).toMatchObject({ host: 'beta.ru', state: 'confirmed', checkStatus: 'ok', innOnPage: true, otherInns: ['7700001228'] });
    expect(sites.search).toMatchObject({ outcome: 'none', requestedBy: 'oper' });
  });

  it('лимит: место — до запроса; сверх предела отказ без записи', async () => {
    const used = await siteSearchUsedLastDay();
    const slot = await reserveSiteSearch({ companyId: beta, actor: 'test', model: 'm', maxResults: 5 }, used + 1);
    expect(slot.ok).toBe(true);
    if (slot.ok) await finishSiteSearch(slot.id, { outcome: 'found', citations: 3, accepted: 1, error: null });
    expect(await reserveSiteSearch({ companyId: beta, actor: 'test', model: 'm', maxResults: 5 }, used + 1)).toEqual({ ok: false, used: used + 1 });
    expect(await siteSearchUsedLastDay()).toBe(used + 1);
  });

  it('очередь «Сайты компаний»: фильтры и счётчики', async () => {
    const pending = await listCompanySites({ filter: 'pending' });
    expect(pending.items.map(i => i.companyId)).toEqual([group]);
    const confirmed = await listCompanySites({ filter: 'confirmed' });
    expect(confirmed.items.map(i => i.companyId).sort()).toEqual([alpha, beta].sort());
    expect(confirmed.totals).toMatchObject({ withPending: 1, confirmed: 2 });
    expect((await listCompanySites({ filter: 'all', q: 'бета' })).items.map(i => i.companyId)).toEqual([beta]);
  });

  it('слияние переносит кандидатов и поиск к цели; тот же сайт у цели — строка источника удаляется', async () => {
    const dup = await company('Демо-Бета Дубль');
    await save(dup, [site('beta.ru'), site('beta-dubl.ru')]);
    const versions = (await pool().query<{ id: number; version: number }>('SELECT id, version FROM companies WHERE id = ANY($1::bigint[])', [[dup, beta]])).rows;
    await applyEntityMerge({
      kind: 'company',
      sourceId: dup,
      targetId: beta,
      expectedSourceVersion: versions.find(v => v.id === dup)!.version,
      expectedTargetVersion: versions.find(v => v.id === beta)!.version,
      idempotencyKey: 'company-sites-merge-0001',
      actor: 'int-test',
    });
    const hosts = (await pool().query<{ host: string; state: string }>('SELECT host, state FROM company_site_candidates WHERE company_id = $1 ORDER BY host COLLATE "C"', [beta])).rows;
    expect(hosts).toEqual([
      { host: 'beta-dubl.ru', state: 'pending' },
      { host: 'beta-stroy.ru', state: 'rejected' },
      { host: 'beta.ru', state: 'confirmed' },
    ]);
    expect((await pool().query('SELECT 1 FROM company_site_candidates WHERE company_id = $1', [dup])).rowCount).toBe(0);
    expect((await pool().query('SELECT company_id FROM company_site_searches WHERE company_id = ANY($1::bigint[])', [[dup, beta]])).rows).toEqual([{ company_id: beta }]);
  });
});
