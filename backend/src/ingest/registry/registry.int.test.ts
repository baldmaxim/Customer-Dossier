// Этап 20A на PostgreSQL: источник-реестр через настоящие сервисы хранения.
// Сеть подменена внедрённым транспортом (setSiteTransportForTests): проверки адресов,
// редиректов и размера остаются в safeFetch. Реестр и записи синтетические, домены *.test.

import { afterAll, afterEach, beforeAll, describe, it, expect } from 'vitest';

import { closeDb, getPool } from '../../db/pool.js';
import { insertSyntheticSource, resetAndMigrate } from '../../__tests__/integration/db.js';
import type { SafeTransport } from '../../net/safeFetch.js';
import { ingestWebsiteSource } from '../scheduler.js';
import { getSourceById, setSourceConfig } from '../sources.js';
import { setSiteTransportForTests } from '../sites/fetcher.js';
import { probeWebsiteSource } from '../sites/probe.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { importRegistryFile } from './importFile.js';
import { loadProjectRegistry } from '../../registry/read.js';

type Route = (headers: Record<string, string>) => { status: number; headers?: Record<string, string>; body?: string };

let routes = new Map<string, Route>();
const calls: string[] = [];
const transport: SafeTransport = async (url, request) => {
  calls.push(url.toString());
  const route = routes.get(url.toString());
  if (!route) return { status: 404, headers: {}, body: Buffer.from('not found') };
  const res = route(request.headers ?? {});
  return {
    status: res.status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...(res.headers ?? {}) },
    body: Buffer.from(res.body ?? '', 'utf8'),
  };
};
const json = (value: unknown): Route => () => ({ status: 200, body: JSON.stringify(value) });

const pool = () => getPool();
let hostCounter = 0;

const objectAnswer = (over: Record<string, unknown> = {}) => ({
  objId: 62087,
  objCommercNm: 'Демо-Татарская 35',
  city: 'Москва',
  objAddr: 'Москва город, Район Замоскворечье',
  groupName: 'Демо-Строй',
  developer: { shortName: 'СЗ ДЕМО-ПРАКТИКА', devInn: '7704412966', orgForm: { shortForm: 'ООО' } },
  objReadyDt: '2028-09-30',
  objFloorMax: 26,
  objElemLivingCnt: 472,
  ...over,
});

const registryProfile = (over: Record<string, unknown> = {}, host = 'registry-demo.test') => ({
  mode: 'registry_api',
  endpoints: { object: `https://${host}/api/object?id={id}` },
  objectIds: ['62087'],
  identity: {
    object: {
      idPath: 'objId',
      namePath: 'objCommercNm',
      cityPath: 'city',
      addressPath: 'objAddr',
      developerNamePath: 'developer.shortName',
      developerFormPath: 'developer.orgForm.shortForm',
      developerInnPath: 'developer.devInn',
      groupNamePath: 'groupName',
    },
  },
  fields: {
    object: [
      { label: 'Срок сдачи', path: 'objReadyDt', format: 'date' },
      { label: 'Количество этажей', path: 'objFloorMax', format: 'number' },
      { label: 'Количество квартир', path: 'objElemLivingCnt', format: 'number' },
    ],
  },
  limits: { delayMs: 0 },
  ...over,
});

const registry = async (profile: Record<string, unknown>, hostOverride?: string) => {
  hostCounter += 1;
  const host = hostOverride ?? `registry${hostCounter}-demo.test`;
  const id = await insertSyntheticSource({ kind: 'website', key: host, access: 'approved', baseUrl: `https://${host}` });
  await setSourceConfig(id, profile);
  return { id, host, url: (path: string) => `https://${host}${path}` };
};

const run = async (id: number) => ingestWebsiteSource((await getSourceById(id))!);

const lastRun = async (sourceId: number) =>
  (
    await pool().query<{
      outcome: string;
      items_found: number;
      items_saved: number;
      items_changed: number;
      items_skipped: number;
      items_failed: number;
      coverage: Record<string, unknown>;
      parser_version: string;
      retry_after_at: Date | null;
    }>(
      `SELECT outcome, items_found, items_saved, items_changed, items_skipped, items_failed, coverage, parser_version, retry_after_at
       FROM source_runs WHERE source_id = $1 ORDER BY id DESC LIMIT 1`,
      [sourceId],
    )
  ).rows[0]!;

