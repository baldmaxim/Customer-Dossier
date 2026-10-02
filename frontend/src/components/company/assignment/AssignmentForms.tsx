// Решения по имени без ИНН, которые не выбор кандидата (ADR-016, этап 23D): указать реквизит вручную и
// «это не компания» с причиной. Право — companies.manage.

import { FC, FormEvent, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '../../../api/client';
import type { IAssignmentView } from '../../../api/types';
import { identifierOfQuery } from '../../../lib/taxId';
import { Button } from '../../ui/Button';
import { Disclosure } from '../../ui/Disclosure';
import { Field } from '../../ui/Field';
import { Textarea } from '../../ui/Textarea';
import { TextInput } from '../../ui/TextInput';
import { useToast } from '../../ui/toast';
import { assignmentKey } from './useAssignment';
import styles from './Assignment.module.css';

interface IManualIdentifierProps {
  onIdentify: (identifier: string) => void;
  pending: boolean;
}

/** Реквизит, которого нет среди подсказок: проверка контрольной суммы — до запроса, сервер проверит сам. */
export const ManualIdentifier: FC<IManualIdentifierProps> = ({ onIdentify, pending }) => {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const parsed = identifierOfQuery(value);
    if (!parsed) return setError('ИНН — 10 или 12 цифр, ОГРН — 13, ОГРНИП — 15');
    if (!parsed.checksumOk) return setError('Контрольная сумма не сходится — проверьте цифры');
    setError(null);
    onIdentify(parsed.value);
  };
  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <div className={styles.formRow}>
        <Field label="ИНН или ОГРН юрлица" error={error ?? undefined}>
          {control => <TextInput {...control} inputMode="numeric" autoComplete="off" value={value} onChange={e => setValue(e.target.value)} />}
        </Field>
        <Button type="submit" loading={pending}>
          Назначить
        </Button>
      </div>
    </form>
  );
};

/** «Это не компания»: фамилия, должность, ведомство без реквизита — с причиной, чтобы решение было понятно потом. */
export const DismissForm: FC<{ companyId: number }> = ({ companyId }) => {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const client = useQueryClient();
  const toast = useToast();
  const dismiss = useMutation({
    mutationFn: () => api.put<{ view: IAssignmentView }>(`/api/companies/${companyId}/dismissal`, { reason: reason.trim() }),
    onSuccess: result => {
      client.setQueryData<IAssignmentView>(assignmentKey(companyId), prev => (prev ? { ...prev, ...result.view } : prev));
      void client.invalidateQueries({ queryKey: ['catalog'] });
      toast.show({ tone: 'success', text: 'Отмечено: не компания. Имя ушло из «Без ИНН».' });
    },
    onError: (err: Error) => toast.show({ tone: 'danger', text: err.message }),
  });
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (!reason.trim()) return setError('Напишите, почему это не компания');
    setError(null);
    dismiss.mutate();
  };
  return (
    <Disclosure summary="Это не компания">
      <form className={styles.form} onSubmit={submit} noValidate>
        <Field label="Почему" hint="например: фамилия журналиста, название программы, ведомство без реквизита" error={error ?? undefined}>
          {control => <Textarea {...control} rows={2} value={reason} onChange={e => setReason(e.target.value)} />}
        </Field>
        <div>
          <Button type="submit" variant="danger" loading={dismiss.isPending}>
            Отметить: не компания
          </Button>
        </div>
      </form>
    </Disclosure>
  );
};
