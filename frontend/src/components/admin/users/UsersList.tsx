// Пользователи: таблица на широком экране, карточки уже 900px. На 360px таблица показывала
// одну колонку «Пользователь», а роль, доступ, вход и действия уезжали за край.
// Входы и сброс пароля — в окнах, а не строками, вклеенными в таблицу.

import { FC, useState } from 'react';

import type { IUserRow } from '../../../api/types';
import { useAuth } from '../../../hooks/useAuth';
import { useMediaQuery } from '../../../hooks/useMediaQuery';
import { MQ } from '../../../lib/media';
import { PasswordResetDialog } from './PasswordResetDialog';
import { UserCards } from './UserCards';
import { UserSessionsDialog } from './UserSessionsDialog';
import { UsersTable } from './UsersTable';
import { useUserActions } from './useUserActions';

export interface IUsersViewProps {
  users: IUserRow[];
  /** Своя строка: свою роль и доступ администратор не меняет — сервер тоже откажет (`self_change`). */
  meId: number;
  actions: ReturnType<typeof useUserActions>;
  onSessions: (user: IUserRow) => void;
  onResetPassword: (user: IUserRow) => void;
}

export const UsersList: FC<{ users: IUserRow[] }> = ({ users }) => {
  const wide = useMediaQuery(MQ.md);
  const { user: me } = useAuth();
  const actions = useUserActions();
  const [sessionsOf, setSessionsOf] = useState<IUserRow | null>(null);
  const [resetOf, setResetOf] = useState<IUserRow | null>(null);

  const view: IUsersViewProps = { users, meId: me.id, actions, onSessions: setSessionsOf, onResetPassword: setResetOf };
  return (
    <>
      {wide ? <UsersTable {...view} /> : <UserCards {...view} />}
      <UserSessionsDialog user={sessionsOf} onClose={() => setSessionsOf(null)} />
      <PasswordResetDialog user={resetOf} onClose={() => setResetOf(null)} />
    </>
  );
};
