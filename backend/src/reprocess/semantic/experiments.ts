// Реестр экспериментов качества извлечения (experiment-registry@1, этап 14B). Чистые данные и проверки.
//
// Вариант — неизменяемая конфигурация относительно базовой: ровно один изменённый фактор, пороги заданы до прогона.
// Базовая конфигурация не перезаписывается. Выбор варианта (selected) — только явным решением владельца по полному
// отчёту (QUALITY_DECISION), никогда автоматически; рабочий конвейер варианты не использует.

import { SEMANTIC_PROMPT_VARIANTS } from '../../llm/semantic/prompt.js';
import { DEFAULT_GATES, type IGates } from './evaluation.js';

export const EXPERIMENT_REGISTRY_VERSION = 'experiment-registry@1';

export type ExperimentFactor = 'none' | 'prompt' | 'chunker' | 'second_pass' | 'model';
export type ExperimentStatus = 'registered' | 'baseline_measured' | 'candidate_measured' | 'selected' | 'rejected' | 'not_implemented';

export interface IExperiment {
  id: string;
  baselineId: string | null;
  factor: ExperimentFactor;
  /** Что именно меняется; для prompt — ключ SEMANTIC_PROMPT_VARIANTS. */
  change: { promptVariant?: string; note: string };
  hypothesis: string;
  gates: IGates;
  status: ExperimentStatus;
  registeredAt: string;
}

export const EXPERIMENTS: readonly IExperiment[] = [
  {
    id: 'baseline-semantic@1',
    baselineId: null,
    factor: 'none',
    change: { note: 'текущая рабочая конфигурация extract@3 / semantic@1 без изменений' },
    hypothesis: 'измерить исходную точку current-eval@1 на регрессионном корпусе',
    gates: DEFAULT_GATES,
    status: 'registered',
    registeredAt: '2026-09-17',
  },
  {
    id: 'prompt-recall-a@1',
    baselineId: 'baseline-semantic@1',
    factor: 'prompt',
    change: { promptVariant: 'recall-a@1', note: 'дополнение промта о полном перечне участников и связей, адресате ИНН/суммы, отрицании, плане и масштабе' },
    hypothesis: 'больше найденных recall-проверок без нарушений safety на том же корпусе и бюджете',
    gates: DEFAULT_GATES,
    status: 'registered',
    registeredAt: '2026-09-17',
  },
  {
    id: 'second-pass@1',
    baselineId: 'baseline-semantic@1',
    factor: 'second_pass',
    change: { note: 'ограниченный второй проход по пропущенным фактам (≤1 доп. вызов на чанк), слияние без повышения статуса' },
    hypothesis: 'проверять только после локализации пропусков baseline',
    gates: DEFAULT_GATES,
    status: 'not_implemented',
    registeredAt: '2026-09-17',
  },
];

export class ExperimentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExperimentError';
  }
}

/** Проверка реестра: уникальные id, одна базовая точка, у варианта ровно один фактор, пороги не ослаблены. */
export const registryViolations = (experiments: readonly IExperiment[]): string[] => {
  const v: string[] = [];
  const ids = new Set<string>();
  for (const e of experiments) {
    if (ids.has(e.id)) v.push(`повтор id ${e.id}`);
    ids.add(e.id);
    if (e.baselineId === null && e.factor !== 'none') v.push(`${e.id}: базовая конфигурация не может менять фактор`);
    if (e.baselineId !== null && !experiments.some(b => b.id === e.baselineId)) v.push(`${e.id}: нет базовой ${e.baselineId}`);
    if (e.baselineId !== null && e.factor === 'none') v.push(`${e.id}: вариант без изменённого фактора`);
    if (e.factor === 'prompt' && (!e.change.promptVariant || !SEMANTIC_PROMPT_VARIANTS[e.change.promptVariant])) v.push(`${e.id}: вариант промта не найден`);
    if (e.factor !== 'prompt' && e.change.promptVariant) v.push(`${e.id}: фактор ${e.factor}, но меняет и промт`);
    if (!e.gates.safetyAllPass) v.push(`${e.id}: safety-порог ослаблен`);
    if (e.status === 'selected') v.push(`${e.id}: статус selected ставится только решением владельца в QUALITY_DECISION, не в реестре кода`);
  }
  return v;
};

/** Эксперимент для запуска оценки: неизвестный или нереализованный — ошибка. */
export const experimentForRun = (id: string, experiments: readonly IExperiment[] = EXPERIMENTS): IExperiment => {
  const e = experiments.find(x => x.id === id);
  if (!e) throw new ExperimentError(`эксперимент не зарегистрирован: ${id}`);
  if (e.status === 'not_implemented') throw new ExperimentError(`эксперимент ${id} зарегистрирован, но не реализован`);
  return e;
};
