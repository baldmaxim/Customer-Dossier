// «На контроле» в шапке карточки компании (ADR-016): портал спрашивает о такой компании первым —
// Контур.Фокус и реестр застройщиков ДОМ.РФ, — а каталог показывает её фильтром «На контроле».
//
// Переключает тот, у кого есть companies.manage; остальным состояние видно подписью без кнопки.

import { FC } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '../../api/client';
import type { ICompanyResponse, ICompanyWatch } from '../../api/types';
import { useCan } from '../../hooks/useAuth';
import { actionError } from '../../lib/actionError';
import { formatDate } from '../../lib/labels';
import { Button } from '../ui/Button';
import { useToast } from '../ui/toast';
import styles from './Company.module.css';

interface IWatchToggleProps {
  companyId: number;
  watch: ICompanyWatch | null;
}

export const WatchToggle: FC<IWatchToggleProps> = ({ companyId, watch }) => {
  const canManage = useCan('companies.manage');
  const client = useQueryClient();
  const toast = useToast();
  const toggle = useMutation({
    mutationFn: (next: boolean) =>
      next
        ? api.put<{ watch: ICompanyWatch | null }>(`/api/companies/${companyId}/watch`)
        : api.delete<{ watch: ICompanyWatch | null }>(`/api/companies/${companyId}/watch`),
    onSuccess: result => {
      client.setQueryData<ICompanyResponse>(['company', companyId], prev => (prev ? { ...prev, watch: result.watch } : prev));
      void client.invalidateQueries({ queryKey: ['catalog'] });
      toast.show({ tone: 'success', text: result.watch ? 'Компания на контроле.' : 'Компания снята с контроля.' });
    },
    onError: (err: Error) => toast.show({ tone: 'danger', text: actionError(err) }),
  });

  const hint = watch ? `Поставил ${watch.addedBy}, ${formatDate(watch.addedAt)}` : 'Портал будет спрашивать о компании первым';
  if (!canManage) return watch ? <span className={styles.watchBadge}>На контроле</span> : null;
  return (
    <Button
      icon={watch ? 'check' : 'eye'}
      variant={watch ? 'secondary' : 'ghost'}
      aria-pressed={watch !== null}
      hint={hint}
      loading={toggle.isPending}
      onClick={() => toggle.mutate(watch === null)}
    >
      На контроле
    </Button>
  );
};
