// Пользователи портала (ADR-014): кто входит, с какой ролью, откуда, и журнал входа.
// Только для права users.manage; сервер проверяет его сам на каждом запросе.

import { FC, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../../api/client';
import type { IUserRow } from '../../api/types';
import { AuthEventLog } from '../../components/admin/users/AuthEventLog';
import { RoleMatrix } from '../../components/admin/users/RoleMatrix';
import { UserCreateForm } from '../../components/admin/users/UserCreateForm';
import { UsersTable } from '../../components/admin/users/UsersTable';
import { EmptyState, Section } from '../../components/ui/Section';
import { useCan } from '../../hooks/useAuth';
import { describeLoadError } from '../../lib/loadError';
import { Notice } from './AdminLayout';

export const UsersPage: FC = () => {
  const allowed = useCan('users.manage');
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);

  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<{ items: IUserRow[] }>('/api/users'),
    enabled: allowed,
  });

  if (!allowed) return <EmptyState>Пользователями управляет администратор.</EmptyState>;

  const users = usersQuery.data?.items ?? [];

  return (
    <>
      {notice && <Notice text={notice} onClose={() => setNotice(null)} />}

      <Section title="Пользователи" note={usersQuery.isSuccess ? `всего ${users.length}` : undefined}>
        {usersQuery.isError && <p role="alert">{describeLoadError(usersQuery.error)}</p>}
        {usersQuery.isSuccess && users.length === 0 && <EmptyState>Пользователей нет — портал работает локально, без входа.</EmptyState>}
        {users.length > 0 && <UsersTable users={users} onNotice={setNotice} />}
      </Section>

      <Section title="Новый пользователь" note="пароль для первого входа пользователь сменит сам">
        <UserCreateForm
          onError={setNotice}
          onCreated={(user, password) => {
            setNotice(`Создан ${user.login}. Пароль для первого входа: ${password} — передайте пользователю, при входе он задаст свой.`);
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
    </>
  );
};
