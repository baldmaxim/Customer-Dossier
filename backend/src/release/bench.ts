// Замеры локальной установки (этап 09): сколько на самом деле занимают поиск, карточка, досье,
// ограниченная схема связей, создание снимка и выгрузка на текущем объёме тестовой базы.
//
// Это измерение, а не обещание. Числа имеют смысл только вместе с описанием машины и объёма данных,
// которые печатаются рядом. Сеть и модель не вызываются.
//
// Выборка засчитывается во время только при ожидаемом HTTP-коде И ожидаемом содержимом ответа:
// быстрый 400/401 или пустое досье — ошибка шага, а не хорошее время. Обязательный шаг без успешных
// выборок делает отчёт недействительным (valid=false, exit 1). Прогрев — отдельная выборка, в статистику не входит.
//
// Харнесс: приложение (настоящие createApp, вход оператора, CSRF и маршруты) на 127.0.0.1 в том же
// процессе Node, что и замер. Цель проверяется общим preflight до вызова runBench (benchCli.ts).

import { performance } from 'node:perf_hooks';
import os from 'node:os';

import type { DbExecutor } from '../db/pool.js';
import { startTestApi, type ITestApi, type ITestResponse } from '../__tests__/integration/http.js';
import type { IQueryProfiler, IStepQueryProfile } from './queryProfile.js';

export const BENCH_VERSION = 'local-bench@2';

/** Результат одной выборки: успех только при ожидаемом статусе и содержимом. */
export interface ISample {
  ok: boolean;
  status: number;
  /** Причина неуспеха или краткая характеристика ответа (без содержимого публикаций). */
  detail: string;
}

export interface IBenchStep {
  code: string;
  title: string;
  required: boolean;
  requested: number;
  successes: number;
  warmup: ISample;
  errors: ISample[];
  /** Миллисекунды, только по успешным выборкам; null — успешных выборок нет. */
  min: number | null;
  median: number | null;
  max: number | null;
  /** 95-й перцентиль — только при 20 и более успешных выборках (иначе null: малая выборка его не определяет). */
  p95: number | null;
  status: 'ok' | 'failed' | 'partial';
  detail: string;
  /** Этап 18: профиль SQL по выборкам шага (без прогрева), только с --profile-queries. */
  queries?: IStepQueryProfile;
}

export interface IBenchReport {
  version: string;
  takenAt: string;
  valid: boolean;
  invalidReasons: string[];
  harness: string;
  machine: { platform: string; release: string; cpu: string; cores: number; memoryGb: number; node: string };
  volumeBefore: Record<string, number>;
  volumeAfter: Record<string, number>;
  steps: IBenchStep[];
  notes: string[];
}

export const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
};

export const P95_MIN_SAMPLES = 20;

/** Перцентиль по ближайшему рангу; null при выборке меньше minSamples. */
export const percentile = (values: readonly number[], q: number, minSamples: number): number | null => {
  if (values.length < minSamples || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]!;
};

/** Сводка шага из прогрева и замеров. Время неуспешной выборки в статистику не попадает. */
export const summarizeStep = (
  meta: { code: string; title: string; required: boolean },
  warmup: ISample,
  samples: ReadonlyArray<{ sample: ISample; ms: number }>,
): IBenchStep => {
  const good = samples.filter(s => s.sample.ok).map(s => s.ms);
  const errors = samples.filter(s => !s.sample.ok).map(s => s.sample);
  const round = (v: number | null): number | null => (v === null ? null : Math.round(v * 10) / 10);
  const status = good.length === 0 ? 'failed' : errors.length > 0 || !warmup.ok ? 'partial' : 'ok';
  return {
    ...meta,
    requested: samples.length,
    successes: good.length,
    warmup,
    errors,
    min: round(good.length ? Math.min(...good) : null),
    median: round(median(good)),
    max: round(good.length ? Math.max(...good) : null),
    p95: round(percentile(good, 0.95, P95_MIN_SAMPLES)),
    status,
    detail: samples.find(s => s.sample.ok)?.sample.detail ?? errors[0]?.detail ?? warmup.detail,
  };
};

