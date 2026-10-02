// «Добавить компанию по ИНН» (ADR-016): в поиске набран реквизит, а карточки с ним в портале нет.
//
// Сервер заводит юрлицо по реквизиту, ставит его на контроль и сразу спрашивает Контур.Фокус. Карточка
// с этим реквизитом уже есть — сервер вернёт её, дубля не будет. Ответ Фокуса — тостом: заведение от
// него не зависит (нет ключа, лимит — наименование придёт позже).

import { FC } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { api } from '../../api/client';
import type { ICompanyRegistered } from '../../api/types';
import { useCan } from '../../hooks/useAuth';
import { REGISTER_FOCUS_LABELS } from '../../lib/labels';
import { identifierOfQuery, type IQueryIdentifier } from '../../lib/taxId';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { useToast } from '../ui/toast';

const focusText = (result: ICompanyRegistered): string => {
  const focus = result.focus;
  const key = focus.status === 'stopped' ? focus.reason : focus.status;
  const lead = result.created ? 'Компания заведена и поставлена на контроль.' : 'Компания с этим реквизитом уже была в портале — открываю её.';
  return `${lead} ${REGISTER_FOCUS_LABELS[key]}`;
};

interface IAddCompanyByInnProps {
  identifier: IQueryIdentifier;
}

export const AddCompanyByInn: FC<IAddCompanyByInnProps> = ({ identifier }) => {
  const canAdd = useCan('companies.manage');
  const navigate = useNavigate();
  const toast = useToast();
  const client = useQueryClient();
  const add = useMutation({
    mutationFn: () => api.post<ICompanyRegistered>('/api/companies', { identifier: identifier.value }),
    onSuccess: result => {
      void client.invalidateQueries({ queryKey: ['catalog'] });
      void client.invalidateQueries({ queryKey: ['search'] });
      const ok = result.focus.status === 'found' || result.focus.status === 'already_checked';
      toast.show({ tone: ok ? 'success' : 'warning', text: focusText(result) });
      navigate(`/company/${result.companyId}`, { viewTransition: true });
    },
    onError: (err: Error) => toast.show({ tone: 'danger', text: err.message }),
  });

  if (!identifier.checksumOk) {
    return (
      <Callout tone="warning" title={`${identifier.label}: контрольная сумма не сходится`}>
        В реквизите, скорее всего, опечатка — проверьте цифры.
      </Callout>
    );
  }

  return (
    <Callout
      tone="info"
      title={`В портале нет компании с ${identifier.label}`}
      action={
        canAdd ? (
          <Button variant="primary" icon="plus" loading={add.isPending} onClick={() => add.mutate()}>
            Добавить компанию
          </Button>
        ) : undefined
      }
    >
      {canAdd
        ? 'Портал заведёт карточку по реквизиту, поставит её на контроль и запросит сведения ЕГРЮЛ в Контур.Фокусе.'
        : 'Завести компанию по реквизиту может оператор.'}
    </Callout>
  );
};

/** Набранный запрос — реквизит, которого нет среди найденных: предложить завести компанию. */
export const missingIdentifier = (query: string, foundIdentifiers: ReadonlyArray<string>): IQueryIdentifier | null => {
  const identifier = identifierOfQuery(query);
  if (!identifier) return null;
  return foundIdentifiers.some(entry => entry.endsWith(` ${identifier.value}`)) ? null : identifier;
};
