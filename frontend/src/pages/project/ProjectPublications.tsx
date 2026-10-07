// Публикации об объекте (ADR-016): общей ленты в портале нет — публикации об объекте живут здесь,
// вместе с очередями и корпусами. Строка — та же карточка, что в читалке компании (PublicationCard: дата,
// канал, заголовок или тема с пометкой «тема от модели»); пост открывается окном поверх страницы
// (PublicationModal — тот же TelegramPost), а не уводит со страницы объекта. Читалка «в один экран» здесь не
// подходит: публикации — один из разделов страницы.

import { FC, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';

import { api } from '../../api/client';
import type { IPublicationRow } from '../../api/types';
import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import type { IPublicationListItem } from '../../components/PublicationBrowser';
import { PublicationModal } from '../../components/PublicationModal';
import { PublicationCard } from '../../components/publication/PublicationCard';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { EmptyState } from '../../components/ui/EmptyState';
import { describeLoadError } from '../../lib/loadError';
import browserStyles from '../../components/PublicationBrowser.module.css';
import styles from '../ProjectPage.module.css';

const toListItem = (row: IPublicationRow): IPublicationListItem => ({
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
});

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
  // Окно смонтировано после первого открытия: закрытие доигрывает анимацию и возвращает фокус на карточку.
  const [shown, setShown] = useState<IPublicationListItem | null>(null);
  const [open, setOpen] = useState(false);

  if (query.isLoading) return <LoadingSkeleton label="Загружаю публикации об объекте…" lines={3} height="88px" radius="md" />;
  if (query.isError) {
    return (
      <Callout tone="danger" title="Публикации не загрузились" action={<Button onClick={() => void query.refetch()}>Повторить</Button>}>
        {describeLoadError(query.error)}
      </Callout>
    );
  }
  const items = (query.data?.pages ?? []).flatMap(p => p.items.map(toListItem));
  if (items.length === 0) return <EmptyState size="sm">В собранных публикациях об объекте ничего не найдено.</EmptyState>;

  return (
    <>
      <ul className={browserStyles.items} aria-label="Публикации об объекте">
        {items.map(item => (
          <PublicationCard
            key={item.key}
            item={item}
            active={open && shown?.key === item.key}
            onOpen={() => {
              setShown(item);
              setOpen(true);
            }}
            buttonRef={null}
          />
        ))}
      </ul>
      {query.hasNextPage && (
        <div className={styles.more}>
          <Button loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
            Показать ещё
          </Button>
        </div>
      )}
      {shown && <PublicationModal source={shown} open={open} onClose={() => setOpen(false)} />}
    </>
  );
};
