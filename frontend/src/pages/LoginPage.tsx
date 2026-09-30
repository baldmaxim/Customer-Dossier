// Вход на серверной выкладке (ADR-014). Пароль не сохраняется в браузере: после входа
// остаётся только серверная сессия в HttpOnly-cookie. Логин и пароль выдаёт администратор.

import { FC, FormEvent, useState } from 'react';

import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { Field } from '../components/ui/Field';
import { Stack } from '../components/ui/Stack';
import { TextInput } from '../components/ui/TextInput';
import { usePageTitle } from '../hooks/usePageTitle';
import { AuthCard } from './AuthCard';

interface ILoginPageProps {
  onLogin: (login: string, password: string) => Promise<void>;
  error: string | null;
  pending: boolean;
}

export const LoginPage: FC<ILoginPageProps> = ({ onLogin, error, pending }) => {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const ready = login.trim() !== '' && password !== '';
  usePageTitle('Вход');

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (!ready || pending) return;
    void onLogin(login.trim(), password)
      .then(() => setPassword(''))
      .catch(() => setPassword(''));
  };

  return (
    <AuthCard title="Вход в портал" lead="Логин и пароль выдаёт администратор портала.">
      <Stack as="form" gap={4} onSubmit={submit}>
        <Field label="Логин" id="login-name">
          {control => (
            <TextInput
              {...control}
              size="lg"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={login}
              onChange={e => setLogin(e.target.value)}
            />
          )}
        </Field>
        <Field label="Пароль" id="login-password">
          {control => (
            <TextInput
              {...control}
              size="lg"
              type="password"
              autoComplete="current-password"
              spellCheck={false}
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
          )}
        </Field>
        {error && <Callout tone="danger">{error}</Callout>}
        <Button type="submit" variant="primary" size="lg" block loading={pending} disabled={!ready}>
          Войти
        </Button>
      </Stack>
    </AuthCard>
  );
};
