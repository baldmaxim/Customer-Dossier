// Решение, какие фоновые задания запускать при старте API.
//
// Вынесено из index.ts, чтобы проверять без сети и БД: запуск портала не
// должен сам по себе начинать сбор, разбор моделью или пересчёт метрик.

export interface IJobFlags {
  INGEST_ENABLED: boolean;
  DOMRF_BROWSER_ENABLED: boolean;
  PIPELINE_ENABLED: boolean;
  REPROCESS_AUTO_PUBLISH: boolean;
  HEADLINE_ENABLED: boolean;
  DOMRF_HINT_ENABLED: boolean;
  METRICS_AUTO_REFRESH: boolean;
  FOCUS_ENABLED: boolean;
  BOT_ENABLED: boolean;
  TG_BOT_TOKEN: string;
}

export interface IJobStarters {
  ingest: (signal: AbortSignal) => void;
  domrf: (signal: AbortSignal) => void;
  pipeline: (signal: AbortSignal) => void;
  metrics: (signal: AbortSignal) => void;
  focus: (signal: AbortSignal) => void;
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

  if (flags.DOMRF_BROWSER_ENABLED) {
    starters.domrf(signal);
    decision.started.push('domrf');
  } else {
    decision.notes.push('браузерный сбор ДОМ.РФ выключен (DOMRF_BROWSER_ENABLED=false)');
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
    decision.notes.push(
      flags.DOMRF_HINT_ENABLED
        ? 'к найденному в реестре ДОМ.РФ модель подсказывает «он / не он» — при ИИ-допуске источника (DOMRF_HINT_ENABLED=true)'
        : 'подсказок к найденному в реестре ДОМ.РФ нет (DOMRF_HINT_ENABLED=false)',
    );
  } else {
    decision.notes.push('разбор моделью выключен (PIPELINE_ENABLED=false): темы публикаций тоже не составляются, подсказок ДОМ.РФ нет');
  }

  if (flags.METRICS_AUTO_REFRESH) {
    starters.metrics(signal);
    decision.started.push('metrics');
  } else {
    decision.notes.push('автопересчёт метрик выключен (METRICS_AUTO_REFRESH=false)');
  }

  if (flags.FOCUS_ENABLED) {
    // Без ключа проход ничего не запрашивает: включённый флаг сам по себе денег не тратит.
    starters.focus(signal);
    decision.started.push('focus');
  } else {
    decision.notes.push('обновление сведений Контур.Фокуса по расписанию выключено (FOCUS_ENABLED=false): только кнопкой в карточке');
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
