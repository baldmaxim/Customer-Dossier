// Новый пользователь: логин, имя, роль, выданный пароль. Пароль пользователь сменит при
// первом входе — до этого сервер не отдаёт ему данных.

import { FC, FormEvent, useState } from 'react';
import { useMutation } from '@tanstack/react-query';

import { api } from '../../../api/client';
import type { IUserRow, UserRole } from '../../../api/types';
import { generatePassword } from '../../../lib/generatePassword';
import { USER_ROLE_HINTS, USER_ROLE_LABELS } from '../../../lib/labels';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Select } from '../../ui/Select';
import { TextInput } from '../../ui/TextInput';
import { useToast } from '../../ui/toast';
import { actionError } from '../actionError';
import formStyles from '../Forms.module.css';

const ROLES: UserRole[] = ['viewer', 'operator', 'admin'];

interface IUserCreateFormProps {
  onCreated: (user: IUserRow, password: string) => void;
}

export const UserCreateForm: FC<IUserCreateFormProps> = ({ onCreated }) => {
  const toast = useToast();
  const [login, setLogin] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<UserRole>('viewer');
  const [password, setPassword] = useState('');

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
    onError: (err: Error) => toast.show({ tone: 'danger', text: actionError(err) }),
  });

  const ready = login.trim() !== '' && displayName.trim() !== '' && password !== '';

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (ready) create.mutate({ login: login.trim().toLowerCase(), displayName: displayName.trim(), role, password });
  };

  return (
    <form className={formStyles.grid} onSubmit={submit}>
      <Field label="Логин">
        {control => (
          <TextInput
            {...control}
            value={login}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="ivanov или ivanov@firma.ru"
            onChange={e => setLogin(e.target.value)}
          />
        )}
      </Field>
      <Field label="Имя">
        {control => <TextInput {...control} value={displayName} placeholder="Иван Иванов" onChange={e => setDisplayName(e.target.value)} />}
      </Field>
      <Field label="Роль" hint={USER_ROLE_HINTS[role]}>
        {control => (
          <Select {...control} value={role} onChange={e => setRole(e.target.value as UserRole)}>
            {ROLES.map(r => (
              <option key={r} value={r}>
                {USER_ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <div className={formStyles.inline}>
        <Field label="Пароль для первого входа" className={formStyles.grow}>
          {control => (
            <TextInput
              {...control}
              className={formStyles.mono}
              autoComplete="off"
              spellCheck={false}
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
          )}
        </Field>
        <Button onClick={() => setPassword(generatePassword())}>Сгенерировать</Button>
      </div>
      <div className={formStyles.full}>
        <Button type="submit" variant="primary" loading={create.isPending} disabled={!ready}>
          Создать пользователя
        </Button>
      </div>
    </form>
  );
};
