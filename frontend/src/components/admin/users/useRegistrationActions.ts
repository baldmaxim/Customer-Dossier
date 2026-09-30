// Решение по заявке на доступ: «Одобрить» — сразу, с выбранной ролью, итог тостом; «Отклонить» —
// после подтверждения. Решение уходит с ожидаемой версией: второй администратор, открывший ту же
// заявку раньше, получит «уже одобрена» или «обновите страницу», а не молча перерешит её.

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '../../../api/client';
import type { IUserRow, UserRole } from '../../../api/types';
import { USER_ROLE_LABELS } from '../../../lib/labels';
import { useConfirm } from '../../ui/confirm';
import { useToast } from '../../ui/toast';
import { actionError } from '../actionError';

type Decision = 'approve' | 'reject';

export interface IRegistrationActions {
  approve: (request: IUserRow, role: UserRole) => void;
  reject: (request: IUserRow) => Promise<void>;
  isDeciding: (request: IUserRow) => boolean;
}

export const useRegistrationActions = (): IRegistrationActions => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['users'] });
    void queryClient.invalidateQueries({ queryKey: ['auth-events'] });
  };

  const decide = useMutation({
    mutationFn: ({ request, decision, role }: { request: IUserRow; decision: Decision; role?: UserRole }) =>
      api.post<IUserRow>(
        `/api/users/${request.id}/${decision}`,
        decision === 'approve' ? { expectedVersion: request.version, role } : { expectedVersion: request.version },
      ),
    onSuccess: (user, { request, decision }) => {
      toast.show({
        tone: 'success',
        text:
          decision === 'approve'
            ? `${request.displayName}: заявка одобрена, роль — ${USER_ROLE_LABELS[user.role]}. Войти можно сразу.`
            : `${request.displayName}: заявка отклонена.`,
      });
      refresh();
    },
    onError: (err: Error) => {
      toast.show({ tone: 'danger', text: actionError(err) });
      refresh();
    },
  });

  return {
    approve: (request, role) => decide.mutate({ request, decision: 'approve', role }),
    reject: async request => {
      const ok = await confirm({
        title: `Отклонить заявку: ${request.displayName}?`,
        body: `Войти под логином ${request.login} будет нельзя. Заявка не удаляется: если передумаете, одобрите её в «Отклонённых заявках».`,
        confirmLabel: 'Отклонить',
        tone: 'danger',
      });
      if (ok) decide.mutate({ request, decision: 'reject' });
    },
    isDeciding: request => decide.isPending && decide.variables?.request.id === request.id,
  };
};
