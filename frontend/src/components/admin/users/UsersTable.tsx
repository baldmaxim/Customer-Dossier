// Пользователи таблицей (от 900px): роль, доступ, последний вход, входы и сброс пароля.

import { FC } from 'react';

import { formatCount } from '../../../lib/format';
import { formatDateTime } from '../../../lib/labels';
import { Button } from '../../ui/Button';
import { Cluster } from '../../ui/Cluster';
import { Switch } from '../../ui/Switch';
import { TableScroll } from '../../ui/TableScroll';
import { VisuallyHidden } from '../../ui/VisuallyHidden';
import { UserIdentity } from './UserIdentity';
import { UserRoleSelect } from './UserRoleSelect';
import type { IUsersViewProps } from './UsersList';
import styles from './Users.module.css';

export const UsersTable: FC<IUsersViewProps> = ({ users, meId, actions, onSessions, onResetPassword }) => (
  <TableScroll label="Пользователи" minWidth={820}>
    <thead>
      <tr>
        <th>Пользователь</th>
        <th>Роль</th>
        <th>Доступ</th>
        <th>Последний вход</th>
        <th>
          <VisuallyHidden>Действия</VisuallyHidden>
        </th>
      </tr>
    </thead>
    <tbody>
      {users.map(u => {
        const self = u.id === meId;
        return (
          <tr key={u.id}>
            <td>
              <UserIdentity user={u} self={self} />
            </td>
            <td className={styles.roleCell}>
              <UserRoleSelect user={u} self={self} actions={actions} />
            </td>
            <td>
              <Switch
                checked={u.isActive}
                label={`Доступ: ${u.displayName}`}
                disabled={self || actions.isUpdating(u)}
                onText="есть"
                offText="выключен"
                onChange={next => void actions.setActive(u, next)}
              />
            </td>
            <td>
              <span className="nowrap">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'не входил'}</span>
              <span className={styles.meta}>открытых входов: {formatCount(u.liveSessions ?? 0)}</span>
            </td>
            <td>
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
            </td>
          </tr>
        );
      })}
    </tbody>
  </TableScroll>
);
