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
import type { IUsersViewProps } from './UsersList';
import styles from './Users.module.css';

export const UserCards: FC<IUsersViewProps> = ({ users, meId, actions, onSessions, onResetPassword }) => (
  <CardList label="Пользователи">
    {users.map(u => {
      const self = u.id === meId;
      return (
        <CardListItem
          key={u.id}
          title={<UserIdentity user={u} self={self} />}
          actions={
            <Cluster gap={1}>
              <Button size="sm" variant="ghost" onClick={() => onSessions(u)}>
                Входы<VisuallyHidden> «{u.displayName}»</VisuallyHidden>
              </Button>
              {!self && (
                <Button size="sm" variant="ghost" onClick={() => onResetPassword(u)}>
                  Сбросить пароль<VisuallyHidden> «{u.displayName}»</VisuallyHidden>
                </Button>
              )}
            </Cluster>
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
              {u.lastLoginAt ? `вход ${formatDateTime(u.lastLoginAt)}` : 'не входил'} · открытых входов: {formatCount(u.liveSessions ?? 0)}
            </span>
          </Stack>
        </CardListItem>
      );
    })}
  </CardList>
);
