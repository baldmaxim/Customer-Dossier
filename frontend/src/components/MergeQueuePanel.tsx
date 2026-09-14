import { FC, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError, api } from '../api/client';
import type {
  ICompensatingPlan,
  IMergeEntitySummary,
  IMergeHistoryItem,
  IMergePreview,
  IPendingMerge,
} from '../api/types';
import {
  ENTITY_TYPE_LABELS,
  MERGE_COUNT_LABELS,
  PROJECT_LEVEL_LABELS,
  formatDateTime,
} from '../lib/labels';
import styles from './MergeQueuePanel.module.css';

const newKey = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `merge-${Date.now()}-${Math.random()}`;

const EntityCard: FC<{ title: string; entity: IMergeEntitySummary; kind: IMergePreview['kind'] }> = ({ title, entity, kind }) => (
  <div className={styles.entity}>
    <span className={styles.entityTitle}>{title}</span>
    <strong>
      {entity.name} <span className={styles.muted}>#{entity.id} · версия {entity.version}</span>
    </strong>
    <span className={styles.muted}>
      {kind === 'company'
        ? `${ENTITY_TYPE_LABELS[entity.entityType ?? 'unknown'] ?? entity.entityType}${entity.legalForm ? ` · ${entity.legalForm}` : ''}`
        : (PROJECT_LEVEL_LABELS[entity.projectLevel ?? 'complex'] ?? entity.projectLevel)}
      {' · '}
      {entity.city ?? 'город неизвестен'}
    </span>
    <span className={styles.muted}>
      {entity.identifiers.length > 0 ? entity.identifiers.map(i => `${i.type} ${i.value}`).join(', ') : 'реквизитов нет'}
    </span>
  </div>
);

const PreviewBlock: FC<{
  pair: IPendingMerge;
  onDone: (message: string) => void;
}> = ({ pair, onDone }) => {
  const queryClient = useQueryClient();
  // Один ключ на открытый предпросмотр: повторное нажатие не сливает дважды.
  const [key] = useState(newKey);
  const [error, setError] = useState<string | null>(null);

  const previewQuery = useQuery({
    queryKey: ['merge-preview', pair.id],
    queryFn: () => api.get<IMergePreview>(`/api/admin/merges/${pair.id}/preview`),
  });

  const apply = useMutation({
    mutationFn: (preview: IMergePreview) =>
      api.post<{ mergeId: number; replayed: boolean }>(`/api/admin/merges/${pair.id}/merge`, {
        expectedSourceVersion: preview.source.version,
        expectedTargetVersion: preview.target.version,
        idempotencyKey: key,
      }),
    onSuccess: result => {
      void queryClient.invalidateQueries({ queryKey: ['merges'] });
      void queryClient.invalidateQueries({ queryKey: ['merge-history'] });
      onDone(result.replayed ? 'Слияние уже было применено.' : `Слияние #${result.mergeId} применено. Его можно отменить в журнале.`);
    },
    onError: (err: Error) => {
      if (err instanceof ApiError && err.code === 'version_conflict') {
        setError('Сущности изменились после предпросмотра — данные обновлены, проверьте ещё раз.');
        void previewQuery.refetch();
      } else {
        setError(err.message);
      }
    },
  });

  if (previewQuery.isLoading) return <p className={styles.muted}>Загрузка предпросмотра…</p>;
  if (previewQuery.isError || !previewQuery.data) return <p className={styles.error}>Предпросмотр недоступен.</p>;
  const preview = previewQuery.data;
  const counts = Object.entries(preview.counts).filter(([, v]) => v > 0);

  return (
    <div className={styles.preview}>
      <div className={styles.entities}>
        <EntityCard title="Сливается" entity={preview.source} kind={preview.kind} />
        <EntityCard title="В" entity={preview.target} kind={preview.kind} />
      </div>
      {counts.length > 0 && (
        <ul className={styles.counts}>
          {counts.map(([k, v]) => (
            <li key={k}>
              {v} {MERGE_COUNT_LABELS[k] ?? k}
            </li>
          ))}
        </ul>
      )}
      {preview.conflicts.map(c => (
        <p key={`${c.code}-${c.message}`} className={styles.error}>
          Нельзя: {c.message}
        </p>
      ))}
      {preview.warnings.map(w => (
        <p key={w} className={styles.warn}>
          {w}
        </p>
      ))}
      {error && <p className={styles.error}>{error}</p>}
      <button
        type="button"
        className={styles.primary}
        disabled={!preview.canApply || apply.isPending}
        onClick={() => {
          setError(null);
          apply.mutate(preview);
        }}
      >
        Слить
      </button>
    </div>
  );
};

