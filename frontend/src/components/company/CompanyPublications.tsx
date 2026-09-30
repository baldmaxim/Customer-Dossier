// Вкладка «Публикации»: читалка по публикациям, где названа компания. Под постом — что
// в нём сказано о компании (ссылками на объект и вторую сторону); открытый пост — в адресе.
//
// Лента читает /api/companies/:id/publications, а не mentions: в mentions пишет только старый
// заблокированный разбор, и на данных нового конвейера блок был бы пуст всегда.

import { FC } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';

import { api } from '../../api/client';
import type { IPublicationRow } from '../../api/types';
import { SILENT_PREDICATES, factView } from '../../lib/publicationFacts';
import { PublicationBrowser, type IPublicationListItem } from '../PublicationBrowser';

const toListItem = (row: IPublicationRow, appearIndex: number | undefined): IPublicationListItem => ({
  key: row.itemId,
  revisionId: row.revisionId,
  title: row.title,
  topic: row.topic,
  publishedAt: row.publishedAt,
  observedAt: row.observedAt,
  sourceTitle: row.sourceTitle,
  sourceKey: row.sourceKey,
  sourceKind: row.sourceKind,
  url: row.url,
  snippet: row.snippet,
  // Пустое «упоминание» не шумит: оно ничего не говорит о компании.
  factViews: row.facts.filter(f => !SILENT_PREDICATES.has(f.predicate)).map(factView),
  moreFacts: row.moreFacts,
  appearIndex,
});

export const CompanyPublications: FC<{ companyId: number }> = ({ companyId }) => {
  const query = useInfiniteQuery({
    queryKey: ['company', companyId, 'publications'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: '20' });
      if (pageParam) params.set('cursor', pageParam);
      return api.get<{ items: IPublicationRow[]; nextCursor: string | null }>(
        `/api/companies/${companyId}/publications?${params}`,
      );
    },
    getNextPageParam: last => last.nextCursor,
  });

  const items = (query.data?.pages ?? []).flatMap((page, pageIndex) =>
    page.items.map((row, i) => toListItem(row, pageIndex > 0 ? i : undefined)),
  );

  return (
    <PublicationBrowser
      items={items}
      isLoading={query.isLoading}
      error={query.error}
      hasMore={query.hasNextPage}
      loadingMore={query.isFetchingNextPage}
      onLoadMore={() => void query.fetchNextPage()}
      onRetry={() => void (query.data ? query.fetchNextPage() : query.refetch())}
      urlParam="post"
      factsTitle="Что сказано о компании"
      emptyTitle="Публикаций нет"
      empty="В собранных публикациях компания не встречается. Это значит только то, что в собранных источниках её не нашли."
    />
  );
};
