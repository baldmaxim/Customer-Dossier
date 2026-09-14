// Решение, какие фоновые задания запускать при старте API.
//
// Вынесено из index.ts, чтобы проверять без сети и БД: запуск портала не
// должен сам по себе начинать сбор, разбор моделью или пересчёт метрик.

import { CANON_WRITE_BLOCK_REASON } from './pipeline/guard.js';

export interface IJobFlags {
  INGEST_ENABLED: boolean;
  PIPELINE_ENABLED: boolean;
  METRICS_AUTO_REFRESH: boolean;
  BOT_ENABLED: boolean;
  TG_BOT_TOKEN: string;
}

export interface IJobStarters {
  ingest: (signal: AbortSignal) => void;
  pipeline: (signal: AbortSignal) => void;
  metrics: (signal: AbortSignal) => void;
  bot: (signal: AbortSignal) => void;
}

export interface IJobDecision {
  started: Array<keyof IJobStarters>;
  notes: string[];
}

export const startBackgroundJobs = (
  flags: IJobFlags,
  starters: IJobStarters,
  signal: AbortSignal,
): IJobDecision => {
  const decision: IJobDecision = { started: [], notes: [] };

  if (flags.INGEST_ENABLED) {
    starters.ingest(signal);
    decision.started.push('ingest');
  } else {
    decision.notes.push('сбор источников выключен (INGEST_ENABLED=false)');
  }

  if (flags.PIPELINE_ENABLED) {
    // Флаг разобран, но воркер не стартует: изменяющий канон конвейер
    // заблокирован до безопасного пути записи (этап 03B).
    decision.notes.push(`разбор моделью не запущен: ${CANON_WRITE_BLOCK_REASON}`);
  } else {
    decision.notes.push('разбор моделью выключен (PIPELINE_ENABLED=false)');
  }

  if (flags.METRICS_AUTO_REFRESH) {
    starters.metrics(signal);
    decision.started.push('metrics');
  } else {
    decision.notes.push('автопересчёт метрик выключен (METRICS_AUTO_REFRESH=false)');
  }

  if (flags.BOT_ENABLED && flags.TG_BOT_TOKEN !== '') {
    starters.bot(signal);
    decision.started.push('bot');
  } else if (flags.BOT_ENABLED) {
    decision.notes.push('BOT_ENABLED=true, но TG_BOT_TOKEN пуст — приём форвардов выключен');
  } else {
    decision.notes.push('приём форвардов выключен (BOT_ENABLED=false)');
  }

  return decision;
};
