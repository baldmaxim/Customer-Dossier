import { FC, FormEvent, useState } from 'react';

import styles from './LoginPage.module.css';

interface ILoginPageProps {
  onLogin: (token: string) => Promise<void>;
  error: string | null;
  pending: boolean;
}

/**
 * Вход одного локального оператора по токену. Токен не сохраняется в браузере:
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
        <h1 className={styles.title}>Досье Заказчика</h1>
        <p className={styles.hint}>
          Вход оператора. Токен лежит в <code>backend/.local/operator-token</code> или задан как{' '}
          <code>OPERATOR_TOKEN</code> в <code>backend/.env</code>.
        </p>
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
        <button type="submit" className={styles.button} disabled={pending || token.trim() === ''}>
          {pending ? 'Вход…' : 'Войти'}
        </button>
      </form>
    </main>
  );
};
