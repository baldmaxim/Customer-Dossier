import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { api } from '../../api/client';
import { centerKey, graphSearch, type IGraphCenter, type IGraphFilters, type IGraphResponse } from './graphModel';

/**
 * Схема вокруг центра. Смена фильтра не стирает схему: прежняя остаётся на экране приглушённой,
 * пока строится новая (раскладка не прыгает). Смена центра — стирает: схема прежнего центра
 * под новым заголовком читалась бы как его связи.
 */
export const useGraphQuery = (
  center: IGraphCenter | null,
  filters: IGraphFilters,
  enabled = true,
): UseQueryResult<IGraphResponse> => {
  const key = centerKey(center);
  const search = center ? graphSearch(center, filters) : '';
  return useQuery({
    queryKey: ['graph', key, search],
    queryFn: () => api.get<IGraphResponse>(`/api/graph?${search}`),
    enabled: enabled && center !== null,
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[1] === key ? previous : undefined),
  });
};
