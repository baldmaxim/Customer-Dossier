// Новый пароль пользователю: снимает блокировку, закрывает все его сессии, при входе
// пароль придётся сменить.

import { FC, FormEvent, useState } from 'react';
import { useMutation } from '@tanstack/react-query';

import { api } from '../../../api/client';
import type { IUserRow } from '../../../api/types';
import { generatePassword } from '../../../lib/generatePassword';
import { Button } from '../../ui/Button';
import adminStyles from '../../../pages/AdminPage.module.css';
import styles from './Users.module.css';

interface IPasswordResetFormProps {
  user: IUserRow;
  onDone: (user: IUserRow, password: string) => void;
  onError: (text: string) => void;
  onCancel: () => void;
}

export const PasswordResetForm: FC<IPasswordResetFormProps> = ({ user, onDone, onError, onCancel }) => {
  const [password, setPassword] = useState(() => generatePassword());

  const reset = useMutation({
    mutationFn: (value: string) => api.post<IUserRow>(`/api/users/${user.id}/password`, { password: value }),
    onSuccess: (updated, value) => onDone(updated, value),
    onError: (err: Error) => onError(err.message),
  });

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (password !== '') reset.mutate(password);
  };

  return (
    <form className={styles.panel} onSubmit={submit}>
      <p className={styles.panelNote}>
        Новый пароль для <strong>{user.login}</strong>. Все входы пользователя закроются, при следующем входе он задаст свой
        пароль.
      </p>
      <span className={styles.passwordRow}>
        <input
          className={`${adminStyles.input} ${styles.mono}`}
          aria-label={`Новый пароль: ${user.login}`}
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={password}
          onChange={e => setPassword(e.target.value)}
        />
        <Button onClick={() => setPassword(generatePassword())}>Другой</Button>
      </span>
      <div className={adminStyles.rowActions}>
        <Button type="submit" variant="primary" disabled={password === '' || reset.isPending}>
          Сбросить пароль
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </form>
  );
};
