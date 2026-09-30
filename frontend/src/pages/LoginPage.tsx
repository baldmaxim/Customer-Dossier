import { FC, FormEvent, useState } from 'react';

import { Button } from '../components/ui/Button';
import styles from './LoginPage.module.css';

interface ILoginPageProps {
  onLogin: (token: string) => Promise<void>;
  error: string | null;
  pending: boolean;
}

/**
 * Вход оператора на серверной выкладке (ADR-013). Токен не сохраняется в браузере:
 * после входа остаётся только серверная сессия в HttpOnly-cookie.
 */
export const LoginPage: FC<ILoginPageProps> = ({ onLogin, error, pending }) => {
  const [token, setToken] = useState('');

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const value = token.trim();
    if (!value) return;
    void onLogin(value)
      .then(() => setToken(''))
      .catch(() => undefined);
  };

  return (
    <main className={styles.shell}>
      <form className={styles.card} onSubmit={submit}>
        <h1 className="visually-hidden">Досье Заказчика — вход</h1>
        <img className={`${styles.logo} ${styles.logoLight}`} src="/logo-light.svg" alt="Досье Заказчика" />
        <img className={`${styles.logo} ${styles.logoDark}`} src="/logo-dark.svg" alt="" aria-hidden="true" />
        <p className={styles.hint}>Вход оператора. Токен выдаёт владелец портала.</p>
        <label className={styles.label} htmlFor="operator-token">
          Токен оператора
        </label>
        <input
          id="operator-token"
          className={styles.input}
          type="password"
          autoComplete="current-password"
          spellCheck={false}
          value={token}
          onChange={e => setToken(e.target.value)}
        />
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" block disabled={pending || token.trim() === ''}>
          {pending ? 'Вход…' : 'Войти'}
        </Button>
      </form>
    </main>
  );
};
