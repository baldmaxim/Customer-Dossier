// Карточки арбитражных дел ради суммы иска (06.10.2026, ADR-017 дополнение, миграция 048).
//
// Сумма иска есть только в карточке дела, а карточка — платный запрос на каждое дело. Поэтому:
//  - дела выбираются из последнего снимка картотеки: экономический спор, компания — ответчик (claimCardTargets);
//  - карточка спрашивается один раз: полученная (для этой или другой стороны дела) повторно не запрашивается;
//  - за проход — не больше PARSER_API_KAD_CARDS_MAX карточек, новые дела первыми; остальные — в следующий;
//  - лимит портала и отказ сервиса останавливают проход, как у наборов (тот же резерв до запроса);
//  - два сбоя — проход заканчивается: сервис нестабилен, а неоплаченный повтор подождёт следующего.
// Расписание спрашивает карточки после наборов всех компаний прохода: наборы важнее сумм.

import { claimCardTargets, mapCourts } from './map/courts.js';
import { parserApiStep, type IParserApiRefreshDeps, type ParserApiStopReason } from './refresh.js';

export interface ICaseCardsResult {
  /** Получено карточек в этом проходе. */
  fetched: number;
  /** Ещё ждут запроса после прохода. */
  pending: number;
  /** Неудачных запросов (не оплачены). */
  failed: number;
  stop: ParserApiStopReason | null;
}

const MAX_FAILURES = 2;

/** CaseId дел (строчными), чьи карточки ещё нужны, новые сверху. */
export const pendingCaseCards = async (inn: string, store: IParserApiRefreshDeps['store']): Promise<string[]> => {
  const payload = await store.latestRecord(inn, 'courts');
  if (!payload) return [];
  const targets = claimCardTargets(mapCourts(payload, null, true)).map(id => id.toLowerCase());
  const known = await store.knownCaseCards(targets);
  return targets.filter(id => !known.has(id));
};

/** ИНН, по которым карточки спрашиваются сейчас: кнопка и расписание одного процесса не платят за одно дело дважды. */
const running = new Set<string>();

export const caseCardsRunning = (inn: string): boolean => running.has(inn);

export const fetchCaseCards = async (
  inn: string,
  actor: string,
  max: number,
  deps: Omit<IParserApiRefreshDeps, 'kadMaxPages'>,
): Promise<ICaseCardsResult> => {
  if (deps.key === null) return { fetched: 0, pending: 0, failed: 0, stop: 'no_key' };
  if (running.has(inn)) return { fetched: 0, pending: 0, failed: 0, stop: null };
  running.add(inn);
  try {
    const pending = await pendingCaseCards(inn, deps.store);
    const step = parserApiStep(inn, actor, deps.key, deps);
    let fetched = 0;
    let failed = 0;
    for (const caseId of pending.slice(0, max)) {
      const res = await step('kad_details', { CaseId: caseId });
      if (res.ok) {
        await deps.store.saveCaseCard(caseId, res.body, actor);
        fetched += 1;
        continue;
      }
      if (res.stop) return { fetched, pending: pending.length - fetched, failed, stop: res.failure as ParserApiStopReason };
      failed += 1;
      if (failed >= MAX_FAILURES) break;
    }
    return { fetched, pending: pending.length - fetched, failed, stop: null };
  } finally {
    running.delete(inn);
  }
};
