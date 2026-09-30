// Новый пользователь: логин, имя, роль, выданный пароль. Пароль пользователь сменит при
// первом входе — до этого сервер не отдаёт ему данных.

import { FC, FormEvent, useId, useState } from 'react';
import { useMutation } from '@tanstack/react-query';

import { api } from '../../../api/client';
import type { IUserRow, UserRole } from '../../../api/types';
import { generatePassword } from '../../../lib/generatePassword';
import { USER_ROLE_HINTS, USER_ROLE_LABELS } from '../../../lib/labels';
import { Button } from '../../ui/Button';
import adminStyles from '../../../pages/AdminPage.module.css';
import styles from './Users.module.css';

const ROLES: UserRole[] = ['viewer', 'operator', 'admin'];

interface IUserCreateFormProps {
  onCreated: (user: IUserRow, password: string) => void;
  onError: (text: string) => void;
}

export const UserCreateForm: FC<IUserCreateFormProps> = ({ onCreated, onError }) => {
  const [login, setLogin] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<UserRole>('viewer');
  const [password, setPassword] = useState('');
  const id = useId();

  const create = useMutation({
    mutationFn: (input: { login: string; displayName: string; role: UserRole; password: string }) =>
      api.post<IUserRow>('/api/users', input),
    onSuccess: (user, input) => {
      setLogin('');
      setDisplayName('');
      setRole('viewer');
      setPassword('');
      onCreated(user, input.password);
    },
    onError: (err: Error) => onError(err.message),
  });

  const ready = login.trim() !== '' && displayName.trim() !== '' && password !== '';

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (ready) create.mutate({ login: login.trim().toLowerCase(), displayName: displayName.trim(), role, password });
  };

  return (
    <form className={styles.createForm} onSubmit={submit}>
      <div className={adminStyles.field}>
        <label className={adminStyles.label} htmlFor={`${id}-login`}>
          Логин
        </label>
        <input
          id={`${id}-login`}
          className={adminStyles.input}
          value={login}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="ivanov или ivanov@firma.ru"
          onChange={e => setLogin(e.target.value)}
        />
      </div>
      <div className={adminStyles.field}>
        <label className={adminStyles.label} htmlFor={`${id}-name`}>
          Имя
        </label>
        <input
          id={`${id}-name`}
          className={adminStyles.input}
          value={displayName}
          placeholder="Иван Иванов"
          onChange={e => setDisplayName(e.target.value)}
        />
      </div>
      <div className={adminStyles.field}>
        <label className={adminStyles.label} htmlFor={`${id}-role`}>
          Роль
        </label>
        <select id={`${id}-role`} value={role} onChange={e => setRole(e.target.value as UserRole)}>
          {ROLES.map(r => (
            <option key={r} value={r}>
              {USER_ROLE_LABELS[r]}
            </option>
          ))}
        </select>
        <span className={styles.roleHint}>{USER_ROLE_HINTS[role]}</span>
      </div>
      <div className={adminStyles.field}>
        <label className={adminStyles.label} htmlFor={`${id}-password`}>
          Пароль для первого входа
        </label>
        <span className={styles.passwordRow}>
          <input
            id={`${id}-password`}
            className={`${adminStyles.input} ${styles.mono}`}
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
          <Button onClick={() => setPassword(generatePassword())}>Сгенерировать</Button>
        </span>
      </div>
      <div className={styles.createActions}>
        <Button type="submit" variant="primary" disabled={!ready || create.isPending}>
          {create.isPending ? 'Создание…' : 'Создать пользователя'}
        </Button>
      </div>
    </form>
  );
};
