// Пользователи портала (ADR-014): заявки на доступ, кто входит, с какой ролью, откуда, и журнал входа.
// Только для права users.manage; сервер проверяет его сам на каждом запросе.
//
// Учётную запись заводит сам человек — заявкой с экрана входа; администратор одобряет её с ролью
// или отклоняет. Блок заявок — наверху и только когда они есть; отклонённые — свёрнуты под списком
// пользователей (передумать можно). Первый администратор и восстановление — консоль сервера.

import { FC } from 'react';
import { useQuery } from '@tanstack/react-query';

import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { api } from '../../api/client';
import type { IUserRow } from '../../api/types';
import { AuthEventLog } from '../../components/admin/users/AuthEventLog';
import { RegistrationRequests } from '../../components/admin/users/RegistrationRequests';
import { RoleMatrix } from '../../components/admin/users/RoleMatrix';
import { UsersList } from '../../components/admin/users/UsersList';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { Disclosure } from '../../components/ui/Disclosure';
import { EmptyState } from '../../components/ui/EmptyState';
import { Section } from '../../components/ui/Section';
import { Stack } from '../../components/ui/Stack';
import { useCan } from '../../hooks/useAuth';
import { formatCount } from '../../lib/format';
import { describeLoadError } from '../../lib/loadError';

/** Заявки — новые сверху: чаще всего ждут ту, о которой только что сказали. */
const newestFirst = (rows: IUserRow[]): IUserRow[] => [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);

export const UsersPage: FC = () => {
  const allowed = useCan('users.manage');

  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<{ items: IUserRow[] }>('/api/users'),
    enabled: allowed,
  });

  if (!allowed) return <EmptyState>Пользователями управляет администратор.</EmptyState>;

  const all = usersQuery.data?.items ?? [];
  const users = all.filter(u => u.registration === 'approved');
  const requests = newestFirst(all.filter(u => u.registration === 'pending'));
  const rejected = newestFirst(all.filter(u => u.registration === 'rejected'));

  return (
    <Stack gap={4}>
      {requests.length > 0 && (
        <Section title={`Заявки на доступ (${formatCount(requests.length)})`} note="войти можно только после одобрения">
          <RegistrationRequests requests={requests} />
        </Section>
      )}

      <Section title="Пользователи" note={usersQuery.isSuccess ? `всего ${formatCount(users.length)}` : undefined}>
        <Stack gap={4}>
          {usersQuery.isLoading && <LoadingSkeleton label="Загружаю пользователей…" lines={3} height="56px" />}
          {usersQuery.isError && (
            <Callout tone="danger" title="Список не загрузился" action={<Button onClick={() => void usersQuery.refetch()}>Повторить</Button>}>
              {describeLoadError(usersQuery.error)}
            </Callout>
          )}
          {usersQuery.isSuccess && users.length === 0 && (
            <EmptyState size="sm">Пользователей нет — портал работает локально, без входа.</EmptyState>
          )}
          {users.length > 0 && <UsersList users={users} />}
          {rejected.length > 0 && (
            <Disclosure summary="Отклонённые заявки" meta={formatCount(rejected.length)}>
              <RegistrationRequests requests={rejected} rejected />
            </Disclosure>
          )}
        </Stack>
      </Section>

      <Section title="Роли и права">
        <RoleMatrix />
      </Section>

      <Section title="Журнал входа" note="новые сверху">
        <AuthEventLog />
      </Section>
    </Stack>
  );
};