export const MergeQueuePanel: FC<{ onNotice: (message: string) => void }> = ({ onNotice }) => {
  const queryClient = useQueryClient();
  const [openId, setOpenId] = useState<number | null>(null);
  const [plan, setPlan] = useState<{ mergeId: number; plan: ICompensatingPlan } | null>(null);

  const mergesQuery = useQuery({
    queryKey: ['merges'],
    queryFn: () => api.get<{ items: IPendingMerge[] }>('/api/admin/merges'),
  });
  const historyQuery = useQuery({
    queryKey: ['merge-history'],
    queryFn: () => api.get<{ items: IMergeHistoryItem[] }>('/api/entities/merges'),
  });

  const reject = useMutation({
    mutationFn: (id: number) => api.post(`/api/admin/merges/${id}/reject`, { decidedBy: 'operator' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['merges'] }),
    onError: (err: Error) => onNotice(err.message),
  });

  const undo = useMutation({
    mutationFn: (id: number) => api.post(`/api/entities/merges/${id}/undo`, { idempotencyKey: `ui-undo-${id}` }),
    onSuccess: () => {
      setPlan(null);
      void queryClient.invalidateQueries({ queryKey: ['merges'] });
      void queryClient.invalidateQueries({ queryKey: ['merge-history'] });
      onNotice('Слияние отменено: сущности и связи восстановлены.');
    },
    onError: (err: Error, id) => {
      const body = err instanceof ApiError ? (err.body as { plan?: ICompensatingPlan } | null) : null;
      if (body?.plan) setPlan({ mergeId: id, plan: body.plan });
      else onNotice(err.message);
    },
  });

  const merges = mergesQuery.data?.items ?? [];
  const history = historyQuery.data?.items ?? [];

  return (
    <div className={styles.panel}>
      <p className={styles.muted}>
        Резолвер в спорных случаях создаёт отдельную сущность и ставит пару сюда. Слияние — только после предпросмотра:
        разные реквизиты, бренд и юрлицо, разные города и корпуса не сливаются. Применение включается флагом
        MERGE_APPLY_ENABLED.
      </p>

      {merges.length === 0 ? (
        <p className={styles.muted}>Пар на подтверждение нет.</p>
      ) : (
        merges.map(m => (
          <div key={m.id} className={styles.card}>
            <div className={styles.pair}>
              <span className={styles.name}>{m.sourceName}</span>
              <span className={styles.muted}>→</span>
              <span className={styles.name}>{m.targetName}</span>
              <span className={styles.score}>{Number(m.score).toFixed(2)}</span>
            </div>
            <div className={styles.actions}>
              <button type="button" className={styles.secondary} onClick={() => setOpenId(openId === m.id ? null : m.id)}>
                {openId === m.id ? 'Скрыть' : 'Предпросмотр'}
              </button>
              <button type="button" className={styles.secondary} disabled={reject.isPending} onClick={() => reject.mutate(m.id)}>
                Разные
              </button>
            </div>
            {openId === m.id && (
              <PreviewBlock
                pair={m}
                onDone={message => {
                  setOpenId(null);
                  onNotice(message);
                }}
              />
            )}
          </div>
        ))
      )}

      {history.length > 0 && (
        <>
          <h3 className={styles.subhead}>Журнал слияний</h3>
          {history.map(h => (
            <div key={h.id} className={styles.historyRow}>
              <span>
                #{h.id} {h.sourceName ?? h.sourceId} → {h.targetName ?? h.targetId}
              </span>
              <span className={styles.muted}>
                {formatDateTime(h.createdAt)} · {h.actor}
                {h.status === 'undone' ? ` · отменено ${formatDateTime(h.undoneAt)}` : ''}
              </span>
              {h.status === 'applied' && (
                <button type="button" className={styles.secondary} disabled={undo.isPending} onClick={() => undo.mutate(h.id)}>
                  Отменить
                </button>
              )}
              {plan?.mergeId === h.id && (
                <div className={styles.plan}>
                  <p className={styles.warn}>Простая отмена небезопасна: {plan.plan.reason}.</p>
                  <ul className={styles.counts}>
                    {plan.plan.changes.map(c => (
                      <li key={c.dependency}>
                        {c.dependency}: новых {c.added.length}, изменено {c.removed.length}
                      </li>
                    ))}
                  </ul>
                  <ol className={styles.steps}>
                    {plan.plan.steps.map(s => (
                      <li key={s}>{s}</li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
};
