// Смена роли и доступа пользователя — с подтверждением: раньше роль менялась сразу при выборе
// в списке, и промах пальцем на телефоне давал читателю права администратора. Изменение уходит
// с ожидаемой версией: две вкладки не затрут друг друга.

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '../../../api/client';
import type { IUserRow, UserRole } from '../../../api/types';
import { USER_ROLE_HINTS, USER_ROLE_LABELS } from '../../../lib/labels';
import { useConfirm } from '../../ui/confirm';
import { useToast } from '../../ui/toast';
import { actionError } from '../../../lib/actionError';

interface IPatch {
  role?: UserRole;
  isActive?: boolean;
}

export interface IUserActions {
  changeRole: (user: IUserRow, role: UserRole) => Promise<void>;
  setActive: (user: IUserRow, isActive: boolean) => Promise<void>;
  isUpdating: (user: IUserRow) => boolean;
}

export const useUserActions = (): IUserActions => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['users'] });
    void queryClient.invalidateQueries({ queryKey: ['auth-events'] });
  };

  const update = useMutation({
    mutationFn: ({ user, patch }: { user: IUserRow; patch: IPatch }) =>
      api.patch<IUserRow>(`/api/users/${user.id}`, { expectedVersion: user.version, ...patch }),
    onSuccess: (updated, { user, patch }) => {
      const text =
        patch.isActive === false
          ? `${user.displayName}: доступ выключен, открытые входы закрыты.`
          : patch.isActive === true
            ? `${user.displayName}: доступ включён.`
            : `${user.displayName}: роль — ${USER_ROLE_LABELS[updated.role]}. Действует сразу, без повторного входа.`;
      toast.show({ tone: 'success', text });
      refresh();
    },
    onError: (err: Error) => {
      toast.show({ tone: 'danger', text: actionError(err) });
      refresh();
    },
  });

  return {
    changeRole: async (user, role) => {
      if (role === user.role) return;
      const ok = await confirm({
        title: `Сменить роль: ${user.displayName}?`,
        body: `Новая роль — ${USER_ROLE_LABELS[role]}: ${USER_ROLE_HINTS[role]}. Права изменятся сразу, без повторного входа.`,
        confirmLabel: 'Сменить роль',
      });
      if (ok) update.mutate({ user, patch: { role } });
    },
    setActive: async (user, isActive) => {
      if (!isActive) {
        const ok = await confirm({
          title: `Выключить доступ: ${user.displayName}?`,
          body: 'Открытые входы пользователя закроются сразу, войти он не сможет. Включить доступ можно здесь же.',
          confirmLabel: 'Выключить доступ',
          tone: 'danger',
        });
        if (!ok) return;
      }
      update.mutate({ user, patch: { isActive } });
    },
    isUpdating: user => update.isPending && update.variables?.user.id === user.id,
  };
};
