// Пользователи: роль, доступ, последний вход, открытые входы, сброс пароля.
// Свою роль и свой доступ администратор не меняет — сервер тоже откажет (`self_change`).

import { FC, Fragment, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '../../../api/client';
import type { IUserRow, UserRole } from '../../../api/types';
import { useAuth } from '../../../hooks/useAuth';
import { USER_ROLE_LABELS, formatDateTime } from '../../../lib/labels';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Switch } from '../../ui/Switch';
import { TableScroll } from '../../ui/TableScroll';
import { PasswordResetForm } from './PasswordResetForm';
import { UserSessions } from './UserSessions';
import adminStyles from '../../../pages/AdminPage.module.css';
import styles from './Users.module.css';

const ROLES: UserRole[] = ['viewer', 'operator', 'admin'];

interface IUsersTableProps {
  users: IUserRow[];
  onNotice: (text: string) => void;
}

type Panel = { userId: number; kind: 'sessions' | 'password' } | null;

export const UsersTable: FC<IUsersTableProps> = ({ users, onNotice }) => {
  const queryClient = useQueryClient();
  const { user: me } = useAuth();
  const [panel, setPanel] = useState<Panel>(null);

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['users'] });
    void queryClient.invalidateQueries({ queryKey: ['auth-events'] });
  };

  const update = useMutation({
    mutationFn: ({ user, patch }: { user: IUserRow; patch: { role?: UserRole; isActive?: boolean } }) =>
      api.patch<IUserRow>(`/api/users/${user.id}`, { expectedVersion: user.version, ...patch }),
    onSuccess: (updated, { user, patch }) => {
      if (patch.isActive === false) onNotice(`${user.displayName}: доступ выключен, открытые входы закрыты.`);
      else if (patch.isActive === true) onNotice(`${user.displayName}: доступ включён.`);
      else onNotice(`${user.displayName}: роль — ${USER_ROLE_LABELS[updated.role]}. Действует сразу, без повторного входа.`);
      refresh();
    },
    onError: (err: Error) => {
      onNotice(err.message);
      refresh();
    },
  });

  const toggle = (userId: number, kind: 'sessions' | 'password'): void =>
    setPanel(p => (p?.userId === userId && p.kind === kind ? null : { userId, kind }));

  return (
    <TableScroll minWidth={820}>
      <thead>
        <tr>
          <th>Пользователь</th>
          <th>Роль</th>
          <th>Доступ</th>
          <th>Последний вход</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {users.map(u => {
          const self = u.id === me.id;
          return (
            <Fragment key={u.id}>
              <tr>
                <td>
                  <span className={adminStyles.sourceTitle}>
                    {u.displayName}
                    {self && <span className={styles.current}> · это вы</span>}
                  </span>
                  <span className={adminStyles.sourceKey}>{u.login}</span>
                  <span className={styles.badges}>
                    {u.mustChangePassword && <Badge hint="пароль выдан администратором; при входе пользователь задаст свой">сменит пароль</Badge>}
                    {u.lockedUntil && (
                      <Badge tone="warn" hint="после серии неудачных попыток; сброс пароля снимает блокировку">
                        вход закрыт до {formatDateTime(u.lockedUntil)}
                      </Badge>
                    )}
                  </span>
                </td>
                <td>
                  <select
                    aria-label={`Роль: ${u.displayName}`}
                    value={u.role}
                    disabled={self || update.isPending}
                    onChange={e => update.mutate({ user: u, patch: { role: e.target.value as UserRole } })}
                  >
                    {ROLES.map(r => (
                      <option key={r} value={r}>
                        {USER_ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <Switch
                    checked={u.isActive}
                    label={`Доступ: ${u.displayName}`}
                    disabled={self || update.isPending}
                    onText="есть"
                    offText="выключен"
                    onChange={next => update.mutate({ user: u, patch: { isActive: next } })}
                  />
                </td>
                <td>
                  {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'не входил'}
                  <span className={adminStyles.sourceKey}>открытых входов: {u.liveSessions ?? 0}</span>
                </td>
                <td>
                  <div className={adminStyles.rowActions}>
                    <Button size="sm" onClick={() => toggle(u.id, 'sessions')}>
                      Входы
                    </Button>
                    {!self && (
                      <Button size="sm" onClick={() => toggle(u.id, 'password')}>
                        Сбросить пароль
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
              {panel?.userId === u.id && (
                <tr>
                  <td colSpan={5}>
                    {panel.kind === 'sessions' ? (
                      <UserSessions user={u} onNotice={onNotice} onClose={() => setPanel(null)} />
                    ) : (
                      <PasswordResetForm
                        user={u}
                        onCancel={() => setPanel(null)}
                        onError={onNotice}
                        onDone={(updated, password) => {
                          setPanel(null);
                          onNotice(`Новый пароль для ${updated.login}: ${password} — передайте пользователю. При входе он задаст свой.`);
                          refresh();
                        }}
                      />
                    )}
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </TableScroll>
  );
};
