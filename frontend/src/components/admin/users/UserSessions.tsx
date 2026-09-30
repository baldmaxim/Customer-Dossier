// Открытые входы пользователя: откуда и когда. Закрыть можно любой, кроме того, из которого
// смотрит сам администратор, — для него есть «Выйти».

import { FC } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../../../api/client';
import type { IUserRow, IUserSessionRow } from '../../../api/types';
import { formatDateTime } from '../../../lib/labels';
import { describeLoadError } from '../../../lib/loadError';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/Section';
import styles from './Users.module.css';

/** Браузер и система словами: строка User-Agent целиком нечитаема и не нужна. */
export const describeAgent = (ua: string | null): string => {
  if (!ua) return 'неизвестно';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : null;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /YaBrowser\//.test(ua)
      ? 'Яндекс Браузер'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : null;
  return [browser, os].filter(Boolean).join(', ') || 'другой клиент';
};

interface IUserSessionsProps {
  user: IUserRow;
  onNotice: (text: string) => void;
  onClose: () => void;
}

export const UserSessions: FC<IUserSessionsProps> = ({ user, onNotice, onClose }) => {
  const queryClient = useQueryClient();
  const sessionsQuery = useQuery({
    queryKey: ['users', user.id, 'sessions'],
    queryFn: () => api.get<{ items: IUserSessionRow[] }>(`/api/users/${user.id}/sessions`),
  });

  const revoke = useMutation({
    mutationFn: (sessionId: number) => api.post(`/api/users/${user.id}/sessions/${sessionId}/revoke`),
    onSuccess: () => {
      onNotice(`Вход пользователя ${user.login} закрыт.`);
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      void queryClient.invalidateQueries({ queryKey: ['auth-events'] });
    },
    onError: (err: Error) => onNotice(err.message),
  });

  const items = sessionsQuery.data?.items ?? [];

  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <strong>Открытые входы: {user.displayName}</strong>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Свернуть
        </Button>
      </div>
      {sessionsQuery.isError && <p role="alert">{describeLoadError(sessionsQuery.error)}</p>}
      {sessionsQuery.isSuccess && items.length === 0 && <EmptyState>Открытых входов нет.</EmptyState>}
      {items.length > 0 && (
        <ul className={styles.sessions}>
          {items.map(s => (
            <li key={s.id} className={styles.session}>
              <span className={styles.sessionMain}>
                {describeAgent(s.userAgent)}
                {s.ip && <span className={styles.mono}> · {s.ip}</span>}
                {s.current && <span className={styles.current}> · это вы</span>}
              </span>
              <span className={styles.sessionMeta}>
                вход {formatDateTime(s.createdAt)} · активность {formatDateTime(s.lastSeenAt)}
              </span>
              {!s.current && (
                <Button size="sm" variant="danger" disabled={revoke.isPending} onClick={() => revoke.mutate(s.id)}>
                  Закрыть
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
