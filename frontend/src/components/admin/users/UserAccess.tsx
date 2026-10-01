// Доступ пользователя на его странице: роль и доступ (с подтверждением — useUserActions), пароль и блокировка,
// последний вход, откуда взялась учётная запись. Свою роль и доступ администратор не меняет — сервер тоже откажет.

import { FC, useState } from 'react';

import type { IUserRow } from '../../../api/types';
import { AUTH_ACTOR_LABELS, formatDateTime } from '../../../lib/labels';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Callout } from '../../ui/Callout';
import { DescriptionList } from '../../ui/DescriptionList';
import { Stack } from '../../ui/Stack';
import { Switch } from '../../ui/Switch';
import { PasswordResetDialog } from './PasswordResetDialog';
import { UserRoleSelect } from './UserRoleSelect';
import { useUserActions } from './useUserActions';
import styles from './Users.module.css';

const origin = (user: IUserRow): string => {
  if (user.createdBy === user.login) return 'по заявке с экрана входа';
  return `завёл: ${AUTH_ACTOR_LABELS[user.createdBy] ?? user.createdBy}`;
};

export const UserAccess: FC<{ user: IUserRow; self: boolean }> = ({ user, self }) => {
  const actions = useUserActions();
  // Снимок строки на момент нажатия: после сброса список перечитывается, и новая строка
  // перезапустила бы окно — выданный пароль пропал бы с экрана до того, как его передали.
  const [resetOf, setResetOf] = useState<IUserRow | null>(null);
  const approved = user.registration === 'approved';

  return (
    <Stack gap={4}>
      {!approved && (
        <Callout tone="info">
          {user.registration === 'pending'
            ? 'Это заявка на доступ: одобрить или отклонить её можно в списке пользователей.'
            : 'Заявка отклонена: одобрить её можно в списке пользователей, в «Отклонённых заявках».'}
        </Callout>
      )}
      <DescriptionList
        items={[
          { label: 'Роль', value: approved ? <UserRoleSelect user={user} self={self} actions={actions} /> : 'заявка, роль — при одобрении' },
          {
            label: 'Доступ',
            value: approved ? (
              <Switch
                checked={user.isActive}
                label={`Доступ: ${user.displayName}`}
                disabled={self || actions.isUpdating(user)}
                onText="есть"
                offText="выключен"
                onChange={next => void actions.setActive(user, next)}
              />
            ) : (
              'нет, пока заявка не одобрена'
            ),
          },
          {
            label: 'Пароль',
            value: (
              <Stack gap={1}>
                <span>сменён {formatDateTime(user.passwordChangedAt)}</span>
                {user.mustChangePassword && (
                  <span>
                    <Badge>сменит пароль при входе</Badge>
                  </span>
                )}
                {user.lockedUntil && (
                  <span className={styles.meta}>
                    вход по паролю закрыт до {formatDateTime(user.lockedUntil)} после неудачных попыток; сброс пароля снимет
                    блокировку, ключ доступа работает и сейчас
                  </span>
                )}
              </Stack>
            ),
          },
          { label: 'Последний вход', value: user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'не входил' },
          { label: 'Учётная запись', value: `создана ${formatDateTime(user.createdAt)}, ${origin(user)}` },
        ]}
      />
      {!self && approved && (
        <div>
          <Button onClick={() => setResetOf(user)}>Сбросить пароль</Button>
        </div>
      )}
      <PasswordResetDialog user={resetOf} onClose={() => setResetOf(null)} />
    </Stack>
  );
};