const revisions = async (sourceId: number) =>
  (
    await pool().query<{ item_key: string; revision_no: number; body: string; completeness: string; body_representation: string; published_at_precision: string | null }>(
      `SELECT i.item_key, r.revision_no, r.body, r.completeness::text AS completeness, r.body_representation, r.published_at_precision
       FROM document_revisions r JOIN source_items i ON i.id = r.source_item_id
       WHERE i.source_id = $1 ORDER BY i.item_key, r.revision_no`,
      [sourceId],
    )
  ).rows;

const records = async (sourceId: number) =>
  (
    await pool().query<{ item_key: string; record_type: string; external_ref: string; as_of: string | null; payload: Record<string, any>; render_version: string; revision_id: string }>(
      `SELECT item_key, record_type, external_ref, as_of, payload, render_version, revision_id
       FROM registry_records WHERE source_id = $1 ORDER BY id`,
      [sourceId],
    )
  ).rows;

beforeAll(async () => {
  await resetAndMigrate();
  setSiteTransportForTests(transport);
});

afterEach(() => {
  routes = new Map();
  calls.length = 0;
});

afterAll(async () => {
  setSiteTransportForTests(undefined);
  await closeDb();
});

// ---------------------------------------------------------------------------

describe('реестр: снимок, повтор без изменений, изменение поля (T20A-04)', () => {
  it('первый сбор пишет редакцию и снимок; повтор — наблюдение; правка — новая редакция и новый снимок', async () => {
    const s = await registry(registryProfile({ endpoints: { object: 'https://registry-a-demo.test/api/object?id={id}' } }, 'registry-a-demo.test'), 'registry-a-demo.test');
    routes.set(s.url('/api/object?id=62087'), json(objectAnswer()));

    const first = await run(s.id);
    expect(first.ok).toBe(true);
    const rev1 = await revisions(s.id);
    expect(rev1).toHaveLength(1);
    expect(rev1[0]!.item_key).toBe('ext:object:62087');
    expect(rev1[0]!.body_representation).toBe('registry_object@1');
    expect(rev1[0]!.completeness).toBe('full');
    expect(rev1[0]!.body).toContain('Застройщик объекта «Демо-Татарская 35» — ООО СЗ ДЕМО-ПРАКТИКА, ИНН 7704412966.');
    expect(rev1[0]!.body).toContain('Срок сдачи: 30.09.2028');

    const snap1 = await records(s.id);
    expect(snap1).toHaveLength(1);
    expect(snap1[0]!).toMatchObject({ record_type: 'object', external_ref: '62087', render_version: 'registry-render@1' });
    expect(snap1[0]!.payload.identity.developer.inn).toBe('7704412966');
    expect(snap1[0]!.as_of).toBeNull();

    // Повтор тех же данных: ни новой редакции, ни нового снимка.
    await run(s.id);
    expect(await revisions(s.id)).toHaveLength(1);
    expect(await records(s.id)).toHaveLength(1);
    expect((await lastRun(s.id)).items_skipped).toBe(1);

    // Перенос срока сдачи — именно то, ради чего реестр перечитывается.
    routes.set(s.url('/api/object?id=62087'), json(objectAnswer({ objReadyDt: '2029-03-31' })));
    await run(s.id);
    const rev2 = await revisions(s.id);
    expect(rev2).toHaveLength(2);
    expect(rev2[1]!.revision_no).toBe(2);
    expect(rev2[1]!.body).toContain('Срок сдачи: 31.03.2029');
    const snap2 = await records(s.id);
    expect(snap2).toHaveLength(2);
    expect(snap2[1]!.payload.fields.find((f: { label: string }) => f.label === 'Срок сдачи').value).toBe('31.03.2029');
    expect((await lastRun(s.id)).items_changed).toBe(1);
  });

  it('дата сведений берётся из реестра и становится датой публикации редакции', async () => {
    const profile = registryProfile({ endpoints: { object: 'https://registry-b-demo.test/api/object?id={id}' } }, 'registry-b-demo.test');
    (profile.identity as any).object.asOfPath = 'asOf';
    const s = await registry(profile, 'registry-b-demo.test');
    routes.set(s.url('/api/object?id=62087'), json(objectAnswer({ asOf: '2026-09-21' })));
    await run(s.id);
    const rev = await revisions(s.id);
    expect(rev[0]!.body).toContain('Сведения реестра на 21.09.2026');
    expect(rev[0]!.published_at_precision).toBe('date_only');
    // DATE приходит строкой: сутки не уезжают по часовому поясу машины.
    expect((await records(s.id))[0]!.as_of).toBe('2026-09-21');
    const view = await loadProjectRegistry(getPool(), (await pool().query<{ project_id: number }>('SELECT project_id FROM registry_records WHERE source_id = $1', [s.id])).rows[0]!.project_id);
    expect(view!.asOf).toBe('2026-09-21');
    expect(view!.attribution).toContain('проектная декларация застройщика');
  });
});

