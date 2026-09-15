// Этап 07 на PostgreSQL: снимок сигналов на срез, drilldown совпадает с SQL, сбой пересчёта сохраняет
// прежний снимок, контекст объекта не приписывает участнику чужое событие. Данные синтетические;
// модель подменена шаблонными ответами extract@3.

import { afterAll, beforeAll, describe, it, expect } from 'vitest';

import { closeDb, getPool } from '../db/pool.js';
import { insertSyntheticSource, resetAndMigrate } from '../__tests__/integration/db.js';
import { startTestApi, type ITestApi } from '../__tests__/integration/http.js';
import { storeDocument } from '../ingest/store.js';
import type { ISemanticExtraction } from '../llm/semantic/schema.js';
import { publishCandidateSet } from '../reprocess/publish.js';
import { claimNextRun, enqueueRun, processRun } from '../reprocess/runs.js';
import { answer, company, event, project, relation, semanticProvider } from '../reprocess/semantic/__fixtures__/semanticAnswers.js';
import { refreshSignals } from './refresh.js';
import type { ICompanySignals } from './types.js';

let api: ITestApi;
const sources: number[] = [];
let counter = 0;
const pool = () => getPool();
const Y = new Date().getUTCFullYear();
// Прошлый месяц — заведомо внутри окна 12 месяцев при любом дне запуска; подпись месяца — в предложном падеже.
const PREV = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 15));
const MONTHS_IN = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
const PREV_TEXT = `в ${MONTHS_IN[PREV.getUTCMonth()]} ${PREV.getUTCFullYear()} года`;
const PREV_VALUE = `${PREV.getUTCFullYear()}-${String(PREV.getUTCMonth() + 1).padStart(2, '0')}`;

const ingest = async (sourceId: number, body: string, respond: ISemanticExtraction): Promise<number> => {
  counter += 1;
  const stored = await storeDocument({
    sourceId,
    sourceRunId: null,
    externalId: `synthetic_signals/${counter}`,
    url: null,
    title: null,
    body,
    publishedAt: new Date(),
    forwardFrom: null,
  });
  if (!stored.revisionId || !stored.sourceItemId) throw new Error(`редакция не создана: ${stored.outcome}`);
  const provider = semanticProvider(() => respond);
  const queued = await enqueueRun(pool(), { revisionId: stored.revisionId, provider, chunker: { chunkSize: 4000, maxChunks: 6, overlap: 50 }, requestedBy: 'test' });
  if (queued.outcome !== 'queued') throw new Error(`запуск не поставлен: ${queued.outcome}`);
  const run = await processRun(provider, (await claimNextRun('w-signals', { runId: queued.runId }))!);
  const published = await publishCandidateSet({ setId: run.candidateSetId!, expectedVersion: 0, actor: 'test' });
  expect(published.outcome).toBe('published');
  return stored.sourceItemId;
};

const idOf = async (table: 'companies' | 'projects', name: string): Promise<number> =>
  (await pool().query<{ id: number }>(`SELECT id FROM ${table} WHERE name = $1 AND merged_into_id IS NULL ORDER BY id LIMIT 1`, [name])).rows[0]!.id;

const signalsOf = async (companyId: number) => api.call('GET', `/api/companies/${companyId}/signals`, undefined, api.auth);

let cutoff = new Date();
let alfa = 0;
let empty = 0;
let firstRefresh = 0;

