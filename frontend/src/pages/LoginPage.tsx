// Вход на серверной выкладке (ADR-014). Пароль не сохраняется в браузере: после входа
// остаётся только серверная сессия в HttpOnly-cookie. Учётная запись — от администратора или
// по заявке на доступ («Отправить заявку»), которую администратор одобряет.
//
// Отказ по заявке (ещё не одобрена, отклонена) сервер сообщает только на верный пароль — его
// объясняем словами; прочие отказы — текстом сервера («Неверный логин или пароль»).
//
// Ключ доступа (passkey) — кнопка под формой, если сервер его принимает и браузер умеет: логин не нужен,
// устройство само предложит сохранённый ключ портала (Face ID, Touch ID, Windows Hello, телефон рядом).

import { FC, FormEvent, useState } from 'react';

import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { Field } from '../components/ui/Field';
import { Stack } from '../components/ui/Stack';
import { TextInput } from '../components/ui/TextInput';
import { usePageTitle } from '../hooks/usePageTitle';
import { LOGIN_REFUSAL_LABELS } from '../lib/labels';
import { AuthCard } from './AuthCard';
import styles from './LoginPage.module.css';

export interface IPasskeyLogin {
  onLogin: () => void;
  pending: boolean;
  /** Отказ словами; закрытое окно устройства — не отказ. */
  error: string | null;
}

interface ILoginPageProps {
  onLogin: (login: string, password: string) => Promise<void>;
  error: string | null;
  /** Код отказа сервера: registration_pending / registration_rejected. */
  errorCode?: string | null;
  pending: boolean;
  /** К заявке на доступ. */
  onRegister: () => void;
  /** Вход по ключу доступа; нет — кнопки нет. */
  passkey?: IPasskeyLogin;
}

export const LoginPage: FC<ILoginPageProps> = ({ onLogin, error, errorCode = null, pending, onRegister, passkey }) => {
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
              onClear={() => setLogin('')}
              clearLabel="Очистить логин"
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
              onClear={() => setPassword('')}
              clearLabel="Очистить пароль"
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
      {passkey && (
        <Stack gap={3}>
          <p className={styles.or}>или</p>
          <Button variant="secondary" size="lg" block loading={passkey.pending} onClick={passkey.onLogin}>
            Войти с ключом доступа
          </Button>
          <p className={styles.hint}>Face ID, Touch ID, Windows Hello или телефон рядом — логин и пароль не нужны.</p>
          {passkey.error && (
            <Callout tone="danger" live="assertive">
              {passkey.error}
            </Callout>
          )}
        </Stack>
      )}
    </AuthCard>
  );
};
