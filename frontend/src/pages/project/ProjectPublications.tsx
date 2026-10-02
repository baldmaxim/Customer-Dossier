// Публикации об объекте (ADR-016): общей ленты в портале нет — публикации об объекте живут здесь,
// вместе с очередями и корпусами. Строка — источник, дата и тема или начало текста; ведёт на страницу
// публикации. Тема — подпись, составленная моделью, когда у публикации нет заголовка.

import { FC } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';

import { api } from '../../api/client';
import type { IPublicationRow } from '../../api/types';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { CardList } from '../../components/ui/CardList';
import { CardListItem } from '../../components/ui/CardListItem';
import { EmptyState } from '../../components/ui/EmptyState';
import { formatDate, sourceLabel } from '../../lib/labels';
import { describeLoadError } from '../../lib/loadError';
import styles from '../ProjectPage.module.css';

const SNIPPET_CHARS = 140;

const headline = (row: IPublicationRow): string => {
  const text = row.title ?? row.topic ?? row.snippet;
  return text.length > SNIPPET_CHARS ? `${text.slice(0, SNIPPET_CHARS).trimEnd()}…` : text;
};

export const ProjectPublications: FC<{ projectId: number }> = ({ projectId }) => {
  const query = useInfiniteQuery({
    queryKey: ['project', projectId, 'publications'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: '20' });
      if (pageParam) params.set('cursor', pageParam);
      return api.get<{ items: IPublicationRow[]; nextCursor: string | null }>(`/api/projects/${projectId}/publications?${params}`);
    },
    getNextPageParam: last => last.nextCursor,
  });

  if (query.isLoading) return <LoadingSkeleton label="Загружаю публикации об объекте…" lines={3} height="44px" />;
  if (query.isError) {
    return (
      <Callout tone="danger" title="Публикации не загрузились" action={<Button onClick={() => void query.refetch()}>Повторить</Button>}>
        {describeLoadError(query.error)}
      </Callout>
    );
  }
  const rows = query.data?.pages.flatMap(p => p.items) ?? [];
  if (rows.length === 0) return <EmptyState size="sm">В собранных публикациях об объекте ничего не найдено.</EmptyState>;

  return (
    <>
      <CardList label="Публикации об объекте">
        {rows.map(row => (
          <CardListItem
            key={row.itemId}
            to={row.documentId ? `/documents/${row.documentId}` : undefined}
            title={headline(row)}
            meta={[sourceLabel(row), formatDate(row.publishedAt ?? row.observedAt)].filter(Boolean).join(' · ')}
          />
        ))}
      </CardList>
      {query.hasNextPage && (
        <div className={styles.more}>
          <Button loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
            Показать ещё
          </Button>
        </div>
      )}
    </>
  );
};
