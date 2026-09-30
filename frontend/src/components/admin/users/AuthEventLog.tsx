// Журнал входа и действий с пользователями — новые сверху, страницами. Причина неудачного
// входа видна только здесь: пользователь всегда получает одно и то же «неверный логин или пароль».

import { FC } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';

import { api } from '../../../api/client';
import type { IAuthEventRow, UserRole } from '../../../api/types';
import {
  AUTH_ACTOR_LABELS,
  AUTH_EVENT_LABELS,
  LOGIN_FAILURE_LABELS,
  USER_ROLE_LABELS,
  formatDateTime,
} from '../../../lib/labels';
import { describeLoadError } from '../../../lib/loadError';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/Section';
import { TableScroll } from '../../ui/TableScroll';
import styles from './Users.module.css';

interface IPage {
  items: IAuthEventRow[];
  nextBefore: number | null;
}

const isRole = (v: unknown): v is UserRole => v === 'admin' || v === 'operator' || v === 'viewer';

/** Подробности события словами: причина отказа, смена роли, сколько входов закрыто. */
export const describeEventDetails = (e: IAuthEventRow): string => {
  const d = e.details;
  const parts: string[] = [];
  if (typeof d.reason === 'string') parts.push(LOGIN_FAILURE_LABELS[d.reason] ?? 'другая причина');
  if (d.locked === true) parts.push('вход закрыт на время');
  const role = d.role as { from?: unknown; to?: unknown } | string | undefined;
  if (typeof role === 'object' && role !== null && isRole(role.from) && isRole(role.to)) {
    parts.push(`роль: ${USER_ROLE_LABELS[role.from]} → ${USER_ROLE_LABELS[role.to]}`);
  } else if (isRole(role)) {
    parts.push(`роль: ${USER_ROLE_LABELS[role]}`);
  }
  if (d.displayName === true) parts.push('имя изменено');
  if (typeof d.revokedSessions === 'number' && d.revokedSessions > 0) parts.push(`закрыто входов: ${d.revokedSessions}`);
  return parts.join(' · ');
};

export const AuthEventLog: FC = () => {
  const eventsQuery = useInfiniteQuery({
    queryKey: ['auth-events'],
    queryFn: ({ pageParam }) => api.get<IPage>(`/api/users/events?limit=50${pageParam === null ? '' : `&before=${pageParam}`}`),
    initialPageParam: null as number | null,
    getNextPageParam: last => last.nextBefore,
  });

  if (eventsQuery.isError) return <p role="alert">{describeLoadError(eventsQuery.error)}</p>;
  const items = eventsQuery.data?.pages.flatMap(p => p.items) ?? [];
  if (eventsQuery.isSuccess && items.length === 0) return <EmptyState>Событий пока нет.</EmptyState>;

  return (
    <>
      <TableScroll minWidth={720}>
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
              <td className={styles.nowrap}>{formatDateTime(e.at)}</td>
              <td>
                {AUTH_EVENT_LABELS[e.event] ?? 'другое событие'}
                {describeEventDetails(e) && <span className={styles.eventDetails}>{describeEventDetails(e)}</span>}
              </td>
              <td>{e.userLogin ?? '—'}</td>
              <td>{AUTH_ACTOR_LABELS[e.actor] ?? e.actor}</td>
              <td className={styles.mono}>{e.ip ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </TableScroll>
      {eventsQuery.hasNextPage && (
        <div className={styles.more}>
          <Button disabled={eventsQuery.isFetchingNextPage} onClick={() => void eventsQuery.fetchNextPage()}>
            Показать ещё
          </Button>
        </div>
      )}
    </>
  );
};