/** Действителен ли отчёт: каждый обязательный шаг есть и не failed, и нет недостающих данных. */
export const benchValidity = (steps: readonly IBenchStep[], requiredCodes: readonly string[], missing: readonly string[]): { valid: boolean; reasons: string[] } => {
  const reasons = [...missing];
  for (const code of requiredCodes) {
    const step = steps.find(s => s.code === code);
    if (!step) reasons.push(`обязательный шаг ${code} не измерялся`);
    else if (step.status === 'failed') reasons.push(`обязательный шаг ${code}: нет успешных выборок (${step.detail})`);
  }
  return { valid: reasons.length === 0, reasons };
};

const expectStatus = (res: ITestResponse, status: number, check: () => string | null): ISample => {
  if (res.status !== status) return { ok: false, status: res.status, detail: `ожидался HTTP ${status}, получен ${res.status}` };
  const problem = check();
  return problem ? { ok: false, status: res.status, detail: problem } : { ok: true, status: res.status, detail: `HTTP ${res.status}` };
};

/** Проверки содержимого по маршрутам. Экспортируются для unit-тестов. */
export const validators = {
  search: (res: ITestResponse, companyId: number): ISample =>
    expectStatus(res, 200, () => {
      const items = res.body.items;
      if (!Array.isArray(items)) return 'в ответе нет items';
      return items.some(i => (i as { id?: number }).id === companyId) ? null : 'искомая компания не найдена в выдаче';
    }),
  companyCard: (card: ITestResponse, signals: ITestResponse, companyId: number): ISample => {
    const c = expectStatus(card, 200, () => ((card.body.company as { id?: number } | undefined)?.id === companyId ? null : 'карточка другой компании или пустая'));
    if (!c.ok) return c;
    return expectStatus(signals, 200, () => (typeof signals.body === 'object' && Object.keys(signals.body).length > 0 ? null : 'пустой ответ сигналов'));
  },
  summary: (res: ITestResponse): ISample => expectStatus(res, 200, () => (Array.isArray(res.body.summary) ? null : 'в резюме нет summary')),
  graph: (res: ITestResponse): ISample =>
    expectStatus(res, 200, () => (Array.isArray(res.body.nodes) && res.body.nodes.length > 0 && Array.isArray(res.body.edges) ? null : 'схема без узлов')),
  projectDossier: (res: ITestResponse, projectId: number): ISample =>
    expectStatus(res, 200, () => ((res.body.project as { id?: number } | undefined)?.id === projectId ? null : 'досье другого объекта или пустое')),
  caseDossier: (res: ITestResponse, caseId: number): ISample =>
    expectStatus(res, 200, () => (res.body.caseId === caseId && typeof res.body.role === 'object' && res.body.role !== null ? null : 'досье обращения без роли или другого обращения')),
  snapshotCreate: (res: ITestResponse): ISample =>
    expectStatus(res, 201, () => (typeof res.body.id === 'number' && typeof res.body.payloadHash === 'string' ? null : 'нет id или hash снимка')),
  snapshotRead: (res: ITestResponse, id: number): ISample =>
    expectStatus(res, 200, () => {
      const meta = res.body.meta as { id?: number } | undefined;
      const integrity = res.body.integrity as { verified?: boolean } | undefined;
      if (meta?.id !== id) return 'другой снимок';
      return integrity?.verified === true ? null : 'hash снимка не подтверждён';
    }),
  exportHtml: (res: ITestResponse): ISample =>
    expectStatus(res, 200, () => {
      const html = String(res.body.raw ?? '');
      return /<html/i.test(html) && html.length > 200 ? null : 'выгрузка не HTML или пустая';
    }),
};

export const DEFAULT_STEP_TIMEOUT_MS = 30_000;

