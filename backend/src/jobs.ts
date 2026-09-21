// Решение, какие фоновые задания запускать при старте API.
//
// Вынесено из index.ts, чтобы проверять без сети и БД: запуск портала не
// должен сам по себе начинать сбор, разбор моделью или пересчёт метрик.

export interface IJobFlags {
  INGEST_ENABLED: boolean;
  PIPELINE_ENABLED: boolean;
  REPROCESS_AUTO_PUBLISH: boolean;
  HEADLINE_ENABLED: boolean;
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
    // Новый конвейер (этап 03B): запуски и наборы кандидатов; legacy apply не вызывается.
    starters.pipeline(signal);
    decision.started.push('pipeline');
    decision.notes.push(
      flags.REPROCESS_AUTO_PUBLISH
        ? 'разобранное уходит в карточки автоматически (REPROCESS_AUTO_PUBLISH=true, без проверки человеком)'
        : 'наборы кандидатов остаются вне карточек (REPROCESS_AUTO_PUBLISH=false)',
    );
    // Тема публикации идёт тем же заданием, а не своим: два параллельных запроса к
    // локальной модели делят VRAM и выталкивают её в RAM — ровно то, что давало таймауты.
    decision.notes.push(
      flags.HEADLINE_ENABLED
        ? 'тема публикации составляется моделью после разбора (HEADLINE_ENABLED=true)'
        : 'тема публикации не составляется (HEADLINE_ENABLED=false)',
    );
  } else {
    decision.notes.push('разбор моделью выключен (PIPELINE_ENABLED=false): темы публикаций тоже не составляются');
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
