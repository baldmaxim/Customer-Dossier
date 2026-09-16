// Замеры локальной установки (этап 09): сколько на самом деле занимают поиск, карточка, досье,
// ограниченная схема связей, создание снимка и выгрузка на текущем объёме тестовой базы.
//
// Это измерение, а не обещание. Числа имеют смысл только вместе с описанием машины и объёма данных,
// которые печатаются рядом. Сеть и модель не вызываются.

import { performance } from 'node:perf_hooks';
import os from 'node:os';

import type { DbExecutor } from '../db/pool.js';
import { startTestApi, type ITestApi } from '../__tests__/integration/http.js';

export interface IBenchStep {
  code: string;
  title: string;
  runs: number;
  /** Миллисекунды. */
  min: number;
  median: number;
  max: number;
  note: string;
}

export interface IBenchReport {
  takenAt: string;
  machine: { platform: string; release: string; cpu: string; cores: number; memoryGb: number; node: string };
  volume: Record<string, number>;
  steps: IBenchStep[];
  notes: string[];
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1]! + sorted[mid]!) / 2) : sorted[mid]!;
};

const measure = async (code: string, title: string, runs: number, fn: () => Promise<string | void>): Promise<IBenchStep> => {
  const times: number[] = [];
  let note = '';
  // Первый прогон прогревает планы запросов и кэш страниц — он в статистику не входит.
  const warm = await fn();
  if (typeof warm === 'string') note = warm;
  for (let i = 0; i < runs; i += 1) {
    const started = performance.now();
    const result = await fn();
    times.push(performance.now() - started);
    if (typeof result === 'string') note = result;
  }
  return { code, title, runs, min: Math.round(Math.min(...times)), median: Math.round(median(times)), max: Math.round(Math.max(...times)), note };
};

const VOLUME_TABLES = ['sources', 'source_items', 'document_revisions', 'assertions', 'evidence', 'companies', 'projects', 'events', 'dossier_cases', 'dossier_snapshots'];

export const runBench = async (exec: DbExecutor, options: { runs?: number } = {}): Promise<IBenchReport> => {
  const runs = options.runs ?? 5;
  const volume: Record<string, number> = {};
  for (const table of VOLUME_TABLES) {
    volume[table] = (await exec.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]!.n;
  }

  const company = (await exec.query<{ id: number; name: string }>('SELECT id, name FROM companies WHERE merged_into_id IS NULL ORDER BY id LIMIT 1')).rows[0];
  const project = (await exec.query<{ id: number }>('SELECT id FROM projects ORDER BY id LIMIT 1')).rows[0];
  const caseRow = (await exec.query<{ id: number }>('SELECT id FROM dossier_cases ORDER BY id LIMIT 1')).rows[0];

  const api: ITestApi = await startTestApi();
  const steps: IBenchStep[] = [];
  const notes: string[] = [
    'Замеры сделаны через локальный HTTP-вход приложения с уже вошедшим оператором; браузер и сеть не участвуют.',
    'Первый прогон каждого шага отброшен как прогрев. Числа относятся к объёму, указанному выше, и к этой машине.',
  ];

  try {
    if (company) {
      const query = encodeURIComponent(company.name.slice(0, 6));
      steps.push(
        await measure('search', 'поиск компании по части названия', runs, async () => {
          const res = await api.call('GET', `/api/companies/search?q=${query}`, undefined, api.auth);
          return `HTTP ${res.status}`;
        }),
      );
      steps.push(
        await measure('company_card', 'карточка компании (сведения и сигналы)', runs, async () => {
          const card = await api.call('GET', `/api/companies/${company.id}`, undefined, api.auth);
          const signals = await api.call('GET', `/api/companies/${company.id}/signals`, undefined, api.auth);
          return `HTTP ${card.status}/${signals.status}`;
        }),
      );
      steps.push(
        await measure('company_summary', 'резюме компании для досье', runs, async () => {
          const res = await api.call('GET', `/api/companies/${company.id}/dossier-summary`, undefined, api.auth);
          return `HTTP ${res.status}`;
        }),
      );
      steps.push(
        await measure('graph', 'схема связей, глубина 2, лимит 60', runs, async () => {
          const res = await api.call('GET', `/api/graph?companyId=${company.id}&depth=2`, undefined, api.auth);
          const nodes = Array.isArray(res.body.nodes) ? res.body.nodes.length : 0;
          const edges = Array.isArray(res.body.edges) ? res.body.edges.length : 0;
          return `HTTP ${res.status}, узлов ${nodes}, связей ${edges}`;
        }),
      );
    }

    if (project) {
      steps.push(
        await measure('project_dossier', 'досье объекта', runs, async () => {
          const res = await api.call('GET', `/api/projects/${project.id}/dossier`, undefined, api.auth);
          return `HTTP ${res.status}`;
        }),
      );
    }

    if (caseRow) {
      steps.push(
        await measure('case_dossier', 'досье обращения', runs, async () => {
          const res = await api.call('GET', `/api/cases/${caseRow.id}/dossier`, undefined, api.auth);
          return `HTTP ${res.status}`;
        }),
      );
      let lastSnapshot = 0;
      steps.push(
        await measure('snapshot_create', 'создание снимка досье', runs, async () => {
          const res = await api.call('POST', `/api/cases/${caseRow.id}/snapshots`, {}, api.auth);
          if (typeof res.body.id === 'number') lastSnapshot = res.body.id;
          return `HTTP ${res.status}`;
        }),
      );
      if (lastSnapshot > 0) {
        steps.push(
          await measure('snapshot_read', 'открытие снимка', runs, async () => {
            const res = await api.call('GET', `/api/snapshots/${lastSnapshot}`, undefined, api.auth);
            return `HTTP ${res.status}`;
          }),
        );
        steps.push(
          await measure('export_html', 'выгрузка HTML («Версия для печати»)', runs, async () => {
            const res = await api.call('GET', `/api/snapshots/${lastSnapshot}/export.html`, undefined, api.auth);
            return `HTTP ${res.status}, ${String(res.body.raw ?? '').length} байт`;
          }),
        );
      }
      notes.push('Шаг создания снимка пишет строки в базу: запускать только на тестовой цели.');
    } else {
      notes.push('Обращений в базе нет — досье обращения, снимок и выгрузка не измерялись.');
    }
  } finally {
    await api.close();
  }

  const cpus = os.cpus();
  return {
    takenAt: new Date().toISOString(),
    machine: {
      platform: `${os.platform()} ${os.arch()}`,
      release: os.release(),
      cpu: cpus[0]?.model.trim() ?? 'неизвестно',
      cores: cpus.length,
      memoryGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
      node: process.version,
    },
    volume,
    steps,
    notes,
  };
};
