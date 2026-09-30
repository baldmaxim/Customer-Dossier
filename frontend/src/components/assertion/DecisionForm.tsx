// Решение оператора по сведению: с ожидаемой версией (вторая вкладка не затрёт первую) и ключом
// идемпотентности (двойное нажатие и повтор после сбоя сети не создают второе решение).

import { FC, FormEvent, useState } from 'react';
import { useMutation } from '@tanstack/react-query';

import { ApiError, api } from '../../api/client';
import type { AssertionStatus, IAssertion, IReviewRow } from '../../api/types';
import { newKey } from '../../lib/idempotency';
import { REVIEW_SCOPE_LABELS } from '../../lib/labels';
import { describeLoadError } from '../../lib/loadError';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { Field } from '../ui/Field';
import { Select } from '../ui/Select';
import { Textarea } from '../ui/Textarea';
import { useToast } from '../ui/toast';
import { useAssertionRefresh } from './assertionApi';
import styles from '../AssertionDetail.module.css';

type ReviewScope = IReviewRow['scope'];

const DECISIONS: ReadonlyArray<{ value: AssertionStatus; label: string }> = [
  { value: 'reviewed_supported', label: 'Подтвердить' },
  { value: 'disputed', label: 'Спорно' },
  { value: 'rejected', label: 'Отклонить' },
  { value: 'candidate', label: 'Вернуть на проверку' },
];

const SCOPES: readonly ReviewScope[] = ['reflects_source', 'fact_confirmed'];

interface IProblem {
  tone: 'warning' | 'danger';
  text: string;
}

export const DecisionForm: FC<{ assertion: IAssertion }> = ({ assertion }) => {
  const toast = useToast();
  const refresh = useAssertionRefresh(assertion.id);
  const [decision, setDecision] = useState<AssertionStatus>('reviewed_supported');
  const [scope, setScope] = useState<ReviewScope>('reflects_source');
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<IProblem | null>(null);
  // Ключ живёт, пока решение не записано: повтор того же нажатия сервер узнаёт и не пишет дважды.
  const [idempotencyKey, setIdempotencyKey] = useState(() => newKey());
  // Отклонение, спор и возврат на проверку без причины сервер не примет: решение должно быть воспроизводимо.
  const reasonRequired = decision !== 'reviewed_supported';
  const tooShort = reasonRequired && reason.trim().length < 3;

  const review = useMutation({
    mutationFn: () =>
      api.post(`/api/assertions/${assertion.id}/reviews`, {
        decision,
        scope,
        reason: reason.trim() || null,
        expectedVersion: assertion.version,
        idempotencyKey,
      }),
    onSuccess: () => {
      setReason('');
      setProblem(null);
      setIdempotencyKey(newKey());
      toast.show({ text: 'Решение записано.', tone: 'success' });
      refresh();
    },
    onError: (err: Error) => {
      if (err instanceof ApiError && err.status === 409) {
        setProblem({ tone: 'warning', text: 'Сведение изменилось в другой вкладке или получило новую цитату. Данные обновлены — проверьте и решите заново.' });
        setIdempotencyKey(newKey());
        refresh();
        return;
      }
      setProblem({ tone: 'danger', text: describeLoadError(err) });
    },
  });

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (!tooShort) review.mutate();
  };

  return (
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.formRow}>
        <Field label="Решение">
          {control => (
            <Select
              {...control}
              value={decision}
              onChange={e => setDecision(DECISIONS.find(d => d.value === e.target.value)?.value ?? decision)}
            >
              {DECISIONS.map(d => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Что именно проверено">
          {control => (
            <Select {...control} value={scope} onChange={e => setScope(SCOPES.find(s => s === e.target.value) ?? scope)}>
              {SCOPES.map(s => (
                <option key={s} value={s}>
                  {REVIEW_SCOPE_LABELS[s]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field
        label="Причина"
        required={reasonRequired}
        hint={reasonRequired ? 'Для этого решения причина обязательна — хотя бы три знака.' : 'Необязательно.'}
      >
        {control => <Textarea {...control} rows={2} value={reason} onChange={e => setReason(e.target.value)} />}
      </Field>
      {problem && (
        <Callout tone={problem.tone} live={problem.tone === 'danger' ? 'assertive' : 'polite'}>
          {problem.text}
        </Callout>
      )}
      <div>
        <Button type="submit" variant="primary" loading={review.isPending} disabled={tooShort}>
          Записать решение
        </Button>
      </div>
    </form>
  );
};