/** Одна выборка с ограничением времени: зависший ответ — исход timeout, а не бесконечное ожидание и не успех. */
export const timedSample = async (fn: () => Promise<ISample>, timeoutMs: number = DEFAULT_STEP_TIMEOUT_MS): Promise<{ sample: ISample; ms: number }> => {
  const started = performance.now();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<ISample>(resolve => {
    timer = setTimeout(() => resolve({ ok: false, status: 0, detail: `timeout ${timeoutMs} мс` }), timeoutMs);
  });
  try {
    const sample = await Promise.race([fn(), timeout]);
    return { sample, ms: performance.now() - started };
  } catch (err) {
    return { sample: { ok: false, status: 0, detail: `исключение: ${err instanceof Error ? err.message : String(err)}` }, ms: performance.now() - started };
  } finally {
    clearTimeout(timer);
  }
};

const measure = async (meta: { code: string; title: string; required: boolean }, runs: number, fn: () => Promise<ISample>, profile?: IQueryProfiler): Promise<IBenchStep> => {
  const warmup = (await timedSample(fn)).sample;
  const samples: Array<{ sample: ISample; ms: number }> = [];
  profile?.begin();
  for (let i = 0; i < runs; i += 1) samples.push(await timedSample(fn));
  const queries = profile?.end(runs);
  return { ...summarizeStep(meta, warmup, samples), ...(queries ? { queries } : {}) };
};

const VOLUME_TABLES = ['sources', 'source_items', 'document_revisions', 'assertions', 'evidence', 'review_decisions', 'companies', 'projects', 'events', 'dossier_cases', 'dossier_snapshots'];

export const REQUIRED_STEPS = ['search', 'company_card', 'case_dossier', 'snapshot_create', 'snapshot_read', 'export_html'];

const volume = async (exec: DbExecutor): Promise<Record<string, number>> => {
  const out: Record<string, number> = {};
  for (const table of VOLUME_TABLES) out[table] = (await exec.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]!.n;
  return out;
};

