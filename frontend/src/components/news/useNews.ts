// Лента «Новое» (этап 24F): один запрос на окно, охват и вид. Меню считает непрочитанное по ленте по умолчанию —
// тот же ключ запроса, что у страницы без фильтров: React Query отдаёт её из кэша.

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { api } from '../../api/client';
import type { INewsFeed, NewsKind, NewsScope } from '../../api/types';

export const NEWS_DAYS = [7, 14, 30] as const;
export const DEFAULT_NEWS_DAYS = 14;

export interface INewsParams {
  days: number;
  scope: NewsScope;
  kind: NewsKind | null;
}

export const DEFAULT_NEWS_PARAMS: INewsParams = { days: DEFAULT_NEWS_DAYS, scope: 'all', kind: null };

/** Лента считается на сервере из собранного — пересчитывать её чаще пяти минут незачем. */
const STALE_MS = 5 * 60_000;

export const useNews = (params: INewsParams = DEFAULT_NEWS_PARAMS, enabled = true): UseQueryResult<INewsFeed> =>
  useQuery({
    queryKey: ['news', params.days, params.scope, params.kind],
    queryFn: () => {
      const q = new URLSearchParams({ days: String(params.days), scope: params.scope });
      if (params.kind) q.set('kind', params.kind);
      return api.get<INewsFeed>(`/api/news?${q.toString()}`);
    },
    staleTime: STALE_MS,
    enabled,
  });