describe('реестр: обход каталога и отказы источника (T20A-05)', () => {
  it('403 — blocked без записей, 429 — rate_limited с паузой, не «в реестре ничего нет»', async () => {
    const s = await registry(registryProfile({ endpoints: { object: 'https://registry-d-demo.test/api/object?id={id}' } }, 'registry-d-demo.test'), 'registry-d-demo.test');
    routes.set(s.url('/api/object?id=62087'), () => ({ status: 403, body: 'forbidden' }));
    await run(s.id);
    expect((await lastRun(s.id)).outcome).toBe('blocked');
    expect(await revisions(s.id)).toHaveLength(0);

    routes.set(s.url('/api/object?id=62087'), () => ({ status: 429, headers: { 'retry-after': '120' }, body: 'slow down' }));
    await run(s.id);
    const rateLimited = await lastRun(s.id);
    expect(rateLimited.outcome).toBe('rate_limited');
    expect(rateLimited.retry_after_at).not.toBeNull();
  });

  it('ответ не JSON — parser_degraded, а не пустой реестр', async () => {
    const s = await registry(registryProfile({ endpoints: { object: 'https://registry-e-demo.test/api/object?id={id}' } }, 'registry-e-demo.test'), 'registry-e-demo.test');
    routes.set(s.url('/api/object?id=62087'), () => ({ status: 200, headers: { 'content-type': 'text/html' }, body: '<html>капча</html>' }));
    await run(s.id);
    const runRow = await lastRun(s.id);
    expect(runRow.outcome).toBe('parser_degraded');
    expect(await revisions(s.id)).toHaveLength(0);
    expect(await records(s.id)).toHaveLength(0);
  });

  it('неизвестный профиль отвергается до запроса', async () => {
    const s = await registry({ mode: 'registry_api', endpoints: { object: 'https://registry-f-demo.test/api/object?id={id}' } }, 'registry-f-demo.test');
    await run(s.id);
    expect((await lastRun(s.id)).outcome).toBe('config_invalid');
    expect(calls).toHaveLength(0);
  });
});

describe('проба реестра ничего не пишет (T20A-06)', () => {
  it('та же команда и та же кнопка, что у сайта: исход есть, записей нет', async () => {
    const s = await registry(registryProfile({ endpoints: { object: 'https://registry-g-demo.test/api/object?id={id}' } }, 'registry-g-demo.test'), 'registry-g-demo.test');
    routes.set(s.url('/api/object?id=62087'), json(objectAnswer()));
    const report = await probeWebsiteSource((await getSourceById(s.id))!);
    expect(report.outcome).toBe('ok');
    expect(report.samples[0]!.title).toBe('Демо-Татарская 35');
    expect(await revisions(s.id)).toHaveLength(0);
    expect(await records(s.id)).toHaveLength(0);
    expect((await pool().query('SELECT count(*)::int AS n FROM http_cache WHERE source_id = $1', [s.id])).rows[0]!.n).toBe(0);
  });
});

/** Утверждения, опирающиеся на редакции именно этого источника: база общая для файла. */
const canonCount = async (sourceId: number, where = 'true') =>
  (
    await pool().query<{ n: number }>(
      `SELECT count(*)::int AS n FROM assertions a
       WHERE ${where} AND EXISTS (
         SELECT 1 FROM evidence e
         JOIN document_revisions r ON r.id = e.revision_id
         JOIN source_items i ON i.id = r.source_item_id
         WHERE e.assertion_id = a.id AND i.source_id = $1)`,
      [sourceId],
    )
  ).rows[0]!.n;

