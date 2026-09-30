// Запросы «Проверки» — одни и те же для счётчиков на вкладках и для самих списков:
// одинаковый ключ — одна загрузка, решение в списке сразу меняет число на вкладке.

import { api } from '../../api/client';
import type { AmbiguityStatus, IAmbiguityPage, IPendingMerge, IReviewQueueItem } from '../../api/types';

/** Противоречия — всё, кроме неясных упоминаний: у тех своя вкладка и свой постраничный список. */
export const CONFLICT_KINDS = ['polarity_conflict', 'role_period_conflict', 'correction', 'dispute'] as const;
export type ConflictKind = (typeof CONFLICT_KINDS)[number];

/** Сервер отдаёт до 100 строк одного вида. */
export const QUEUE_LIMIT = 100;

/**
 * Каждый вид — своим запросом: очередь идёт по приоритету, и сотня неясных упоминаний
 * (приоритет 1) в общем запросе вытеснила бы все противоречия.
 */
export const reviewQueueQuery = (kind: ConflictKind) => ({
  queryKey: ['review-queue', kind],
  queryFn: () => api.get<{ items: IReviewQueueItem[] }>(`/api/review-queue?limit=${QUEUE_LIMIT}&kind=${kind}`),
});

export const AMBIGUITY_PAGE = 50;

export const ambiguityPageQuery = (status: AmbiguityStatus, what: '' | 'company' | 'project', cursor: string | null) => ({
  queryKey: ['ambiguities', status, what, cursor ?? ''],
  queryFn: () => {
    const params = new URLSearchParams({ status, limit: String(AMBIGUITY_PAGE) });
    if (what) params.set('kind', what);
    if (cursor) params.set('cursor', cursor);
    return api.get<IAmbiguityPage>(`/api/entities/ambiguities?${params.toString()}`);
  },
});

export const mergesQuery = {
  queryKey: ['merges'],
  queryFn: () => api.get<{ items: IPendingMerge[] }>('/api/admin/merges'),
};