beforeAll(async () => {
  await resetAndMigrate();
  for (let i = 1; i <= 5; i += 1) {
    sources.push(await insertSyntheticSource({ kind: 'telegram', key: `synthetic_signals_${i}`, access: 'approved', ai: 'approved' }));
  }
  api = await startTestApi();

  // Участие с июня текущего года на корпусе 2; задержка 2024 года на корпусе 1 — событие объекта, без компании.
  const qPart = `Компания «Демо-Альфа» приступила к монтажу ВК корпуса 2 ЖК «Берег-Демо» в июне ${Y} года.`;
  const qDelay = `В 2024 году на корпусе 1 ЖК «Берег-Демо» произошла задержка строительства.`;
  await ingest(sources[0]!, `${qPart} ${qDelay}`, answer({
    companies: [company('Демо-Альфа', qPart)],
    projects: [project('Берег-Демо', qPart)],
    relations: [relation({ type: 'participation', kind: 'contractor', subject: 'Демо-Альфа', project: 'Берег-Демо', building: 'корпус 2', work_package: 'ВК', date_from: `${Y}-06`, date_precision: 'month', quote: qPart })],
    events: [event({ type: 'delay', project: 'Берег-Демо', building: 'корпус 1', date_from: '2024', date_precision: 'year', quote: qDelay })],
  }));

  // Пять перепечаток одного сообщения в пяти каналах.
  const qRepost = `«Демо-Альфа» завершила монтаж ВК корпуса 2 ЖК «Берег-Демо» ${PREV_TEXT}.`;
  for (const s of sources) {
    await ingest(s, qRepost, answer({
      companies: [company('Демо-Альфа', qRepost)],
      projects: [project('Берег-Демо', qRepost)],
      events: [event({ type: 'milestone', subject: 'Демо-Альфа', project: 'Берег-Демо', building: 'корпус 2', date_from: PREV_VALUE, date_precision: 'month', quote: qRepost })],
    }));
  }

  // Старое событие без даты в свежей публикации; иск, где компания — истец.
  const qOld = '«Демо-Альфа» когда-то задержала сдачу объекта, точная дата не указана.';
  const qCourt = '«Демо-Альфа» подала иск к «Демо-Бета» о взыскании 12 млн рублей.';
  await ingest(sources[1]!, `${qOld} ${qCourt}`, answer({
    companies: [company('Демо-Альфа', qOld), company('Демо-Бета', qCourt)],
    events: [
      event({ type: 'delay', subject: 'Демо-Альфа', quote: qOld }),
      event({ type: 'court_case', subject: 'Демо-Альфа', counterparty: 'Демо-Бета', subject_role: 'plaintiff', counterparty_role: 'defendant', stage: 'claim_filed', amount: '12000000', currency: 'RUB', amount_purpose: 'claim', quote: qCourt }),
    ],
  }));

  empty = (
    await pool().query<{ id: number }>(`INSERT INTO companies (name, name_norm, name_latin) VALUES ('Демо-Пусто', 'демо-пусто', 'demo-pusto') RETURNING id`)
  ).rows[0]!.id;
  alfa = await idOf('companies', 'Демо-Альфа');
  cutoff = new Date(Date.now() + 1000);
});

afterAll(async () => {
  await api.close();
  await closeDb();
});

