// Страница пользователя (админка → Пользователи → имя): роль и доступ, пароль, ключи доступа, открытые входы
// и журнал входа этого человека — всё, что нужно, чтобы разобраться с одной учётной записью: дать или
// забрать доступ, сбросить пароль, убрать потерянный ключ, закрыть вход с чужого устройства.
// Только для права users.manage; сервер проверяет его сам на каждом запросе.

import { FC } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';

import { LoadingSkeleton } from '../../components/LoadingSkeleton';
import { ApiError, api } from '../../api/client';
import type { IUserRow } from '../../api/types';
import { AuthEventLog } from '../../components/admin/users/AuthEventLog';
import { UserAccess } from '../../components/admin/users/UserAccess';
import { UserPasskeys } from '../../components/admin/users/UserPasskeys';
import { UserSessionList } from '../../components/admin/users/UserSessionList';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ButtonLink } from '../../components/ui/ButtonLink';
import { Callout } from '../../components/ui/Callout';
import { Cluster } from '../../components/ui/Cluster';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageHeader } from '../../components/ui/PageHeader';
import { Section } from '../../components/ui/Section';
import { Stack } from '../../components/ui/Stack';
import { useAuth, useCan } from '../../hooks/useAuth';
import { USER_ROLE_LABELS } from '../../lib/labels';
import { describeLoadError } from '../../lib/loadError';
import styles from './UserPage.module.css';

const EYEBROW = 'Админка · Пользователи';

export const UserPage: FC = () => {
  const allowed = useCan('users.manage');
  const { user: me } = useAuth();
  const { id } = useParams();
  const userId = Number(id);
  const valid = Number.isSafeInteger(userId) && userId > 0;

  const userQuery = useQuery({
    queryKey: ['users', userId],
    queryFn: () => api.get<IUserRow>(`/api/users/${userId}`),
    enabled: allowed && valid,
  });

  if (!allowed) {
    return (
      <Stack gap={4}>
        <PageHeader eyebrow={EYEBROW} title="Пользователь" />
        <EmptyState>Пользователями управляет администратор.</EmptyState>
      </Stack>
    );
  }
  const missing = !valid || (userQuery.error instanceof ApiError && userQuery.error.status === 404);
  if (missing) {
    return (
      <Stack gap={4}>
        <PageHeader eyebrow={EYEBROW} title="Пользователь не найден" />
        <div>
          <ButtonLink to="/admin/users">К пользователям</ButtonLink>
        </div>
      </Stack>
    );
  }
  if (userQuery.isLoading) {
    return (
      <Stack gap={4}>
        <PageHeader eyebrow={EYEBROW} title="Пользователь" />
        <LoadingSkeleton label="Загружаю пользователя…" lines={4} height="44px" />
      </Stack>
    );
  }
  const user = userQuery.data;
  if (userQuery.isError || !user) {
    return (
      <Stack gap={4}>
        <PageHeader eyebrow={EYEBROW} title="Пользователь" />
        <Callout tone="danger" title="Пользователь не загрузился" action={<Button onClick={() => void userQuery.refetch()}>Повторить</Button>}>
          {describeLoadError(userQuery.error)}
        </Callout>
      </Stack>
    );
  }

  const self = user.id === me.id;
  return (
    <Stack gap={4} className={styles.page}>
      <PageHeader
        eyebrow={EYEBROW}
        title={user.displayName}
        meta={
          <Cluster gap={2}>
            <span className={styles.login}>{user.login}</span>
            {user.registration === 'approved' && <Badge tone="accent">{USER_ROLE_LABELS[user.role]}</Badge>}
            {user.registration === 'pending' && <Badge tone="info">заявка</Badge>}
            {user.registration === 'rejected' && <Badge>заявка отклонена</Badge>}
            {user.registration === 'approved' && !user.isActive && <Badge tone="warning">доступ выключен</Badge>}
            {self && <Badge>это вы</Badge>}
          </Cluster>
        }
      />

      <Section title="Доступ">
        <UserAccess user={user} self={self} />
      </Section>

      <Section title="Ключи доступа" note="добавляет сам пользователь в профиле">
        <UserPasskeys user={user} />
      </Section>

      <Section title="Открытые входы">
        <UserSessionList user={user} />
      </Section>

      <Section title="Журнал входа" note="новые сверху">
        <AuthEventLog userId={user.id} />
      </Section>
    </Stack>
  );
};
