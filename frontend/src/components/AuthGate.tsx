import { FC, ReactNode, useMemo } from 'react';

import { AuthContext, LOCAL_AUTH, type IAuthState } from '../hooks/useAuth';
import { useSession } from '../hooks/useSession';
import { flagParam, useUrlPatch, useUrlState } from '../hooks/useUrlState';
import { LoginPage } from '../pages/LoginPage';
import { PasswordChangePage } from '../pages/PasswordChangePage';
import { RegisterPage } from '../pages/RegisterPage';
import { Loading } from './ui/Loading';
import styles from './AuthGate.module.css';

interface IAuthGateProps {
  children: ReactNode;
}

/**
 * Локально (AUTH_MODE=none) портал открывается сразу. На сервере (ADR-014) данные — только
 * после входа; выданный администратором пароль сначала меняется. Сервер не ответил — портал
 * сам покажет ошибку загрузки на экране.
 *
 * Заявка на доступ — `?register=1`: «Назад» браузера возвращает ко входу, ссылкой на заявку можно
 * поделиться. «Вернуться ко входу» заменяет запись истории, а не добавляет: второй «Назад» не
 * открывает форму заново.
 */
export const AuthGate: FC<IAuthGateProps> = ({ children }) => {
  const session = useSession();
  const { user, authRequired, logout, changePassword } = session;
  const [register, setRegister] = useUrlState('register', flagParam(), { history: 'push' });
  const patchUrl = useUrlPatch();

  const value = useMemo<IAuthState>(() => {
    const current = user ?? LOCAL_AUTH.user;
    const permissions = new Set(current.permissions);
    return {
      user: current,
      authRequired,
      can: permission => permissions.has(permission),
      logout: authRequired ? () => void logout() : undefined,
      changePassword,
    };
  }, [user, authRequired, logout, changePassword]);

  // Пока сессия читается — знак портала и «Загрузка…», а не белый экран.
  if (session.isLoading) {
    return (
      <main className={styles.gate}>
        <h1 className="visually-hidden">Досье Заказчика</h1>
        <img className={styles.logoLight} src="/logo-light.svg" alt="" />
        <img className={styles.logoDark} src="/logo-dark.svg" alt="" />
        <Loading label="Открываю портал…" />
      </main>
    );
  }
  if (session.authRequired && !session.authenticated) {
    if (register) return <RegisterPage onBack={() => patchUrl({ register: null }, { history: 'replace' })} />;
    return (
      <LoginPage
        onLogin={session.login}
        error={session.loginError}
        errorCode={session.loginErrorCode}
        pending={session.isLoggingIn}
        onRegister={() => {
          session.clearLoginError();
          setRegister(true);
        }}
      />
    );
  }
  if (user?.mustChangePassword) {
    return <PasswordChangePage login={user.login} onChange={changePassword} onLogout={() => void logout()} />;
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
