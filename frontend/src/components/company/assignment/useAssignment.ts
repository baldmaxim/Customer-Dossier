// Назначение имени без ИНН (ADR-016, этап 23D): запрос кандидатов и общие действия панели.

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';

import { ApiError, api } from '../../../api/client';
import type { IAssignmentView, RegisterFocusOutcome } from '../../../api/types';
import { REGISTER_FOCUS_LABELS } from '../../../lib/labels';
import { useToast } from '../../ui/toast';

export const assignmentKey = (companyId: number): readonly unknown[] => ['company', companyId, 'assignment'];

export const useAssignment = (companyId: number): UseQueryResult<IAssignmentView> =>
  useQuery({
    queryKey: assignmentKey(companyId),
    queryFn: () => api.get<IAssignmentView>(`/api/companies/${companyId}/assignment`),
  });

/** Реквизит уже у другой карточки: значит, имя — это она, и выбор — слияние с ней. */
export interface ITakenIdentifier {
  companyId: number;
  companyName: string;
}

/**
 * «Это юрлицо с ИНН …»: реквизит на карточку, сразу запрос ЕГРЮЛ. Чужой реквизит — не ошибка, а
 * подсказка «назначьте имя той компании»: onTaken открывает слияние с ней.
 */
export const useIdentify = (companyId: number, onTaken: (taken: ITakenIdentifier) => void) => {
  const client = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (identifier: string) =>
      api.post<{ identifier: { type: string; value: string }; focus: RegisterFocusOutcome }>(`/api/companies/${companyId}/identify`, { identifier }),
    onSuccess: result => {
      const focus = result.focus.status === 'stopped' ? result.focus.reason : result.focus.status;
      toast.show({ tone: 'success', text: `Реквизит назначен — теперь это юрлицо. ${REGISTER_FOCUS_LABELS[focus]}` });
      // Карточка перечитывается целиком: реквизиты, заголовок, «Сведения» с ЕГРЮЛ.
      void client.invalidateQueries({ queryKey: ['company', companyId] });
      void client.invalidateQueries({ queryKey: ['catalog'] });
    },
    onError: (err: Error) => {
      if (err instanceof ApiError && err.code === 'identifier_taken') {
        const body = err.body as { companyId?: number; companyName?: string } | undefined;
        if (body?.companyId) {
          onTaken({ companyId: body.companyId, companyName: body.companyName ?? `#${body.companyId}` });
          return;
        }
      }
      toast.show({ tone: 'danger', text: err.message });
    },
  });
};