export const runBench = async (exec: DbExecutor, options: { runs?: number; api?: ITestApi; profile?: IQueryProfiler; caseId?: number } = {}): Promise<IBenchReport> => {
  const runs = options.runs ?? 5;
  const volumeBefore = await volume(exec);
  const m = (meta: { code: string; title: string; required: boolean }, fn: () => Promise<ISample>): Promise<IBenchStep> => measure(meta, runs, fn, options.profile);

  // Компания с утверждениями и обращением, а не первая попавшаяся: пустая карточка ничего не измеряет.
  // --case-id выбирает обращение большого набора (этап 18), иначе — первое.
  const caseRow = (
    await exec.query<{ id: number; company_id: number | null; project_id: number | null }>(
      'SELECT id, company_id, project_id FROM dossier_cases WHERE ($1::bigint IS NULL OR id = $1) ORDER BY id LIMIT 1',
      [options.caseId ?? null],
    )
  ).rows[0];
  const company = (
    await exec.query<{ id: number; name: string }>(
      `SELECT id, name FROM companies WHERE merged_into_id IS NULL AND ($1::bigint IS NULL OR id = $1) ORDER BY id LIMIT 1`,
      [caseRow?.company_id ?? null],
    )
  ).rows[0];
  const project = (await exec.query<{ id: number }>('SELECT id FROM projects WHERE ($1::bigint IS NULL OR id = $1) ORDER BY id LIMIT 1', [caseRow?.project_id ?? null])).rows[0];

  const missing: string[] = [];
  if (!company) missing.push('в базе нет живой компании — поиск и карточка не измерены');
  if (!caseRow) missing.push('в базе нет обращения — досье, снимок и выгрузка не измерены');

  const api = options.api ?? (await startTestApi());
  const steps: IBenchStep[] = [];
  try {
    if (company) {
      steps.push(
        await m({ code: 'search', title: 'поиск компании по названию', required: true }, async () =>
          validators.search(await api.call('GET', `/api/companies?q=${encodeURIComponent(company.name)}`, undefined, api.auth), company.id),
        ),
      );
      steps.push(
        await m({ code: 'company_card', title: 'карточка компании (сведения и сигналы)', required: true }, async () =>
          validators.companyCard(
            await api.call('GET', `/api/companies/${company.id}`, undefined, api.auth),
            await api.call('GET', `/api/companies/${company.id}/signals`, undefined, api.auth),
            company.id,
          ),
        ),
      );
      steps.push(
        await m({ code: 'company_summary', title: 'резюме компании для досье', required: false }, async () =>
          validators.summary(await api.call('GET', `/api/companies/${company.id}/dossier-summary`, undefined, api.auth)),
        ),
      );
      steps.push(
        await m({ code: 'graph', title: 'схема связей, глубина 2', required: false }, async () =>
          validators.graph(await api.call('GET', `/api/graph?companyId=${company.id}&depth=2`, undefined, api.auth)),
        ),
      );
    }
    if (project) {
      steps.push(
        await m({ code: 'project_dossier', title: 'досье объекта', required: false }, async () =>
          validators.projectDossier(await api.call('GET', `/api/projects/${project.id}/dossier`, undefined, api.auth), project.id),
        ),
      );
    }
    if (caseRow) {
      steps.push(
        await m({ code: 'case_dossier', title: 'досье обращения', required: true }, async () =>
          validators.caseDossier(await api.call('GET', `/api/cases/${caseRow.id}/dossier`, undefined, api.auth), caseRow.id),
        ),
      );
      let lastSnapshot = 0;
      steps.push(
        await m({ code: 'snapshot_create', title: 'создание снимка досье (пишет в базу)', required: true }, async () => {
          const res = await api.call('POST', `/api/cases/${caseRow.id}/snapshots`, {}, api.auth);
          const sample = validators.snapshotCreate(res);
          if (sample.ok) lastSnapshot = res.body.id as number;
          return sample;
        }),
      );
      if (lastSnapshot > 0) {
        steps.push(
          await m({ code: 'snapshot_read', title: 'открытие снимка', required: true }, async () =>
            validators.snapshotRead(await api.call('GET', `/api/snapshots/${lastSnapshot}`, undefined, api.auth), lastSnapshot),
          ),
        );
        steps.push(
          await m({ code: 'export_html', title: 'выгрузка HTML («Версия для печати»)', required: true }, async () =>
            validators.exportHtml(await api.call('GET', `/api/snapshots/${lastSnapshot}/export.html`, undefined, api.auth)),
          ),
        );
      }
    }
  } finally {
    if (!options.api) await api.close();
  }

  const volumeAfter = await volume(exec);
  const { valid, reasons } = benchValidity(steps, company && caseRow ? REQUIRED_STEPS : [], missing);
  const cpus = os.cpus();
  return {
    version: BENCH_VERSION,
    takenAt: new Date().toISOString(),
    valid,
    invalidReasons: reasons,
    harness: 'in-process: node:http на 127.0.0.1 в том же процессе Node; настоящие createApp, вход оператора и CSRF; браузер, сеть и модель не участвуют',
    machine: {
      platform: `${os.platform()} ${os.arch()}`,
      release: os.release(),
      cpu: cpus[0]?.model.trim() ?? 'неизвестно',
      cores: cpus.length,
      memoryGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
      node: process.version,
    },
    volumeBefore,
    volumeAfter,
    steps,
    notes: [
      'Первая выборка каждого шага — прогрев: в статистику не входит, её исход показан отдельно.',
      'min/median/max — только по успешным выборкам (ожидаемый код и содержимое); ошибки перечислены в errors.',
      'Шаг создания снимка пишет строки: объём после замера больше исходного.',
      'Числа относятся к объёму и машине выше; это не SLA и не пропускная способность.',
      `p95 считается только при ${P95_MIN_SAMPLES}+ успешных выборках шага (--runs ${P95_MIN_SAMPLES}); одна машина, последовательные запросы, без конкурентной нагрузки.`,
      ...(options.profile ? ['Профиль SQL (query-profile@1): тексты без значений, время включает ожидание пула; для EXPLAIN берите запросы из top/suspectedNPlusOne.'] : []),
    ],
  };
};
