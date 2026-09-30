// Вход на серверной выкладке (ADR-014). Пароль не сохраняется в браузере: после входа
// остаётся только серверная сессия в HttpOnly-cookie. Учётная запись — от администратора или
// по заявке на доступ («Отправить заявку»), которую администратор одобряет.
//
// Отказ по заявке (ещё не одобрена, отклонена) сервер сообщает только на верный пароль — его
// объясняем словами; прочие отказы — текстом сервера («Неверный логин или пароль»).

import { FC, FormEvent, useState } from 'react';

import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { Field } from '../components/ui/Field';
import { Stack } from '../components/ui/Stack';
import { TextInput } from '../components/ui/TextInput';
import { usePageTitle } from '../hooks/usePageTitle';
import { LOGIN_REFUSAL_LABELS } from '../lib/labels';
import { AuthCard } from './AuthCard';

interface ILoginPageProps {
  onLogin: (login: string, password: string) => Promise<void>;
  error: string | null;
  /** Код отказа сервера: registration_pending / registration_rejected. */
  errorCode?: string | null;
  pending: boolean;
  /** К заявке на доступ. */
  onRegister: () => void;
}

export const LoginPage: FC<ILoginPageProps> = ({ onLogin, error, errorCode = null, pending, onRegister }) => {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const ready = login.trim() !== '' && password !== '';
  const refusal = errorCode === null ? undefined : LOGIN_REFUSAL_LABELS[errorCode];
  usePageTitle('Вход');

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (!ready || pending) return;
    void onLogin(login.trim(), password)
      .then(() => setPassword(''))
      .catch(() => setPassword(''));
  };

  return (
    <AuthCard
      title="Вход в портал"
      footer={
        <>
          <span>Нет доступа?</span>
          <Button variant="link" onClick={onRegister}>
            Отправить заявку
          </Button>
        </>
      }
    >
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
        {refusal ? (
          // Заявка ждёт решения — не ошибка человека: сообщение, а не тревога.
          <Callout tone={errorCode === 'registration_pending' ? 'info' : 'danger'} live="assertive" title={refusal.title}>
            {refusal.text}
          </Callout>
        ) : (
          error && <Callout tone="danger">{error}</Callout>
        )}
        <Button type="submit" variant="primary" size="lg" block loading={pending} disabled={!ready}>
          Войти
        </Button>
      </Stack>
    </AuthCard>
  );
};
