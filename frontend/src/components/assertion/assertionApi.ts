import { useCallback } from 'react';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';

import { api } from '../../api/client';
import type { IAssertion, IEvidenceRow, IReviewRow } from '../../api/types';

export interface IAssertionDetailResponse {
  assertion: IAssertion;
  evidence: IEvidenceRow[];
  reviews: IReviewRow[];
}

/** Сведение с цитатами и историей решений. Ключ ['assertion', id] общий с прежним кодом (инвалидация). */
export const useAssertionDetail = (assertionId: number): UseQueryResult<IAssertionDetailResponse> =>
  useQuery({
    queryKey: ['assertion', assertionId],
    queryFn: () => api.get<IAssertionDetailResponse>(`/api/assertions/${assertionId}`),
  });

/** После решения или исключения цитаты: перечитать сведение и списки сведений (очередь «Проверки»). */
export const useAssertionRefresh = (assertionId: number): (() => void) => {
  const client = useQueryClient();
  return useCallback(() => {
    void client.invalidateQueries({ queryKey: ['assertion', assertionId] });
    void client.invalidateQueries({ queryKey: ['assertions'] });
  }, [client, assertionId]);
};
