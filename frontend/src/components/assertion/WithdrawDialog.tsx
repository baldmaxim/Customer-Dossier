// Исключить цитату — с причиной в диалоге (раньше window.prompt: без описания последствий, без
// проверки длины и без ответа об ошибке). Цитата не удаляется: остаётся в истории с пометкой.

import { FC, useState } from 'react';
import { useMutation } from '@tanstack/react-query';

import { ApiError, api } from '../../api/client';
import type { IAssertion, IEvidenceRow } from '../../api/types';
import { describeLoadError } from '../../lib/loadError';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { Dialog } from '../ui/Dialog';
import { Field } from '../ui/Field';
import { Textarea } from '../ui/Textarea';
import { useToast } from '../ui/toast';
import { useAssertionRefresh } from './assertionApi';
import styles from '../AssertionDetail.module.css';

interface IWithdrawDialogProps {
  /** Цитата, которую исключают; null — диалог закрыт. */
  evidence: IEvidenceRow | null;
  assertion: IAssertion;
  onClose: () => void;
}

export const WithdrawDialog: FC<IWithdrawDialogProps> = ({ evidence, assertion, onClose }) => {
  const toast = useToast();
  const refresh = useAssertionRefresh(assertion.id);
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const tooShort = reason.trim().length < 3;

  const close = (): void => {
    setReason('');
    setProblem(null);
    onClose();
  };

  const withdraw = useMutation({
    mutationFn: (evidenceId: number) =>
      api.post(`/api/evidence/${evidenceId}/withdraw`, { reason: reason.trim(), expectedVersion: assertion.version }),
    onSuccess: () => {
      close();
      toast.show({ text: 'Цитата исключена. Решения оператора сохранены; сведение может потребовать повторной проверки.', tone: 'success' });
      refresh();
    },
    onError: (err: Error) => {
      setProblem(
        err instanceof ApiError && err.status === 409
          ? 'Сведение изменилось в другой вкладке. Данные обновлены — закройте окно и проверьте цитаты заново.'
          : describeLoadError(err),
      );
      refresh();
    },
  });

  return (
    <Dialog
      open={evidence !== null}
      onClose={close}
      title="Исключить цитату"
      description="Цитата перестанет подтверждать сведение, но останется в истории с пометкой «исключена». Решения оператора сохранятся."
      closeOnBackdrop={false}
      footer={
        <>
          <Button onClick={close}>Отмена</Button>
          <Button
            variant="danger-solid"
            loading={withdraw.isPending}
            disabled={tooShort}
            onClick={() => {
              if (evidence && !tooShort) withdraw.mutate(evidence.id);
            }}
          >
            Исключить цитату
          </Button>
        </>
      }
    >
      {evidence && <blockquote className={styles.dialogQuote}>«{evidence.quote}»</blockquote>}
      <Field label="Почему цитата не подходит" required hint="Хотя бы три знака. Причину увидят в истории сведения.">
        {control => <Textarea {...control} rows={3} value={reason} onChange={e => setReason(e.target.value)} />}
      </Field>
      {problem && <Callout tone="danger">{problem}</Callout>}
    </Dialog>
  );
};
