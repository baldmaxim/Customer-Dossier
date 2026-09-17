// Этап 19 без БД: пилот не стартует без утверждённого манифеста, названных источников с допуском, верной цели и выключенного фона.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { pilotGate, type IPilotEnvFlags, type IPilotGateInput, type IPilotSourceRow } from './pilotManifest.js';

const env: IPilotEnvFlags = { INGEST_ENABLED: false, PIPELINE_ENABLED: false, BOT_ENABLED: false, METRICS_AUTO_REFRESH: false, REPROCESS_AUTO_PUBLISH: false, MERGE_APPLY_ENABLED: false, HOST: '127.0.0.1' };

const manifest = (over: Record<string, unknown> = {}) => ({
  contract: 'pilot-manifest@1',
  status: 'approved',
  owner: 'владелец',
  decidedAt: '2026-09-17',
  target: { database: 'tg_info_test', kind: 'test', identifiedBy: 'маркер tg_info:test-target' },
  window: { from: '2026-09-01', to: '2026-09-15', maxItemsPerSource: 20, maxItemsTotal: 40 },
  sources: [{ key: 'demo.test', kind: 'website', collectEvidence: 'письмо №1', aiEvidence: 'письмо №1' }],
  subjects: { companies: ['Альфа-Демо'], projects: [] },
  model: { executionFingerprint: 'a'.repeat(64), qualityDecision: 'pending' },
  review: { mandatory: true, reviewers: ['аналитик'] },
  forbidden: { autopublish: true, mergeApply: true, workingDatabaseMigration: true, publicAccess: true, externalTransfer: true },
  retention: { rawAttemptsDays: null, resultsAccess: ['владелец'] },
  ...over,
});

const approvedSource: IPilotSourceRow = { key: 'demo.test', kind: 'website', accessStatus: 'approved', aiProcessingStatus: 'approved', policyExpiresAt: null };
const gate = (over: Partial<IPilotGateInput> = {}) =>
  pilotGate({ manifest: manifest(), env, connectedDatabase: 'tg_info_test', sources: [approvedSource], pendingMigrations: [], now: new Date('2026-09-17T00:00:00Z'), ...over });

describe('pilot-gate@1 (T19-01, T19-03, T19-05)', () => {
  it('утверждённый манифест, допущенный источник, верная цель, фон выключен — готов; модель без выбора — предупреждение', () => {
    const r = gate();
    expect(r.verdict).toBe('READY_TO_START');
    expect(r.allowedSteps).toEqual({ collect: ['demo.test'], ai: ['demo.test'] });
    expect(r.warnings.join(' ')).toMatch(/LOCAL_MODEL_VALIDATED = нет/);
  });

  it('черновик, пустой перечень источников, чужая база, неприменённые миграции — блок', () => {
    expect(gate({ manifest: manifest({ status: 'draft' }) }).blockers.join(' ')).toMatch(/не утверждён/);
    expect(gate({ manifest: manifest({ sources: [] }) }).blockers.join(' ')).toMatch(/источники не названы/);
    expect(gate({ connectedDatabase: 'tg_info' }).blockers.join(' ')).toMatch(/подключение к «tg_info»/);
    expect(gate({ manifest: manifest({ target: { database: 'tg_info_test', kind: 'working', identifiedBy: 'x' } }), pendingMigrations: ['023_ambiguity_decisions.sql'] }).blockers.join(' ')).toMatch(/отдельного разрешения, пилот им не является/);
  });

  it('основание в манифесте не заменяет допуск: источник без допуска — блок; ИИ заявлен без ИИ-допуска — блок', () => {
    expect(gate({ sources: [{ ...approvedSource, accessStatus: 'unknown' }] }).blockers.join(' ')).toMatch(/сбор не допущен/);
    const noAi = gate({ sources: [{ ...approvedSource, aiProcessingStatus: 'revoked' }] });
    expect(noAi.verdict).toBe('BLOCKED');
    expect(noAi.blockers.join(' ')).toMatch(/ИИ-обработка заявлена, но допуск не действует/);
    expect(gate({ sources: [] }).blockers.join(' ')).toMatch(/не зарегистрирован/);
  });

  it('фоновые задачи, автопубликация, применение слияний, не-loopback — блок', () => {
    const r = gate({ env: { ...env, PIPELINE_ENABLED: true, REPROCESS_AUTO_PUBLISH: true, MERGE_APPLY_ENABLED: true, HOST: '0.0.0.0' } });
    expect(r.blockers).toHaveLength(4);
  });

  it('запреты — литералы: манифест не может разрешить автопубликацию, слияние или пропуск ручной проверки', () => {
    expect(gate({ manifest: manifest({ forbidden: { autopublish: false, mergeApply: true, workingDatabaseMigration: true, publicAccess: true, externalTransfer: true } }) }).blockers[0]).toMatch(/манифест некорректен: forbidden\.autopublish/);
    expect(gate({ manifest: manifest({ review: { mandatory: false, reviewers: ['x'] } }) }).verdict).toBe('BLOCKED');
    expect(gate({ manifest: manifest({ window: { from: '2026-09-01', to: '2026-09-15', maxItemsPerSource: 20, maxItemsTotal: 5000 } }) }).verdict).toBe('BLOCKED');
  });

  it('отклонённая по оценке конфигурация модели — ИИ-шаги блокируются; без ИИ в манифесте модель не проверяется', () => {
    expect(gate({ manifest: manifest({ model: { executionFingerprint: null, qualityDecision: 'rejected' } }) }).blockers.join(' ')).toMatch(/отклонена по оценке качества/);
    const collectOnly = gate({ manifest: manifest({ sources: [{ key: 'demo.test', kind: 'website', collectEvidence: 'письмо', aiEvidence: null }], model: { executionFingerprint: null, qualityDecision: 'rejected' } }) });
    expect(collectOnly.verdict).toBe('READY_TO_START');
    expect(collectOnly.allowedSteps.ai).toEqual([]);
  });

  it('шаблон манифеста в документации — черновик без источников: пилот по нему не стартует', () => {
    const template = JSON.parse(readFileSync(fileURLToPath(new URL('../../../docs/development/pilot/pilot-manifest.template.json', import.meta.url)), 'utf8')) as unknown;
    const r = gate({ manifest: template });
    expect(r.verdict).toBe('BLOCKED');
    expect(r.blockers.join(' ')).toMatch(/не утверждён/);
    expect(r.blockers.join(' ')).toMatch(/источники не названы/);
  });
});
