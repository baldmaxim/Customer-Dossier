import { FC, ReactNode, useMemo } from 'react';

import { AuthContext, LOCAL_AUTH, type IAuthState } from '../hooks/useAuth';
import { useSession } from '../hooks/useSession';
import { LoginPage } from '../pages/LoginPage';
import { PasswordChangePage } from '../pages/PasswordChangePage';

interface IAuthGateProps {
  children: ReactNode;
}

/**
 * Локально (AUTH_MODE=none) портал открывается сразу. На сервере (ADR-014) данные — только
 * после входа; выданный администратором пароль сначала меняется. Сервер не ответил — портал
 * сам покажет ошибку загрузки на экране.
 */
export const AuthGate: FC<IAuthGateProps> = ({ children }) => {
  const session = useSession();
  const { user, authRequired, logout, changePassword } = session;

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

  if (session.isLoading) return null;
  if (session.authRequired && !session.authenticated) {
    return <LoginPage onLogin={session.login} error={session.loginError} pending={session.isLoggingIn} />;
  }
  if (user?.mustChangePassword) {
    return <PasswordChangePage login={user.login} onChange={changePassword} onLogout={() => void logout()} />;
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
