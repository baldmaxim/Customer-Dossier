import { FC, FormEvent, useState } from 'react';

import { Button } from '../components/ui/Button';
import styles from './LoginPage.module.css';

interface ILoginPageProps {
  onLogin: (login: string, password: string) => Promise<void>;
  error: string | null;
  pending: boolean;
}

/**
 * Вход на серверной выкладке (ADR-014). Пароль не сохраняется в браузере: после входа
 * остаётся только серверная сессия в HttpOnly-cookie. Логин и пароль выдаёт администратор.
 */
export const LoginPage: FC<ILoginPageProps> = ({ onLogin, error, pending }) => {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const ready = login.trim() !== '' && password !== '';

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (!ready) return;
    void onLogin(login.trim(), password)
      .then(() => setPassword(''))
      .catch(() => setPassword(''));
  };

  return (
    <main className={styles.shell}>
      <form className={styles.card} onSubmit={submit}>
        <h1 className="visually-hidden">Досье Заказчика — вход</h1>
        <img className={`${styles.logo} ${styles.logoLight}`} src="/logo-light.svg" alt="Досье Заказчика" />
        <img className={`${styles.logo} ${styles.logoDark}`} src="/logo-dark.svg" alt="" aria-hidden="true" />
        <p className={styles.hint}>Логин и пароль выдаёт администратор портала.</p>
        <label className={styles.label} htmlFor="login-name">
          Логин
        </label>
        <input
          id="login-name"
          className={styles.input}
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={login}
          onChange={e => setLogin(e.target.value)}
        />
        <label className={styles.label} htmlFor="login-password">
          Пароль
        </label>
        <input
          id="login-password"
          className={styles.input}
          type="password"
          autoComplete="current-password"
          spellCheck={false}
          value={password}
          onChange={e => setPassword(e.target.value)}
        />
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" block disabled={pending || !ready}>
          {pending ? 'Вход…' : 'Войти'}
        </Button>
      </form>
    </main>
  );
};
