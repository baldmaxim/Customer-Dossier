// Решение оператора по сведению — «Да / Нет» (решение владельца 06.10.2026: приёмка без причин и
// выпадающих списков). «Да» — так написано в источнике, «Нет» — отклонить. С ожидаемой версией (вторая
// вкладка не затрёт первую) и ключом идемпотентности (двойное нажатие не создаёт второе решение).

import { FC, useState } from 'react';
import { useMutation } from '@tanstack/react-query';

import { ApiError, api } from '../../api/client';
import type { AssertionStatus, IAssertion } from '../../api/types';
import { newKey } from '../../lib/idempotency';
import { describeLoadError } from '../../lib/loadError';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { Cluster } from '../ui/Cluster';
import { useToast } from '../ui/toast';
import { useAssertionRefresh } from './assertionApi';
import styles from '../AssertionDetail.module.css';

type YesNo = Extract<AssertionStatus, 'reviewed_supported' | 'rejected'>;

interface IProblem {
  tone: 'warning' | 'danger';
  text: string;
}

export const DecisionForm: FC<{ assertion: IAssertion }> = ({ assertion }) => {
  const toast = useToast();
  const refresh = useAssertionRefresh(assertion.id);
  const [problem, setProblem] = useState<IProblem | null>(null);
  // Ключ живёт, пока решение не записано: повтор того же нажатия сервер узнаёт и не пишет дважды.
  const [idempotencyKey, setIdempotencyKey] = useState(() => newKey());

  const review = useMutation({
    mutationFn: (decision: YesNo) =>
      api.post(`/api/assertions/${assertion.id}/reviews`, {
        decision,
        scope: 'reflects_source',
        reason: null,
        expectedVersion: assertion.version,
        idempotencyKey,
      }),
    onSuccess: () => {
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

  const decide = (decision: YesNo): void => {
    setProblem(null);
    review.mutate(decision);
  };

  return (
    <div className={styles.form}>
      <Cluster gap={2}>
        <span>Сведение верно?</span>
        <Button
          variant={assertion.status === 'reviewed_supported' ? 'primary' : 'secondary'}
          aria-pressed={assertion.status === 'reviewed_supported'}
          loading={review.isPending && review.variables === 'reviewed_supported'}
          disabled={review.isPending}
          onClick={() => decide('reviewed_supported')}
        >
          Да
        </Button>
        <Button
          variant={assertion.status === 'rejected' ? 'primary' : 'secondary'}
          aria-pressed={assertion.status === 'rejected'}
          loading={review.isPending && review.variables === 'rejected'}
          disabled={review.isPending}
          onClick={() => decide('rejected')}
        >
          Нет
        </Button>
      </Cluster>
      {problem && (
        <Callout tone={problem.tone} live={problem.tone === 'danger' ? 'assertive' : 'polite'}>
          {problem.text}
        </Callout>
      )}
    </div>
  );
};
