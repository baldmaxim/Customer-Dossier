// Возможный дубль: две карточки с похожими названиями. «Сравнить» раскрывает сравнение,
// «Это разные …» убирает пару из списка (с подтверждением: вернуть её в список нечем).

import { FC } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '../../api/client';
import type { IPendingMerge } from '../../api/types';
import { MODEL_VERDICT_LABELS, formatPercent } from '../../lib/labels';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Cluster } from '../ui/Cluster';
import { useConfirm } from '../ui/confirm';
import { Icon } from '../ui/Icon';
import { Stack } from '../ui/Stack';
import { useToast } from '../ui/toast';
import { VisuallyHidden } from '../ui/VisuallyHidden';
import { actionError } from './actionError';
import { MergePreview } from './MergePreview';
import styles from './Merge.module.css';

interface IMergePairProps {
  pair: IPendingMerge;
  open: boolean;
  onToggle: (open: boolean) => void;
}

export const MergePair: FC<IMergePairProps> = ({ pair, open, onToggle }) => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const noun = pair.entityKind === 'company' ? 'компании' : 'объекты';

  const reject = useMutation({
    mutationFn: () => api.post(`/api/admin/merges/${pair.id}/reject`),
    onSuccess: () => {
      toast.show({ tone: 'success', text: `Отмечено: «${pair.sourceName}» и «${pair.targetName}» — разные ${noun}.` });
      void queryClient.invalidateQueries({ queryKey: ['merges'] });
    },
    onError: (err: Error) => toast.show({ tone: 'danger', text: actionError(err) }),
  });

  const askReject = async (): Promise<void> => {
    const ok = await confirm({
      title: `Это разные ${noun}?`,
      body: `«${pair.sourceName}» и «${pair.targetName}» уйдут из возможных дублей, обе карточки останутся как есть.`,
      confirmLabel: `Да, разные ${noun}`,
    });
    if (ok) reject.mutate();
  };

  return (
    <Card as="li" padding="md">
      <Stack gap={3}>
        <Cluster gap={[1, 2]} align="baseline" className={styles.pair}>
          <span className={styles.entityName}>{pair.sourceName}</span>
          <Icon name="forward" size="sm" className={styles.arrow} />
          <VisuallyHidden>и</VisuallyHidden>
          <span className={styles.entityName}>{pair.targetName}</span>
          <Badge tone="neutral">сходство {formatPercent(Number(pair.score))}</Badge>
        </Cluster>
        {pair.modelVerdict && (
          <p className={styles.modelVerdict}>
            <Badge tone={pair.modelVerdict === 'unsure' ? 'neutral' : 'info'}>{MODEL_VERDICT_LABELS[pair.modelVerdict] ?? pair.modelVerdict}</Badge>{' '}
            {pair.modelReason}
            {pair.decisionNote && <span className={styles.modelNote}> Не применено: {pair.decisionNote}</span>}
          </p>
        )}
        <Cluster gap={2}>
          <Button aria-expanded={open} iconEnd="chevron" onClick={() => onToggle(!open)}>
            {open ? 'Скрыть сравнение' : 'Сравнить'}
          </Button>
          <Button variant="ghost" loading={reject.isPending} onClick={() => void askReject()}>
            {pair.entityKind === 'company' ? 'Это разные компании' : 'Это разные объекты'}
          </Button>
        </Cluster>
        {open && <MergePreview pair={pair} onDone={() => onToggle(false)} />}
      </Stack>
    </Card>
  );
};