describe('реестр: детерминированная запись в канон (T20B-02)', () => {
  it('объект, юрлицо с ИНН, роль застройщика и группа — с цитатой из той же редакции', async () => {
    const s = await registry(registryProfile({ endpoints: { object: 'https://registry-h-demo.test/api/object?id={id}' } }, 'registry-h-demo.test'), 'registry-h-demo.test');
    const answer = objectAnswer({
      objId: 80001,
      objCommercNm: 'Демо-Канон 35',
      groupName: 'Канон-Строй',
      developer: { shortName: 'СЗ КАНОН-ПРАКТИКА', devInn: '7736050003', orgForm: { shortForm: 'ООО' } },
    });
    routes.set(s.url('/api/object?id=62087'), json(answer));
    await run(s.id);

    // Компания найдена по реквизиту, происхождение — реестр, а не разбор модели.
    const ident = (
      await pool().query<{ value: string; origin: string; identifier_type: string }>(
        `SELECT value, origin, identifier_type FROM entity_identifiers WHERE value = '7736050003' AND status = 'active'`,
      )
    ).rows;
    expect(ident).toHaveLength(1);
    expect(ident[0]!).toMatchObject({ origin: 'registry', identifier_type: 'inn' });

    // Утверждение о роли застройщика — с происхождением registry и ролью developer.
    const participation = (
      await pool().query<{ id: number; role: string; origin: string; modality: string; polarity: string; status: string }>(
        `SELECT a.id, a.role, a.origin, a.modality::text AS modality, a.polarity, a.status::text AS status
         FROM assertions a
         WHERE a.predicate = 'participates_in_project' AND EXISTS (
           SELECT 1 FROM evidence e JOIN document_revisions r ON r.id = e.revision_id
           JOIN source_items i ON i.id = r.source_item_id
           WHERE e.assertion_id = a.id AND i.source_id = $1)`,
        [s.id],
      )
    ).rows;
    expect(participation).toHaveLength(1);
    expect(participation[0]!).toMatchObject({ role: 'developer', origin: 'registry', modality: 'reported_fact', polarity: 'positive' });
    // Без решения аналитика статус — «так написано», не «проверено».
    expect(participation[0]!.status).toBe('text_grounded');

    // Цитата — целая строка редакции; совпадение с фрагментом проверяет сама база.
    const evidence = (
      await pool().query<{ quote: string; origin: string; stance: string }>(
        `SELECT quote, origin, stance::text AS stance FROM evidence WHERE assertion_id = $1`,
        [participation[0]!.id],
      )
    ).rows;
    expect(evidence).toHaveLength(1);
    expect(evidence[0]!.quote).toBe('Застройщик объекта «Демо-Канон 35» — ООО СЗ КАНОН-ПРАКТИКА, ИНН 7736050003.');
    expect(evidence[0]!).toMatchObject({ origin: 'registry', stance: 'supports' });

    // Группа компаний — отдельная корпоративная связь, а не поле объекта.
    expect(await canonCount(s.id, `a.predicate = 'corporate_relation' AND a.role = 'member_of_group'`)).toBe(1);

    // Снимок привязан к канону.
    const linked = (
      await pool().query<{ project_id: number | null; company_id: number | null }>(
        'SELECT project_id, company_id FROM registry_records WHERE source_id = $1',
        [s.id],
      )
    ).rows[0]!;
    expect(linked.project_id).not.toBeNull();
    expect(linked.company_id).not.toBeNull();

    // Повтор без изменений новой редакции не даёт, значит и утверждений не прибавляет.
    await run(s.id);
    expect(await canonCount(s.id)).toBe(2);
  });

  it('в канон идёт только неизменчивое: срок сдачи остаётся снимком, а не утверждением', async () => {
    const s = await registry(registryProfile({ endpoints: { object: 'https://registry-i-demo.test/api/object?id={id}' } }, 'registry-i-demo.test'), 'registry-i-demo.test');
    const base = {
      objId: 70001,
      objCommercNm: 'Демо-Сроки',
      groupName: null,
      developer: { shortName: 'СЗ СРОКИ', devInn: '7810186540', orgForm: { shortForm: 'ООО' } },
    };
    routes.set(s.url('/api/object?id=62087'), json(objectAnswer(base)));
    await run(s.id);
    routes.set(s.url('/api/object?id=62087'), json(objectAnswer({ ...base, objReadyDt: '2029-03-31' })));
    await run(s.id);

    // Две редакции и два снимка — но ни одного утверждения про срок, сумму или событие.
    expect(await revisions(s.id)).toHaveLength(2);
    expect(await records(s.id)).toHaveLength(2);
    expect(await canonCount(s.id, `(a.event_type IS NOT NULL OR a.valid_from IS NOT NULL OR a.value_numeric IS NOT NULL)`)).toBe(0);
    // Роль застройщика при этом записана один раз, а не по разу на снимок.
    expect(await canonCount(s.id, `a.predicate = 'participates_in_project'`)).toBe(1);
  });
});

