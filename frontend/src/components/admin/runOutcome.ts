// Итог разбора словами и тоном — по итогу, который считает сервер (reprocess/itemOutcome.ts::decideRunOutcome).
// Своего правила здесь нет (07.10.2026: раньше оно жило копией серверного): только подписи. Упавший разбор
// подписывается теми же словами и тоном, что плитки «Обработки» («попытки исчерпаны» — авария, «будет повтор» —
// предупреждение); разобранный, но не перенесённый — судьбой набора.

import type { IRunListItem } from '../../api/types';
import { CANDIDATE_SET_STATUS_LABELS, ITEM_STATE_HINTS, ITEM_STATE_LABELS, REVISION_STATE_LABELS } from '../../lib/labels';
import { ITEM_STATE_TONE, REVISION_STATE_TONE, toneOf, type StatusTone } from '../../lib/statusTone';

type Outcome = NonNullable<IRunListItem['outcome']>;

/** Старый сервер итога не присылает: по статусу запуска — без уточнений. */
export const outcomeOf = (run: Pick<IRunListItem, 'status' | 'outcome'>): Outcome =>
  run.outcome ?? { state: run.status === 'completed' ? 'built_not_in_cards' : run.status === 'running' ? 'running' : run.status === 'queued' ? 'queued' : run.status === 'cancelled' ? 'cancelled' : run.status === 'partial' ? 'partial' : 'failed', detail: null };

const retryState = (o: Outcome): 'failed_exhausted' | 'failed_retrying' | null =>
  (o.state === 'failed' || o.state === 'partial') && o.detail ? (o.detail === 'exhausted' ? 'failed_exhausted' : 'failed_retrying') : null;

export const outcomeText = (o: Outcome): string => {
  const retry = retryState(o);
  if (retry) return REVISION_STATE_LABELS[retry] ?? ITEM_STATE_LABELS[o.state] ?? 'разбор не удался';
  if (o.state === 'built_not_in_cards' && o.detail && o.detail !== 'built') return CANDIDATE_SET_STATUS_LABELS[o.detail] ?? ITEM_STATE_LABELS[o.state]!;
  return ITEM_STATE_LABELS[o.state] ?? 'состояние неизвестно';
};

export const outcomeTone = (o: Outcome): StatusTone => {
  const retry = retryState(o);
  return retry ? toneOf(REVISION_STATE_TONE, retry) : toneOf(ITEM_STATE_TONE, o.state);
};

/** Почему разобранное не перенесено — по судьбе найденного в тексте. */
const NOT_MOVED_REASON: Record<string, string> = {
  rejected_policy: 'источник был выключен в момент переноса — найденное перенесётся после его включения',
  rejected_stale: 'текст изменился после разбора — портал разберёт новую версию сам',
  superseded: 'его заменил более новый разбор того же текста',
  discarded: 'найденное отброшено',
};

/** Итог одной фразой — первая строка страницы разбора; слова — те же пояснения, что у ярлыка (ITEM_STATE_HINTS). */
export const outcomeSentence = (o: Outcome): string => {
  const reason = o.state === 'built_not_in_cards' && o.detail ? NOT_MOVED_REASON[o.detail] : undefined;
  if (reason) return `Текст разобран, но в карточки не перенесён: ${reason}.`;
  if (retryState(o) === 'failed_exhausted') return 'Разбор не удался, попытки исчерпаны — сам портал этот текст больше не повторит.';
  const hint = ITEM_STATE_HINTS[o.state];
  return hint ? `${hint.charAt(0).toUpperCase()}${hint.slice(1)}.` : 'Состояние разбора неизвестно.';
};
