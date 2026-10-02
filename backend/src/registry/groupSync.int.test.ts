// Сверка «застройщик входит в группу» на PostgreSQL (ADR-012 п. 33): случай «Донстроя».
//
// Группа ДОМ.РФ — страница без реквизитов. Связь СЗ с группой пишется к компании, подтверждённой для
// страницы группы, а не к одноимённой; подтверждение сменилось — связь переезжает: прежняя снимается
// (доказательство реестра → superseded), новая пишется с цитатой из того же снимка застройщика.
// Группа ни за кем не подтверждена — связи нет, а не угаданная по названию. Данные синтетические, сети нет.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDb, getPool, withTransaction } from '../db/pool.js';
import { insertSyntheticSource, resetAndMigrate } from '../__tests__/integration/db.js';
import { domRfCardUrl, parseDomRfCardCapture, saveScannedDomRfCard } from '../ingest/registry/domrfCards.js';
import { importRegistryPayload } from '../ingest/registry/importFile.js';
import { getSourceById, setSourceConfig } from '../ingest/sources.js';
import { syncDomRfGroupRelations } from './groupSync.js';

const DEV_INN = '7704412966';

const card = parseDomRfCardCapture({
  format: 'domrf-card-browser@1',
  url: domRfCardUrl('developer', '14929'),
  kind: 'developer',
  externalRef: '14929',
  title: 'ООО СЗ ДЕМО-ПРАКТИКА',
  documentTitle: 'ООО СЗ ДЕМО-ПРАКТИКА',
  inn: DEV_INN,
  kpp: null,
  ogrn: null,
  legalAddress: 'г. Москва',
  groupRef: '5661',
  groupName: 'ДЕМОСТРОЙ',
  objects: [],
});

const company = async (name: string, entityType = 'legal_entity'): Promise<number> =>
  (
    await getPool().query<{ id: number }>(
      `INSERT INTO companies (name, name_norm, name_latin, entity_type) VALUES ($1, lower($1), lower($1), $2) RETURNING id`,
      [name, entityType],
    )
  ).rows[0]!.id;

const confirmGroup = async (companyId: number): Promise<void> => {
  await getPool().query(`UPDATE domrf_company_links SET state = 'rejected', decided_by = 't', decided_at = now() WHERE kind = 'group' AND external_ref = '5661'`);
  await getPool().query(
    `INSERT INTO domrf_company_links (company_id, kind, external_ref, name, found_by, state, decided_by, decided_at)
     VALUES ($1, 'group', '5661', 'ДЕМОСТРОЙ', 'name', 'confirmed', 't', now())
     ON CONFLICT (company_id, kind, external_ref) DO UPDATE SET state = 'confirmed', decided_at = now()`,
    [companyId],
  );
};

/** Группы застройщика с действующим подтверждающим доказательством. */
const activeGroups = async (): Promise<number[]> =>
  (
    await getPool().query<{ object_company_id: number }>(
      `SELECT DISTINCT a.object_company_id FROM assertions a
       JOIN evidence e ON e.assertion_id = a.id AND e.status = 'active' AND e.stance = 'supports'
       JOIN entity_identifiers ei ON ei.company_id = a.subject_company_id AND ei.identifier_type = 'inn' AND ei.value = $1
       WHERE a.predicate = 'corporate_relation' AND a.role = 'member_of_group' AND a.origin = 'registry'
       ORDER BY 1`,
      [DEV_INN],
    )
  ).rows.map(r => r.object_company_id);

let sourceId = 0;

beforeAll(async () => {
  await resetAndMigrate();
  sourceId = await insertSyntheticSource({ kind: 'website', key: 'registry-groups-demo.test', access: 'approved', baseUrl: 'https://registry-groups-demo.test' });
  await setSourceConfig(sourceId, { mode: 'registry_api', endpoints: { object: 'https://registry-groups-demo.test/api/object?id={id}' }, objectIds: [], identity: { object: { idPath: 'id', namePath: 'name' } }, fields: { object: [] }, limits: { delayMs: 0 } });
  await withTransaction(client => saveScannedDomRfCard(client, card));
});

afterAll(async () => {
  await closeDb();
});

describe('связь СЗ с группой ДОМ.РФ — по подтверждённой странице группы', () => {
  it('группа ни за кем не подтверждена — связи нет, хотя одноимённая компания есть', async () => {
    await company('ДЕМОСТРОЙ', 'unknown');
    const imported = await importRegistryPayload((await getSourceById(sourceId))!, card);
    expect(imported.kind).toBe('stored');
    expect(await activeGroups()).toEqual([]);
    expect(await syncDomRfGroupRelations()).toEqual({ linked: 0, withdrawn: 0 });
  });

  it('подтвердили группу за компанией — сверка пишет связь; повтор ничего не меняет', async () => {
    const first = await company('Демострой АО');
    await confirmGroup(first);
    expect(await syncDomRfGroupRelations()).toEqual({ linked: 1, withdrawn: 0 });
    expect(await activeGroups()).toEqual([first]);
    expect(await syncDomRfGroupRelations()).toEqual({ linked: 0, withdrawn: 0 });
  });

  it('подтверждение сменилось — связь переезжает: прежняя снята, новая записана', async () => {
    const before = await activeGroups();
    const second = await company('Демострой Групп');
    await confirmGroup(second);
    expect(await syncDomRfGroupRelations()).toEqual({ linked: 1, withdrawn: 1 });
    expect(await activeGroups()).toEqual([second]);
    expect(before).not.toContain(second);
    const superseded = await getPool().query(
      `SELECT 1 FROM evidence e JOIN assertions a ON a.id = e.assertion_id
       WHERE a.role = 'member_of_group' AND a.object_company_id = $1 AND e.status = 'superseded'`,
      [before[0]],
    );
    expect(superseded.rowCount).toBe(1);
  });

  it('группу отклонили для компании и ни за кем не подтвердили — связь с ней снимается', async () => {
    const [current] = await activeGroups();
    await getPool().query(
      `UPDATE domrf_company_links SET state = 'rejected', decided_by = 'model:test', decided_at = now()
       WHERE kind = 'group' AND external_ref = '5661' AND company_id = $1`,
      [current],
    );
    expect(await syncDomRfGroupRelations()).toEqual({ linked: 0, withdrawn: 1 });
    expect(await activeGroups()).toEqual([]);
  });
});