describe('импорт файла без сети (T20C-02)', () => {
  it('сохранённый оператором ответ даёт ту же редакцию, снимок и канон, что и сбор', async () => {
    const s = await registry(registryProfile({ endpoints: { object: 'https://registry-j-demo.test/api/object?id={id}' } }, 'registry-j-demo.test'), 'registry-j-demo.test');
    const file = path.join(os.tmpdir(), `registry-import-${Date.now()}.json`);
    const answer = objectAnswer({
      objId: 90001,
      objCommercNm: 'Демо-Импорт 7',
      groupName: null,
      developer: { shortName: 'СЗ ИМПОРТ', devInn: '7810186540', orgForm: { shortForm: 'ООО' } },
    });
    fs.writeFileSync(file, JSON.stringify(answer), 'utf8');
    try {
      const first = await importRegistryFile((await getSourceById(s.id))!, file, { type: 'object' });
      expect(first.kind).toBe('stored');
      if (first.kind !== 'stored') return;
      expect(first.outcome).toBe('inserted');
      expect(first.externalRef).toBe('90001');
      // Ни одного сетевого запроса: файл читается с диска.
      expect(calls).toHaveLength(0);

      const rows = await revisions(s.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.item_key).toBe('ext:object:90001');
      expect(rows[0]!.body).toContain('Застройщик объекта «Демо-Импорт 7» — ООО СЗ ИМПОРТ, ИНН 7810186540.');
      expect(await records(s.id)).toHaveLength(1);
      expect(first.assertions).toBe(1);

      // Повтор того же файла — наблюдение, не новая редакция и не новые утверждения.
      const again = await importRegistryFile((await getSourceById(s.id))!, file, { type: 'object' });
      expect(again.kind === 'stored' && again.outcome).toBe('unchanged');
      expect(await revisions(s.id)).toHaveLength(1);
      expect(await records(s.id)).toHaveLength(1);

      // Изменённый файл — новая редакция и новый снимок.
      fs.writeFileSync(file, JSON.stringify({ ...answer, objReadyDt: '2029-03-31' }), 'utf8');
      const changed = await importRegistryFile((await getSourceById(s.id))!, file, { type: 'object' });
      expect(changed.kind === 'stored' && changed.outcome).toBe('new_revision');
      expect(await revisions(s.id)).toHaveLength(2);
      expect(await records(s.id)).toHaveLength(2);
    } finally {
      fs.rmSync(file, { force: true });
    }
  });

  it('несовпавшая карта полей возвращает пути ответа, а не пустой результат', async () => {
    const s = await registry(registryProfile({ endpoints: { object: 'https://registry-k-demo.test/api/object?id={id}' } }, 'registry-k-demo.test'), 'registry-k-demo.test');
    const file = path.join(os.tmpdir(), `registry-unmapped-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify({ data: { id: 1, title: 'другая форма ответа' } }), 'utf8');
    try {
      const result = await importRegistryFile((await getSourceById(s.id))!, file, { type: 'object' });
      expect(result.kind).toBe('unmapped');
      if (result.kind !== 'unmapped') return;
      expect(result.availablePaths).toContain('data.id');
      expect(result.availablePaths).toContain('data.title');
      expect(await revisions(s.id)).toHaveLength(0);
    } finally {
      fs.rmSync(file, { force: true });
    }
  });
});
