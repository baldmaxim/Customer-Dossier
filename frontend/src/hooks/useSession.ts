import { useCallback, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { AUTH_REQUIRED_EVENT, api, setCsrfToken } from '../api/client';
import { purgeSensitiveCaches } from '../lib/cachePurge';

interface ISessionResponse {
  authenticated: boolean;
  csrfToken?: string;
  expiresAt?: string;
}

const SESSION_KEY = ['auth', 'session'] as const;

export interface IUseSession {
  isLoading: boolean;
  authenticated: boolean;
  login: (token: string) => Promise<void>;
  logout: () => Promise<void>;
  loginError: string | null;
  isLoggingIn: boolean;
}

export const useSession = (): IUseSession => {
  const queryClient = useQueryClient();

  const sessionQuery = useQuery({
    queryKey: SESSION_KEY,
    queryFn: async () => {
      const session = await api.get<ISessionResponse>('/api/auth/session');
      setCsrfToken(session.csrfToken ?? null);
      return session;
    },
    staleTime: Infinity,
    retry: false,
  });

  // Любой 401 из API (истёкшая сессия) возвращает на экран входа, а данные
  // прежней сессии убираются из памяти.
  useEffect(() => {
    const onAuthRequired = (): void => {
      queryClient.removeQueries({ predicate: q => q.queryKey[0] !== 'auth' });
      queryClient.setQueryData(SESSION_KEY, { authenticated: false });
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
  }, [queryClient]);

  const loginMutation = useMutation({
    mutationFn: (token: string) => api.post<ISessionResponse>('/api/auth/login', { token }),
    onSuccess: session => {
      setCsrfToken(session.csrfToken ?? null);
      queryClient.setQueryData(SESSION_KEY, session);
    },
  });

  const login = useCallback(
    async (token: string): Promise<void> => {
      await loginMutation.mutateAsync(token);
    },
    [loginMutation],
  );

  // Сессию переключаем через тот же запрос, на который подписан экран: queryClient.clear()
  // удалял его вместе с данными, подписчик об этом не узнавал, и досье оставалось на экране.
  const logout = useCallback(async (): Promise<void> => {
    await api.post('/api/auth/logout').catch(() => undefined);
    setCsrfToken(null);
    queryClient.setQueryData(SESSION_KEY, { authenticated: false });
    queryClient.removeQueries({ predicate: q => q.queryKey[0] !== 'auth' });
    queryClient.getMutationCache().clear();
    await purgeSensitiveCaches();
  }, [queryClient]);

  return {
    isLoading: sessionQuery.isLoading,
    authenticated: sessionQuery.data?.authenticated === true,
    login,
    logout,
    loginError: loginMutation.error ? loginMutation.error.message : null,
    isLoggingIn: loginMutation.isPending,
  };
};
