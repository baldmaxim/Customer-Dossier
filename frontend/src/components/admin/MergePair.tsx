// Возможный дубль: две карточки с похожими названиями. «Одна компания? Да / Нет» (решение владельца
// 06.10.2026: без подтверждений): «Да» берёт свежее сравнение и объединяет по его токену — то, что
// мешает объединению, раскрывает сравнение; «Нет» убирает пару из списка. «Сравнить» — только смотреть.

import { FC, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '../../api/client';
import type { IMergePreview, IPendingMerge } from '../../api/types';
import { newKey } from '../../lib/idempotency';
import { MERGE_REASON_LABELS, MODEL_VERDICT_LABELS, formatPercent } from '../../lib/labels';
import { MODEL_HINT_TONE, toneOf } from '../../lib/statusTone';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Cluster } from '../ui/Cluster';
import { Icon } from '../ui/Icon';
import { Stack } from '../ui/Stack';
import { useToast } from '../ui/toast';
import { VisuallyHidden } from '../ui/VisuallyHidden';
import { actionError } from '../../lib/actionError';
import { MergePreview, mergeFailureText } from './MergePreview';
import styles from './Merge.module.css';

interface IMergePairProps {
  pair: IPendingMerge;
  open: boolean;
  onToggle: (open: boolean) => void;
}

export const MergePair: FC<IMergePairProps> = ({ pair, open, onToggle }) => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const noun = pair.entityKind === 'company' ? 'компании' : 'объекты';
  const question = pair.entityKind === 'company' ? 'Одна компания?' : 'Один объект?';
  // Один ключ на пару: повторное «Да» не объединяет дважды.
  const [key] = useState(() => newKey('merge'));

  const reject = useMutation({
    mutationFn: () => api.post(`/api/admin/merges/${pair.id}/reject`),
    onSuccess: () => {
      toast.show({ tone: 'success', text: `Отмечено: «${pair.sourceName}» и «${pair.targetName}» — разные ${noun}.` });
      void queryClient.invalidateQueries({ queryKey: ['merges'] });
    },
    onError: (err: Error) => toast.show({ tone: 'danger', text: actionError(err) }),
  });

  const merge = useMutation({
    mutationFn: async () => {
      // Сравнение — свежее: сервер примет только токен сравнения, сделанного по текущим версиям.
      const preview = await queryClient.fetchQuery({
        queryKey: ['merge-preview', pair.id],
        queryFn: () => api.get<IMergePreview>(`/api/admin/merges/${pair.id}/preview`),
        staleTime: 0,
      });
      if (!preview.canApply) return { blocked: preview.conflicts.map(c => c.message) };
      const result = await api.post<{ mergeId: number; replayed: boolean }>(`/api/admin/merges/${pair.id}/merge`, {
        expectedSourceVersion: preview.source.version,
        expectedTargetVersion: preview.target.version,
        idempotencyKey: key,
        expectedPreviewToken: preview.previewToken,
      });
      return { blocked: null, replayed: result.replayed };
    },
    onSuccess: result => {
      if (result.blocked) {
        toast.show({ tone: 'warning', text: `Объединить нельзя${result.blocked.length > 0 ? `: ${result.blocked.join('; ')}` : ''}.` });
        onToggle(true);
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ['merges'] });
      void queryClient.invalidateQueries({ queryKey: ['merge-history'] });
      toast.show({
        tone: 'success',
        text: result.replayed ? 'Эти карточки уже объединены.' : 'Карточки объединены. Отменить можно в «Истории объединений» ниже.',
      });
    },
    onError: (err: Error) => toast.show({ tone: 'danger', text: mergeFailureText(err) }),
  });
  const busy = merge.isPending || reject.isPending;

  // Пара по звучанию названия стоит в очереди с условным баллом — процент сходства ей не подпись.
  const reasonLabel = typeof pair.reasons.key === 'string' ? MERGE_REASON_LABELS[pair.reasons.key] : undefined;

  return (
    <Card as="li" padding="md">
      <Stack gap={3}>
        <Cluster gap={[1, 2]} align="baseline" className={styles.pair}>
          <span className={styles.entityName}>{pair.sourceName}</span>
          <Icon name="forward" size="sm" className={styles.arrow} />
          <VisuallyHidden>и</VisuallyHidden>
          <span className={styles.entityName}>{pair.targetName}</span>
          <Badge tone="neutral">{reasonLabel ?? `сходство ${formatPercent(Number(pair.score))}`}</Badge>
        </Cluster>
        {pair.modelVerdict && (
          <p className={styles.modelVerdict}>
            <Badge tone={toneOf(MODEL_HINT_TONE, pair.modelVerdict)}>{MODEL_VERDICT_LABELS[pair.modelVerdict] ?? pair.modelVerdict}</Badge>{' '}
            {pair.modelReason}
            {pair.decisionNote && <span className={styles.modelNote}> Не применено: {pair.decisionNote}</span>}
          </p>
        )}
        <Cluster gap={2}>
          <span>{question}</span>
          <Button aria-label="Да, объединить" loading={merge.isPending} disabled={busy} onClick={() => merge.mutate()}>
            Да
          </Button>
          <Button aria-label={`Нет, разные ${noun}`} loading={reject.isPending} disabled={busy} onClick={() => reject.mutate()}>
            Нет
          </Button>
          <Button variant="ghost" aria-expanded={open} iconEnd="chevron" onClick={() => onToggle(!open)}>
            {open ? 'Скрыть сравнение' : 'Сравнить'}
          </Button>
        </Cluster>
        {open && <MergePreview pair={pair} onDone={() => onToggle(false)} readOnly />}
      </Stack>
    </Card>
  );
};
