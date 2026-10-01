// Пользователи карточками (уже 900px): кто, роль и доступ, последний вход, действия внизу.

import { FC } from 'react';

import { formatCount } from '../../../lib/format';
import { formatDateTime } from '../../../lib/labels';
import { Button } from '../../ui/Button';
import { CardList } from '../../ui/CardList';
import { CardListItem } from '../../ui/CardListItem';
import { Cluster } from '../../ui/Cluster';
import { Stack } from '../../ui/Stack';
import { Switch } from '../../ui/Switch';
import { VisuallyHidden } from '../../ui/VisuallyHidden';
import { UserIdentity } from './UserIdentity';
import { UserRoleSelect } from './UserRoleSelect';
import { userPath, type IUsersViewProps } from './UsersList';
import styles from './Users.module.css';

export const UserCards: FC<IUsersViewProps> = ({ users, meId, actions, onResetPassword }) => (
  <CardList label="Пользователи">
    {users.map(u => {
      const self = u.id === meId;
      return (
        <CardListItem
          key={u.id}
          title={<UserIdentity user={u} self={self} to={userPath(u)} />}
          actions={
            self ? undefined : (
              <Button size="sm" variant="ghost" onClick={() => onResetPassword(u)}>
                Сбросить пароль<VisuallyHidden> «{u.displayName}»</VisuallyHidden>
              </Button>
            )
          }
        >
          <Stack gap={2}>
            <Cluster gap={[2, 3]}>
              <UserRoleSelect user={u} self={self} actions={actions} />
              <Switch
                checked={u.isActive}
                label={`Доступ: ${u.displayName}`}
                disabled={self || actions.isUpdating(u)}
                onText="доступ есть"
                offText="доступ выключен"
                onChange={next => void actions.setActive(u, next)}
              />
            </Cluster>
            <span className={styles.meta}>
              {u.lastLoginAt ? `вход ${formatDateTime(u.lastLoginAt)}` : 'не входил'} · открытых входов: {formatCount(u.liveSessions ?? 0)} ·
              ключей доступа: {formatCount(u.passkeys ?? 0)}
            </span>
          </Stack>
        </CardListItem>
      );
    })}
  </CardList>
);
