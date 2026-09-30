// Кто вошёл и что ему можно — для экранов. Сервер проверяет права сам на каждом запросе
// (auth/routePolicy.ts); здесь права нужны только чтобы не показывать кнопки, которые
// ответят «Недостаточно прав».

import { createContext, useContext } from 'react';

import type { AccessPermission, IAuthUser } from '../api/types';

export interface IAuthState {
  user: IAuthUser;
  /** Вход вообще есть: на сервере — да, локально — нет. */
  authRequired: boolean;
  can: (permission: AccessPermission) => boolean;
  /** Только на сервере: локально выходить некуда. */
  logout?: () => void;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
}

const ALL_PERMISSIONS: AccessPermission[] = [
  'portal.read',
  'admin.view',
  'sources.manage',
  'pipeline.manage',
  'review.decide',
  'entities.merge',
  'dossier.view',
  'dossier.manage',
  'users.manage',
];

/**
 * Без провайдера — как локальный режим (AUTH_MODE=none): один оператор со всеми правами.
 * В портале провайдер ставит AuthGate всегда; значение по умолчанию нужно компонентным тестам.
 */
export const LOCAL_AUTH: IAuthState = {
  user: { id: 0, login: 'operator', displayName: 'Оператор', role: 'admin', permissions: ALL_PERMISSIONS, mustChangePassword: false },
  authRequired: false,
  can: () => true,
  changePassword: async () => undefined,
};

export const AuthContext = createContext<IAuthState>(LOCAL_AUTH);

export const useAuth = (): IAuthState => useContext(AuthContext);

export const useCan = (permission: AccessPermission): boolean => useAuth().can(permission);
