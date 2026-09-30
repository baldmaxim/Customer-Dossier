// Итог разбора одним словом — из статуса, признака «о стройке», судьбы найденного и допуска
// источника. Порядок проверок тот же, что у сервера (reprocess/itemOutcome.ts): перенесённое
// в карточки старше выключенного источника — сведения уже там, и молчать об этом нельзя.

import type { IRunListItem, ItemState } from '../../api/types';
import { CANDIDATE_SET_STATUS_LABELS } from '../../lib/labels';

export interface IRunOutcome {
  state: ItemState;
  /** Уточнение: почему разобранное не перенесено («не перенесён: текст изменился»). */
  detail: string | null;
}

export const runOutcome = (run: Pick<IRunListItem, 'status' | 'relevant' | 'candidateSet' | 'policy'>): IRunOutcome => {
  const set = run.candidateSet;
  if (run.status === 'completed') {
    if (run.relevant === false) return { state: 'not_relevant', detail: null };
    if (set?.status === 'published') return { state: 'in_cards', detail: null };
    if (!run.policy.allowed) return { state: 'no_policy', detail: null };
    return {
      state: 'built_not_in_cards',
      detail: set && set.status !== 'built' ? (CANDIDATE_SET_STATUS_LABELS[set.status] ?? null) : null,
    };
  }
  // Выключенный источник: поставленный разбор не выполнится, пока его не включат.
  if (!run.policy.allowed && (run.status === 'queued' || run.status === 'running')) return { state: 'no_policy', detail: null };
  if (run.status === 'queued') return { state: 'queued', detail: null };
  if (run.status === 'running') return { state: 'running', detail: null };
  if (run.status === 'partial') return { state: 'partial', detail: null };
  if (run.status === 'cancelled') return { state: 'cancelled', detail: null };
  return { state: 'failed', detail: null };
};
