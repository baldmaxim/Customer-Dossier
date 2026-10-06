// Сравнение двух карточек перед объединением: что с чем объединится, что переедет, что мешает.
// Объединяется ровно то, что сравнили: сервер примет только токен этого сравнения, а если
// карточки успели измениться — откажет, и сравнение обновится.
//
// Пара — из «Проверка → Дубли» (pair) или любая (adhoc): «это компания X» в карточке имени без ИНН
// (ADR-016) — тот же предпросмотр и то же применение через /api/entities/merge*.

import { FC, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError, api } from '../../api/client';
import type { IMergePreview, IPendingMerge } from '../../api/types';
import { newKey } from '../../lib/idempotency';
import { MERGE_COUNT_LABELS } from '../../lib/labels';
import { describeLoadError } from '../../lib/loadError';
import { formatCount } from '../../lib/format';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { useConfirm } from '../ui/confirm';
import { Loading } from '../ui/Loading';
import { Stack } from '../ui/Stack';
import { useToast } from '../ui/toast';
import { MergeEntityCard } from './MergeEntityCard';
import styles from './Merge.module.css';

interface IMergePreviewProps {
  /** Пара очереди «Дубли». */
  pair?: IPendingMerge;
  /** Любая пара: источник войдёт в цель; по умолчанию — компании. */
  adhoc?: { sourceId: number; targetId: number; kind?: 'company' | 'project' };
  onDone: () => void;
  /** Тост после объединения; по умолчанию — про «Историю объединений» ниже. */
  doneText?: string;
  /** Только сравнение: решение «Да / Нет» принимает строка пары (MergePair). */
  readOnly?: boolean;
}

export const mergeFailureText = (err: unknown): string => {
  if (err instanceof ApiError && (err.code === 'version_conflict' || err.code === 'merge_preview_stale')) {
    return 'Данные изменились после сравнения — оно обновлено. Проверьте ещё раз.';
  }
  if (err instanceof ApiError && err.code === 'blocked') {
    return 'Объединение сейчас выключено в настройках сервера: сравнить можно, объединить нельзя.';
  }
  return err instanceof ApiError && err.status < 500 ? err.message : describeLoadError(err);
};

export const MergePreview: FC<IMergePreviewProps> = ({ pair, adhoc, onDone, doneText, readOnly = false }) => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  // Один ключ на открытое сравнение: повторное нажатие не объединяет дважды.
  const [key] = useState(() => newKey('merge'));
  const [error, setError] = useState<string | null>(null);

  const previewUrl = pair
    ? `/api/admin/merges/${pair.id}/preview`
    : `/api/entities/merge-preview?kind=${adhoc?.kind ?? 'company'}&sourceId=${adhoc?.sourceId}&targetId=${adhoc?.targetId}`;
  const previewQuery = useQuery({
    queryKey: pair ? ['merge-preview', pair.id] : ['merge-preview', 'adhoc', adhoc?.kind ?? 'company', adhoc?.sourceId, adhoc?.targetId],
    queryFn: () => api.get<IMergePreview>(previewUrl),
    // Сравнение не подменяется молча фоновым обновлением: объединяется ровно то, что видели.
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });

  const apply = useMutation({
    mutationFn: (preview: IMergePreview) => {
      const body = {
        expectedSourceVersion: preview.source.version,
        expectedTargetVersion: preview.target.version,
        idempotencyKey: key,
        expectedPreviewToken: preview.previewToken,
      };
      return pair
        ? api.post<{ mergeId: number; replayed: boolean }>(`/api/admin/merges/${pair.id}/merge`, body)
        : api.post<{ mergeId: number; replayed: boolean }>('/api/entities/merge', {
            ...body,
            kind: adhoc?.kind ?? 'company',
            sourceId: adhoc?.sourceId,
            targetId: adhoc?.targetId,
          });
    },
    onSuccess: result => {
      void queryClient.invalidateQueries({ queryKey: ['merges'] });
      void queryClient.invalidateQueries({ queryKey: ['merge-history'] });
      toast.show({
        tone: 'success',
        text: result.replayed
          ? 'Эти карточки уже объединены.'
          : (doneText ?? 'Карточки объединены. Отменить можно в «Истории объединений» ниже.'),
      });
      onDone();
    },
    onError: (err: Error) => {
      setError(mergeFailureText(err));
      if (err instanceof ApiError && (err.code === 'version_conflict' || err.code === 'merge_preview_stale')) void previewQuery.refetch();
    },
  });

  if (previewQuery.isLoading) return <Loading label="Сравниваю карточки…" />;
  if (previewQuery.isError || !previewQuery.data) {
    return (
      <Callout tone="danger" title="Сравнить не удалось" action={<Button onClick={() => void previewQuery.refetch()}>Повторить</Button>}>
        {describeLoadError(previewQuery.error)}
      </Callout>
    );
  }
  const preview = previewQuery.data;
  const counts = Object.entries(preview.counts).filter(([, v]) => v > 0);

  const ask = async (): Promise<void> => {
    const ok = await confirm({
      title: 'Объединить карточки?',
      body: `«${preview.source.name}» войдёт в «${preview.target.name}». Объединить легко, разделить почти невозможно: отменить можно, только пока у карточек не появилось новых связей.`,
      confirmLabel: 'Объединить',
      tone: 'danger',
    });
    if (!ok) return;
    setError(null);
    apply.mutate(preview);
  };

  return (
    <Stack gap={3} className={styles.preview}>
      <div className={styles.entities}>
        <MergeEntityCard role="Эта карточка" entity={preview.source} kind={preview.kind} />
        <MergeEntityCard role="войдёт в" entity={preview.target} kind={preview.kind} />
      </div>
      {counts.length > 0 && (
        <p className={styles.muted}>
          Переедет: {counts.map(([k, v]) => `${formatCount(v)} ${MERGE_COUNT_LABELS[k] ?? 'записей'}`).join(', ')}.
        </p>
      )}
      {preview.conflicts.map(c => (
        <p key={`${c.code}-${c.message}`} className={styles.conflict}>
          Нельзя: {c.message}
        </p>
      ))}
      {preview.warnings.map(w => (
        <p key={w} className={styles.warn}>
          {w}
        </p>
      ))}
      {error && <Callout tone="danger">{error}</Callout>}
      {!readOnly && (
        <div>
          <Button variant="primary" disabled={!preview.canApply} loading={apply.isPending} onClick={() => void ask()}>
            Объединить
          </Button>
        </div>
      )}
    </Stack>
  );
};
