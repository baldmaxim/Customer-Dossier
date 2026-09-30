// Пользователи портала (ADR-014): кто входит, с какой ролью, откуда, и журнал входа.
// Только для права users.manage; сервер проверяет его сам на каждом запросе.

import { FC, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { api } from '../../api/client';
import type { IUserRow } from '../../api/types';
import { AuthEventLog } from '../../components/admin/users/AuthEventLog';
import { IssuedPasswordDialog, type IIssuedPassword } from '../../components/admin/users/IssuedPasswordDialog';
import { RoleMatrix } from '../../components/admin/users/RoleMatrix';
import { UserCreateForm } from '../../components/admin/users/UserCreateForm';
import { UsersList } from '../../components/admin/users/UsersList';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { EmptyState } from '../../components/ui/EmptyState';
import { Section } from '../../components/ui/Section';
import { Stack } from '../../components/ui/Stack';
import { useCan } from '../../hooks/useAuth';
import { formatCount } from '../../lib/format';
import { describeLoadError } from '../../lib/loadError';

export const UsersPage: FC = () => {
  const allowed = useCan('users.manage');
  const queryClient = useQueryClient();
  // Выданный пароль показывается один раз — в окне, а не баннером вверху страницы.
  const [issued, setIssued] = useState<IIssuedPassword | null>(null);

  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<{ items: IUserRow[] }>('/api/users'),
    enabled: allowed,
  });

  if (!allowed) return <EmptyState>Пользователями управляет администратор.</EmptyState>;

  const users = usersQuery.data?.items ?? [];

  return (
    <Stack gap={5}>
      <Section title="Пользователи" note={usersQuery.isSuccess ? `всего ${formatCount(users.length)}` : undefined}>
        {usersQuery.isLoading && (
          <LoadingSkeleton label="Загружаю пользователей…" lines={3} height="56px" />
        )}
        {usersQuery.isError && (
          <Callout tone="danger" title="Список не загрузился" action={<Button onClick={() => void usersQuery.refetch()}>Повторить</Button>}>
            {describeLoadError(usersQuery.error)}
          </Callout>
        )}
        {usersQuery.isSuccess && users.length === 0 && (
          <EmptyState size="sm">Пользователей нет — портал работает локально, без входа.</EmptyState>
        )}
        {users.length > 0 && <UsersList users={users} />}
      </Section>

      <Section title="Новый пользователь" note="пароль для первого входа пользователь сменит сам">
        <UserCreateForm
          onCreated={(user, password) => {
            setIssued({ login: user.login, password });
            void queryClient.invalidateQueries({ queryKey: ['users'] });
            void queryClient.invalidateQueries({ queryKey: ['auth-events'] });
          }}
        />
      </Section>

      <Section title="Роли и права">
        <RoleMatrix />
      </Section>

      <Section title="Журнал входа" note="новые сверху">
        <AuthEventLog />
      </Section>

      <IssuedPasswordDialog issued={issued} onClose={() => setIssued(null)} />
    </Stack>
  );
};
