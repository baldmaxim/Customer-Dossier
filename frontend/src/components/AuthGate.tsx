import { FC, ReactNode } from 'react';

import { useSession } from '../hooks/useSession';
import { LoginPage } from '../pages/LoginPage';

interface IAuthGateProps {
  /** Портал; onLogout есть только на сервере (AUTH_MODE=token) — локально выходить некуда. */
  renderPortal: (onLogout?: () => void) => ReactNode;
}

/**
 * Локально (AUTH_MODE=none) портал открывается сразу. На сервере (ADR-013) данные — только
 * после входа оператора. Сервер не ответил — портал сам покажет ошибку загрузки на экране.
 */
export const AuthGate: FC<IAuthGateProps> = ({ renderPortal }) => {
  const session = useSession();

  if (session.isLoading) return null;
  if (session.authRequired && !session.authenticated) {
    return <LoginPage onLogin={session.login} error={session.loginError} pending={session.isLoggingIn} />;
  }
  return <>{renderPortal(session.authRequired ? () => void session.logout() : undefined)}</>;
};
