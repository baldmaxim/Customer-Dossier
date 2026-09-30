// Лента публикаций на главной и поиск по ней: подстрокой по тексту поста, его теме и
// названию канала. Открытый пост — в адресе (?post=): ссылкой можно поделиться, а на
// телефоне системное «Назад» закрывает его.

import { FC } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';

import { api } from '../../api/client';
import { PublicationBrowser, type IPublicationListItem } from '../PublicationBrowser';

interface IFeedItem {
  id: number;
  revisionId: number | null;
  sourceTitle: string;
  sourceKind: string;
  sourceKey: string;
  publishedAt: string | null;
  firstObservedAt: string;
  url: string | null;
  title: string | null;
  topic: string | null;
  snippet: string | null;
}

const toListItem = (row: IFeedItem, appearIndex: number | undefined): IPublicationListItem => ({
  key: row.id,
  revisionId: row.revisionId,
  title: row.title,
  topic: row.topic,
  publishedAt: row.publishedAt,
  observedAt: row.firstObservedAt,
  sourceTitle: row.sourceTitle,
  sourceKey: row.sourceKey,
  sourceKind: row.sourceKind,
  url: row.url,
  snippet: row.snippet,
  appearIndex,
});

export const PublicationFeed: FC<{ query: string }> = ({ query }) => {
  const feed = useInfiniteQuery({
    queryKey: ['feed', query],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: '30' });
      if (query.length >= 2) params.set('q', query);
      if (pageParam) params.set('cursor', pageParam);
      return api.get<{ items: IFeedItem[]; nextCursor: string | null }>(`/api/feed?${params}`);
    },
    getNextPageParam: last => last.nextCursor,
  });

  // Догруженные порции входят лесенкой: номер внутри порции — задержка появления.
  const items = (feed.data?.pages ?? []).flatMap((page, pageIndex) =>
    page.items.map((row, i) => toListItem(row, pageIndex > 0 ? i : undefined)),
  );

  return (
    <PublicationBrowser
      items={items}
      isLoading={feed.isLoading}
      error={feed.error}
      hasMore={feed.hasNextPage}
      loadingMore={feed.isFetchingNextPage}
      onLoadMore={() => void feed.fetchNextPage()}
      onRetry={() => void (feed.data ? feed.fetchNextPage() : feed.refetch())}
      urlParam="post"
      emptyTitle={query.length >= 2 ? 'Ничего не найдено' : 'Публикаций пока нет'}
      empty={
        query.length >= 2
          ? 'По этому запросу публикаций нет. Поиск идёт по тексту поста, его теме и названию канала.'
          : 'Публикации появятся, когда администратор включит источники и пройдёт первый сбор.'
      }
    />
  );
};
