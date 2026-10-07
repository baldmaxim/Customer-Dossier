// История объединений: что с чем объединено, кем и когда; отмена — пока у карточек не
// появилось новых связей. Если появились — отмена автоматически не делается, и это сказано
// словами, а технический план — под «Техническими подробностями».

import { FC, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError, api } from '../../api/client';
import type { ICompensatingPlan, IMergeHistoryItem } from '../../api/types';
import { formatCount } from '../../lib/format';
import { actorLabel, formatDateTime } from '../../lib/labels';
import { describeLoadError } from '../../lib/loadError';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { Cluster } from '../ui/Cluster';
import { useConfirm } from '../ui/confirm';
import { Disclosure } from '../ui/Disclosure';
import { EmptyState } from '../ui/EmptyState';
import { Icon } from '../ui/Icon';
import { Loading } from '../ui/Loading';
import { Stack } from '../ui/Stack';
import { useToast } from '../ui/toast';
import { VisuallyHidden } from '../ui/VisuallyHidden';
import { actionError } from '../../lib/actionError';
import styles from './Merge.module.css';

export const MergeHistory: FC = () => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [plan, setPlan] = useState<{ mergeId: number; plan: ICompensatingPlan } | null>(null);

  const history = useQuery({
    queryKey: ['merge-history'],
    queryFn: () => api.get<{ items: IMergeHistoryItem[] }>('/api/entities/merges'),
  });

  const undo = useMutation({
    mutationFn: (id: number) => api.post(`/api/entities/merges/${id}/undo`, { idempotencyKey: `ui-undo-${id}` }),
    onSuccess: () => {
      setPlan(null);
      void queryClient.invalidateQueries({ queryKey: ['merges'] });
      void queryClient.invalidateQueries({ queryKey: ['merge-history'] });
      toast.show({ tone: 'success', text: 'Объединение отменено: карточки снова отдельные.' });
    },
    onError: (err: Error, id) => {
      const body = err instanceof ApiError ? (err.body as { plan?: ICompensatingPlan } | null) : null;
      if (body?.plan) setPlan({ mergeId: id, plan: body.plan });
      else toast.show({ tone: 'danger', text: actionError(err) });
    },
  });

  const askUndo = async (h: IMergeHistoryItem): Promise<void> => {
    const ok = await confirm({
      title: 'Отменить объединение?',
      body: `«${h.sourceName ?? 'карточка'}» снова станет отдельной от «${h.targetName ?? 'карточки'}», связи вернутся к прежним.`,
      confirmLabel: 'Отменить объединение',
    });
    if (ok) undo.mutate(h.id);
  };

  if (history.isLoading) return <Loading label="Загружаю историю…" />;
  if (history.isError) {
    return (
      <Callout tone="danger" title="История не загрузилась" action={<Button onClick={() => void history.refetch()}>Повторить</Button>}>
        {describeLoadError(history.error)}
      </Callout>
    );
  }
  const items = history.data?.items ?? [];
  if (items.length === 0) return <EmptyState size="sm">Объединений ещё не было.</EmptyState>;

  return (
    <ul className={styles.history}>
      {items.map(h => {
        const changes = plan?.mergeId === h.id ? plan.plan.changes.reduce((n, c) => n + c.added.length + c.removed.length, 0) : 0;
        return (
          <li key={h.id} className={styles.historyRow}>
            <Cluster gap={[1, 2]} align="baseline">
              <span className={styles.entityName}>{h.sourceName ?? 'карточка без названия'}</span>
              <Icon name="forward" size="sm" className={styles.arrow} />
              <VisuallyHidden>объединена с</VisuallyHidden>
              <span className={styles.entityName}>{h.targetName ?? 'карточка без названия'}</span>
              {h.status === 'undone' && <Badge tone="neutral">отменено {formatDateTime(h.undoneAt)}</Badge>}
            </Cluster>
            <Cluster gap={2} justify="between">
              <span className={styles.muted}>
                {formatDateTime(h.createdAt)} · {actorLabel(h.actor)}
              </span>
              {h.status === 'applied' && (
                <Button size="sm" variant="ghost" loading={undo.isPending && undo.variables === h.id} onClick={() => void askUndo(h)}>
                  Отменить
                </Button>
              )}
            </Cluster>
            {plan?.mergeId === h.id && (
              <Stack gap={2}>
                <Callout tone="warning" title="Отменить автоматически нельзя">
                  После объединения у карточек появились или изменились связи ({formatCount(changes)}). Разделить карточки можно только
                  вручную, решив по каждой связи, к какой из них она относится.
                </Callout>
                {plan.plan.steps.length > 0 && (
                  <Disclosure summary="Технические подробности">
                    <ol className={styles.steps}>
                      <li>{plan.plan.reason}</li>
                      {plan.plan.steps.map(s => (
                        <li key={s}>{s}</li>
                      ))}
                    </ol>
                  </Disclosure>
                )}
              </Stack>
            )}
          </li>
        );
      })}
    </ul>
  );
};
