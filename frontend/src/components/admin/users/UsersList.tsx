// Пользователи: таблица на широком экране, карточки уже 900px. На 360px таблица показывала
// одну колонку «Пользователь», а роль, доступ, вход и действия уезжали за край.
// Имя ведёт на страницу пользователя (входы, ключи доступа, журнал); сброс пароля — в окне.

import { FC, useState } from 'react';

import type { IUserRow } from '../../../api/types';
import { useAuth } from '../../../hooks/useAuth';
import { useMediaQuery } from '../../../hooks/useMediaQuery';
import { MQ } from '../../../lib/media';
import { PasswordResetDialog } from './PasswordResetDialog';
import { UserCards } from './UserCards';
import { UsersTable } from './UsersTable';
import { useUserActions } from './useUserActions';

export interface IUsersViewProps {
  users: IUserRow[];
  /** Своя строка: свою роль и доступ администратор не меняет — сервер тоже откажет (`self_change`). */
  meId: number;
  actions: ReturnType<typeof useUserActions>;
  onResetPassword: (user: IUserRow) => void;
}

/** Страница пользователя: входы, ключи доступа, журнал. */
export const userPath = (user: IUserRow): string => `/admin/users/${user.id}`;

export const UsersList: FC<{ users: IUserRow[] }> = ({ users }) => {
  const wide = useMediaQuery(MQ.md);
  const { user: me } = useAuth();
  const actions = useUserActions();
  const [resetOf, setResetOf] = useState<IUserRow | null>(null);

  const view: IUsersViewProps = { users, meId: me.id, actions, onResetPassword: setResetOf };
  return (
    <>
      {wide ? <UsersTable {...view} /> : <UserCards {...view} />}
      <PasswordResetDialog user={resetOf} onClose={() => setResetOf(null)} />
    </>
  );
};
