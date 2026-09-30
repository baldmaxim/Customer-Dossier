import { useCallback, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { AUTH_REQUIRED_EVENT, SESSION_STALE_EVENT, api, setCsrfToken } from '../api/client';
import type { IAuthUser, ISessionInfo } from '../api/types';
import { purgeSensitiveCaches } from '../lib/cachePurge';

const SESSION_KEY = ['auth', 'session'] as const;

export interface IUseSession {
  isLoading: boolean;
  /** Сервер не ответил: экран входа не показываем, портал сам покажет ошибку загрузки. */
  isError: boolean;
  authRequired: boolean;
  authenticated: boolean;
  /** Кто вошёл. Локально — локальный оператор со всеми правами. */
  user: IAuthUser | null;
  login: (login: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Смена своего пароля: остальные сессии пользователя сервер закрывает. */
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  loginError: string | null;
  isLoggingIn: boolean;
}

export const useSession = (): IUseSession => {
  const queryClient = useQueryClient();

  const sessionQuery = useQuery({
    queryKey: SESSION_KEY,
    queryFn: async () => {
      const session = await api.get<ISessionInfo>('/api/auth/session');
      setCsrfToken(session.csrfToken ?? null);
      return session;
    },
    staleTime: Infinity,
    retry: false,
  });

  // Любой 401 из API (истёкшая сессия) возвращает на экран входа, а данные
  // прежней сессии убираются из памяти. 403 «нет прав» — повод перечитать сессию:
  // роль могли сменить, пока страница была открыта.
  useEffect(() => {
    const onAuthRequired = (): void => {
      queryClient.removeQueries({ predicate: q => q.queryKey[0] !== 'auth' });
      queryClient.setQueryData<ISessionInfo>(SESSION_KEY, { authRequired: true, authenticated: false });
    };
    const onStale = (): void => {
      void queryClient.invalidateQueries({ queryKey: SESSION_KEY });
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
    window.addEventListener(SESSION_STALE_EVENT, onStale);
    return () => {
      window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
      window.removeEventListener(SESSION_STALE_EVENT, onStale);
    };
  }, [queryClient]);

  const loginMutation = useMutation({
    mutationFn: (input: { login: string; password: string }) => api.post<ISessionInfo>('/api/auth/login', input),
    onSuccess: session => {
      setCsrfToken(session.csrfToken ?? null);
      queryClient.setQueryData(SESSION_KEY, session);
    },
  });

  const login = useCallback(
    async (loginName: string, password: string): Promise<void> => {
      await loginMutation.mutateAsync({ login: loginName, password });
    },
    [loginMutation],
  );

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string): Promise<void> => {
      const session = await api.post<ISessionInfo>('/api/auth/password', { currentPassword, newPassword });
      setCsrfToken(session.csrfToken ?? null);
      queryClient.setQueryData(SESSION_KEY, session);
    },
    [queryClient],
  );

  // Сессию переключаем через тот же запрос, на который подписан экран: queryClient.clear()
  // удалял его вместе с данными, подписчик об этом не узнавал, и данные оставались на экране.
  const logout = useCallback(async (): Promise<void> => {
    await api.post('/api/auth/logout').catch(() => undefined);
    setCsrfToken(null);
    queryClient.setQueryData<ISessionInfo>(SESSION_KEY, { authRequired: true, authenticated: false });
    queryClient.removeQueries({ predicate: q => q.queryKey[0] !== 'auth' });
    queryClient.getMutationCache().clear();
    await purgeSensitiveCaches();
  }, [queryClient]);

  const data = sessionQuery.data;
  return {
    isLoading: sessionQuery.isLoading,
    isError: sessionQuery.isError,
    authRequired: data?.authRequired === true,
    authenticated: data?.authenticated === true,
    user: data?.authenticated === true ? (data.user ?? null) : null,
    login,
    logout,
    changePassword,
    loginError: loginMutation.error ? loginMutation.error.message : null,
    isLoggingIn: loginMutation.isPending,
  };
};
