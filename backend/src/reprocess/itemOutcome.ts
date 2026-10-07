// Что стало с текстом публикации — одно правило для всего портала (состояние разбора словами).
//
// Пустой результат объясняется словами и различает причины: текст не о стройке,
// связей в нём нет, разбор не удался, источник без ИИ-допуска, разбор ещё не начинался.
// «Ничего не показано» и «ничего нет» — разные вещи. Маршрут /items/:id/extraction снят 07.10.2026
// (экрана у него не было с 23.09); правило осталось одно — его берёт «Обработка».

export type ItemState =
  | 'in_cards'
  | 'nothing_found'
  | 'not_relevant'
  | 'built_not_in_cards'
  | 'running'
  | 'queued'
  | 'partial'
  | 'failed'
  | 'cancelled'
  | 'no_policy'
  | 'no_run';

export interface IItemStateInput {
  policyAllowed: boolean;
  run: { status: string; relevant: boolean | null } | null;
  activeSetId: number | null;
  assertions: number;
}

/**
 * Состояние текста одним словом. Порядок проверок значим: опубликованный набор старше
 * отозванного допуска — сведения уже в карточках, и молчать об этом нельзя.
 */
export const decideItemState = (input: IItemStateInput): ItemState => {
  if (input.activeSetId !== null) {
    if (input.assertions > 0) return 'in_cards';
    return input.run?.relevant === false ? 'not_relevant' : 'nothing_found';
  }
  if (!input.policyAllowed && input.run === null) return 'no_policy';
  if (input.run === null) return 'no_run';
  if (input.run.status === 'queued') return 'queued';
  if (input.run.status === 'running') return 'running';
  if (input.run.status === 'completed') return input.run.relevant === false ? 'not_relevant' : 'built_not_in_cards';
  if (input.run.status === 'partial') return 'partial';
  if (input.run.status === 'cancelled') return 'cancelled';
  return 'failed';
};

export interface IRunOutcome {
  state: ItemState;
  /**
   * Уточнение: почему разобранное не перенесено (статус набора), или что с повтором упавшего разбора — exhausted
   * (попытки исчерпаны: тот же признак, что плитка «Обработки» failed_exhausted) или retrying.
   */
  detail: string | null;
}

/**
 * Итог одного запуска разбора одним словом — для строки «Обработки» и страницы разбора. Раньше то же правило жило
 * копией на клиенте, а плитка «попытки исчерпаны» открывала строки «разбор не удался» без признака исчерпания.
 * Порядок проверок тот же, что у decideItemState: перенесённое в карточки старше выключенного источника.
 */
export const decideRunOutcome = (run: {
  status: string;
  relevant: boolean | null;
  setStatus: string | null;
  policyAllowed: boolean;
  /** Сколько раз разбор этой редакции падал (failed/partial) и потолок повторов REPROCESS_RETRY_MAX. */
  failures: number;
  retryMax: number;
}): IRunOutcome => {
  if (run.status === 'completed') {
    if (run.relevant === false) return { state: 'not_relevant', detail: null };
    if (run.setStatus === 'published') return { state: 'in_cards', detail: null };
    if (!run.policyAllowed) return { state: 'no_policy', detail: null };
    return { state: 'built_not_in_cards', detail: run.setStatus && run.setStatus !== 'built' ? run.setStatus : null };
  }
  // Выключенный источник: поставленный разбор не выполнится, пока его не включат.
  if (!run.policyAllowed && (run.status === 'queued' || run.status === 'running')) return { state: 'no_policy', detail: null };
  if (run.status === 'queued') return { state: 'queued', detail: null };
  if (run.status === 'running') return { state: 'running', detail: null };
  if (run.status === 'cancelled') return { state: 'cancelled', detail: null };
  const retry = run.failures >= run.retryMax ? 'exhausted' : 'retrying';
  return { state: run.status === 'partial' ? 'partial' : 'failed', detail: retry };
};
