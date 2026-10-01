// Открытые входы пользователя: откуда и когда. Закрыть можно любой, кроме того, из которого
// смотрит сам администратор, — для него есть «Выйти». Закрытие — с подтверждением: человек
// на том конце потеряет несохранённую работу. Ответ — в самом блоке на странице пользователя
// (список обновляется, отказ — плашкой рядом с ним, а не тостом внизу экрана).

import { FC, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../../../api/client';
import type { IUserRow, IUserSessionRow } from '../../../api/types';
import { formatDateTime } from '../../../lib/labels';
import { describeLoadError } from '../../../lib/loadError';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Callout } from '../../ui/Callout';
import { useConfirm } from '../../ui/confirm';
import { EmptyState } from '../../ui/EmptyState';
import { Loading } from '../../ui/Loading';
import { Stack } from '../../ui/Stack';
import { actionError } from '../actionError';
import { describeAgent } from './describeAgent';
import styles from './Users.module.css';

export const UserSessionList: FC<{ user: IUserRow }> = ({ user }) => {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const sessionsQuery = useQuery({
    queryKey: ['users', user.id, 'sessions'],
    queryFn: () => api.get<{ items: IUserSessionRow[] }>(`/api/users/${user.id}/sessions`),
  });

  const revoke = useMutation({
    mutationFn: (sessionId: number) => api.post(`/api/users/${user.id}/sessions/${sessionId}/revoke`),
    onSuccess: () => {
      setError(null);
      // ['users'] — префикс и списка входов этого пользователя: закрытый вход пропадёт из окна.
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      void queryClient.invalidateQueries({ queryKey: ['auth-events'] });
    },
    onError: (err: Error) => setError(actionError(err)),
  });

  const askRevoke = async (session: IUserSessionRow): Promise<void> => {
    const ok = await confirm({
      title: 'Закрыть этот вход?',
      body: `${describeAgent(session.userAgent)}${session.ip ? `, ${session.ip}` : ''}. Пользователю ${user.login} придётся войти заново.`,
      confirmLabel: 'Закрыть вход',
      tone: 'danger',
    });
    if (ok) revoke.mutate(session.id);
  };

  if (sessionsQuery.isLoading) return <Loading label="Загружаю входы…" />;
  if (sessionsQuery.isError) {
    return (
      <Callout tone="danger" title="Входы не загрузились" action={<Button onClick={() => void sessionsQuery.refetch()}>Повторить</Button>}>
        {describeLoadError(sessionsQuery.error)}
      </Callout>
    );
  }
  const items = sessionsQuery.data?.items ?? [];
  if (items.length === 0) return <EmptyState size="sm">Открытых входов нет.</EmptyState>;

  return (
    <Stack gap={3}>
      {error && (
        <Callout tone="danger" onClose={() => setError(null)}>
          {error}
        </Callout>
      )}
      <ul className={styles.sessions}>
        {items.map(s => (
          <li key={s.id} className={styles.session}>
            <span className={styles.sessionMain}>
              {describeAgent(s.userAgent)}
              {s.ip && <span className={styles.mono}> · {s.ip}</span>}
              {s.current && (
                <>
                  {' '}
                  <Badge tone="info">это вы</Badge>
                </>
              )}
            </span>
            <span className={styles.sessionMeta}>
              вход {formatDateTime(s.createdAt)} · активность {formatDateTime(s.lastSeenAt)}
            </span>
            {!s.current && (
              <Button size="sm" variant="danger" loading={revoke.isPending && revoke.variables === s.id} onClick={() => void askRevoke(s)}>
                Закрыть вход
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Stack>
  );
};
