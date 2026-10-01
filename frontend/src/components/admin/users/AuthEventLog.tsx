// Журнал входа и действий с пользователями — новые сверху, страницами. Причина неудачного
// входа видна только здесь: пользователь всегда получает одно и то же «неверный логин или пароль».

import { FC } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';

import { api } from '../../../api/client';
import type { IAuthEventRow } from '../../../api/types';
import { useMediaQuery } from '../../../hooks/useMediaQuery';
import { AUTH_ACTOR_LABELS, AUTH_EVENT_LABELS, formatDateTime } from '../../../lib/labels';
import { describeLoadError } from '../../../lib/loadError';
import { MQ } from '../../../lib/media';
import { Button } from '../../ui/Button';
import { Callout } from '../../ui/Callout';
import { CardList } from '../../ui/CardList';
import { CardListItem } from '../../ui/CardListItem';
import { EmptyState } from '../../ui/EmptyState';
import { Loading } from '../../ui/Loading';
import { Stack } from '../../ui/Stack';
import { TableScroll } from '../../ui/TableScroll';
import { describeEventDetails } from './describeEventDetails';
import styles from './Users.module.css';

interface IPage {
  items: IAuthEventRow[];
  nextBefore: number | null;
}

/** userId — журнал одного пользователя (его страница); без него — весь журнал. */
export const AuthEventLog: FC<{ userId?: number }> = ({ userId }) => {
  const wide = useMediaQuery(MQ.sm);
  const eventsQuery = useInfiniteQuery({
    // ['auth-events'] — префикс обоих журналов: действие с пользователем обновляет и общий, и его.
    queryKey: ['auth-events', userId ?? 'all'],
    // По 20: журнал — справка, а не главное на экране; дальше — «Показать ещё».
    queryFn: ({ pageParam }) =>
      api.get<IPage>(`/api/users/events?limit=20${userId === undefined ? '' : `&userId=${userId}`}${pageParam === null ? '' : `&before=${pageParam}`}`),
    initialPageParam: null as number | null,
    getNextPageParam: last => last.nextBefore,
  });

  if (eventsQuery.isLoading) return <Loading label="Загружаю журнал входа…" />;
  if (eventsQuery.isError) {
    return (
      <Callout tone="danger" title="Журнал не загрузился" action={<Button onClick={() => void eventsQuery.refetch()}>Повторить</Button>}>
        {describeLoadError(eventsQuery.error)}
      </Callout>
    );
  }
  const items = eventsQuery.data?.pages.flatMap(p => p.items) ?? [];
  if (items.length === 0) return <EmptyState size="sm">Событий пока нет.</EmptyState>;

  const what = (e: IAuthEventRow): string => AUTH_EVENT_LABELS[e.event] ?? 'другое событие';
  const actor = (e: IAuthEventRow): string => AUTH_ACTOR_LABELS[e.actor] ?? e.actor;

  return (
    <Stack gap={3}>
      {wide ? (
        <TableScroll label="Журнал входа" minWidth={720}>
          <thead>
            <tr>
              <th>Когда</th>
              <th>Что</th>
              <th>Кто</th>
              <th>Кем</th>
              <th>Адрес</th>
            </tr>
          </thead>
          <tbody>
            {items.map(e => (
              <tr key={e.id}>
                <td className="nowrap">{formatDateTime(e.at)}</td>
                <td>
                  {what(e)}
                  {describeEventDetails(e) && <span className={styles.meta}>{describeEventDetails(e)}</span>}
                </td>
                <td className={styles.breakable}>{e.userLogin ?? '—'}</td>
                <td>{actor(e)}</td>
                <td className={`${styles.mono} ${styles.breakable}`}>{e.ip ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </TableScroll>
      ) : (
        <CardList label="Журнал входа">
          {items.map(e => (
            <CardListItem
              key={e.id}
              title={what(e)}
              meta={[e.userLogin ?? '—', actor(e) !== '—' ? `кем: ${actor(e)}` : null, e.ip].filter(Boolean).join(' · ')}
              aside={formatDateTime(e.at)}
            >
              {describeEventDetails(e) && <span className={styles.meta}>{describeEventDetails(e)}</span>}
            </CardListItem>
          ))}
        </CardList>
      )}
      {eventsQuery.hasNextPage && (
        <div>
          <Button loading={eventsQuery.isFetchingNextPage} onClick={() => void eventsQuery.fetchNextPage()}>
            Показать ещё
          </Button>
        </div>
      )}
    </Stack>
  );
};