describe('снимок сигналов на срез', () => {
  it('пересчёт успешен; карточка отдаёт срез, версию правил и не отдаёт старый индекс риска', async () => {
    const result = await refreshSignals({ cutoff, requestedBy: 'test' });
    expect(result.outcome).toBe('succeeded');
    firstRefresh = result.outcome === 'succeeded' ? result.refreshId : 0;

    const res = await signalsOf(alfa);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', refresh: { active: { id: firstRefresh, rulesVersion: 'signals@1', cutoffAt: cutoff.toISOString() }, stale: false } });

    const card = await api.call('GET', `/api/companies/${alfa}`, undefined, api.auth);
    expect(card.body).not.toHaveProperty('risk');
    const legacy = await api.call('GET', `/api/companies/${alfa}/legacy-risk`, undefined, api.auth);
    expect(legacy.headers.deprecation).toBe('true');
    expect(legacy.body.deprecated).toBe(true);
  });

  it('TC-060 / TC-062: событие без даты не в окне; пять перепечаток — пять публикаций, одна семья, одно событие', async () => {
    const s = (await signalsOf(alfa)).body.signals as ICompanySignals;
    const milestone = s.media.events.find(e => e.type === 'milestone')!;
    expect(milestone).toMatchObject({ publications: 5, families: 1, dateStatus: expect.stringMatching(/in_window|boundary/) });
    expect(s.media.events.filter(e => e.type === 'milestone')).toHaveLength(1);
    expect(s.media.familiesByOrigin.established.value).toBe(0);

    const undated = s.media.events.find(e => e.type === 'delay')!;
    expect(undated.dateStatus).toBe('undated');
    expect(s.media.eventsDated12m.ids).not.toContain(undated.assertionId);
    expect(s.media.eventsUndatedPublished90d.ids).toContain(undated.assertionId);
    // Задержка объекта без названной компании не стала событием компании.
    expect(s.media.events.map(e => e.type).sort()).toEqual(['court_case', 'delay', 'milestone']);
    expect(s.media.courtRoles).toMatchObject({ plaintiff: 1, defendant: 0 });
  });

  it('drilldown: id публикаций и объектов совпадают с запросом к базе', async () => {
    const s = (await signalsOf(alfa)).body.signals as ICompanySignals;
    const items = (
      await pool().query<{ id: number }>(
        `SELECT DISTINCT r.source_item_id AS id FROM assertions a
         JOIN evidence e ON e.assertion_id = a.id AND e.status = 'active'
         JOIN document_revisions r ON r.id = e.revision_id
         WHERE $1 IN (a.subject_company_id, a.object_company_id, a.counterparty_company_id) ORDER BY 1`,
        [alfa],
      )
    ).rows.map(r => r.id);
    expect(s.media.publications).toMatchObject({ value: items.length, ids: items });
    expect(s.experience.projects.ids).toEqual([await idOf('projects', 'Берег-Демо')]);
    expect(s.experience.participations[0]).toMatchObject({ building: 'корпус 2', workPackage: 'ВК', validFrom: `${Y}-06-01`, periodPrecision: 'month' });
  });

  it('TC-063: компания без публикаций — недостаточно данных', async () => {
    const s = (await signalsOf(empty)).body.signals as ICompanySignals;
    expect(s.media.publications).toMatchObject({ value: null, status: 'insufficient_data' });
    expect(s.media.reviewedShare).toMatchObject({ value: null, status: 'insufficient_data' });
    expect(s.media.note).toContain('не найдено');
  });

  it('TC-061: контекст объекта — задержка 2024 года на другом корпусе не пересекается с участием', async () => {
    const projectId = await idOf('projects', 'Берег-Демо');
    const res = await api.call('GET', `/api/companies/${alfa}/context?projectId=${projectId}`, undefined, api.auth);
    expect(res.status).toBe(200);
    const delay = (res.body.projectEvents as Array<Record<string, unknown>>).find(e => e.type === 'delay');
    expect(delay).toMatchObject({ overlap: 'no_overlap', sameBuilding: false, namesCompany: false });
  });

  it('список подрядчиков читает снимок: без индекса риска и сортировки по нему', async () => {
    const res = await api.call('GET', '/api/contractors?role=contractor', undefined, api.auth);
    expect(res.status).toBe(200);
    const items = res.body.items as Array<Record<string, unknown>>;
    expect(items.map(i => i.companyId)).toEqual([alfa]);
    expect(items[0]).not.toHaveProperty('riskScore');
    expect(items[0]).toMatchObject({ projects: 1, publications: expect.any(Number) });
    expect((await api.call('GET', '/api/contractors?sort=risk', undefined, api.auth)).status).toBe(400);
    const all = await api.call('GET', '/api/contractors?includeInsufficient=true&sort=name', undefined, api.auth);
    expect((all.body.items as Array<{ companyId: number }>).map(i => i.companyId)).toContain(empty);
  });
});

describe('TC-064: сбой пересчёта и детерминизм', () => {
  it('сбой не стирает снимок: читается прежний, помечен устаревшим с причиной', async () => {
    const failed = await refreshSignals({
      cutoff: new Date(),
      beforeCommit: async () => {
        throw new Error('имитация сбоя пересчёта');
      },
    });
    expect(failed.outcome).toBe('failed');
    const res = await signalsOf(alfa);
    expect(res.body).toMatchObject({ status: 'ok', refresh: { active: { id: firstRefresh }, stale: true, lastFailure: { error: 'имитация сбоя пересчёта' } } });
    expect((res.body.signals as ICompanySignals).media.events.length).toBeGreaterThan(0);
    const rows = await pool().query('SELECT 1 FROM company_signal_snapshots WHERE refresh_id = $1', [failed.outcome === 'failed' ? failed.refreshId : 0]);
    expect(rows.rowCount).toBe(0);
  });

  it('повтор на тот же срез даёт тот же снимок', async () => {
    const again = await refreshSignals({ cutoff });
    expect(again.outcome).toBe('succeeded');
    const payloads = (
      await pool().query<{ refresh_id: number; payload: unknown }>(
        'SELECT refresh_id, payload FROM company_signal_snapshots WHERE company_id = $1 AND refresh_id IN ($2, $3)',
        [alfa, firstRefresh, again.outcome === 'succeeded' ? again.refreshId : 0],
      )
    ).rows;
    expect(payloads).toHaveLength(2);
    expect(JSON.stringify(payloads[0]!.payload)).toBe(JSON.stringify(payloads[1]!.payload));
    expect((await signalsOf(alfa)).body.refresh).toMatchObject({ stale: false, lastFailure: null });
  });
});
