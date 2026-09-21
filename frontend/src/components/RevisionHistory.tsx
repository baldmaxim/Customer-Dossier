import { FC, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { api } from '../api/client';
import type { IDiffResponse, IRevision, IRevisionMeta } from '../api/types';
import { EnqueueRunButton } from './EnqueueRunButton';
import { CHRONOLOGY_LABELS, COMPLETENESS_LABELS, formatDateTime } from '../lib/labels';
import styles from './RevisionHistory.module.css';

interface IRevisionHistoryProps {
  itemId: number;
  latestRevisionId: number | null;
}

/**
 * Список редакций публикации, текст выбранной и построчное сравнение двух.
 * Текст выводится как текст: React экранирует всё, HTML источника не исполняется.
 */
export const RevisionHistory: FC<IRevisionHistoryProps> = ({ itemId, latestRevisionId }) => {
  const [shown, setShown] = useState<number | null>(null);
  const [compareFrom, setCompareFrom] = useState<number | null>(null);

  const listQuery = useQuery({
    queryKey: ['item', itemId, 'revisions'],
    queryFn: () => api.get<{ items: IRevisionMeta[] }>(`/api/items/${itemId}/revisions`),
  });

  const revisions = listQuery.data?.items ?? [];
  const shownId = shown ?? latestRevisionId ?? revisions[revisions.length - 1]?.id ?? null;

  const textQuery = useQuery({
    queryKey: ['revision', shownId],
    queryFn: () => api.get<{ revision: IRevision }>(`/api/revisions/${shownId}`),
    enabled: shownId !== null,
  });

  const diffQuery = useQuery({
    queryKey: ['revision', shownId, 'diff', compareFrom],
    queryFn: () => api.get<IDiffResponse>(`/api/revisions/${shownId}/diff?against=${compareFrom}`),
    enabled: shownId !== null && compareFrom !== null && compareFrom !== shownId,
  });

  if (listQuery.isLoading) return <p className={styles.muted}>Загрузка…</p>;

  const diff = diffQuery.data?.diff;

  return (
    <div className={styles.wrap}>
      <div className="scroll-x">
        <table className={styles.table}>
          <thead>
            <tr>
              <th>№</th>
              <th>Впервые увидели</th>
              <th>Полнота</th>
              <th>Порядок</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {revisions.map(r => (
              <tr key={r.id} className={r.id === shownId ? styles.rowActive : undefined}>
                <td className={styles.num}>
                  {r.revisionNo}
                  {r.id === latestRevisionId && <span className={styles.badge}>текущая</span>}
                </td>
                <td>{formatDateTime(r.firstObservedAt)}</td>
                <td>
                  {COMPLETENESS_LABELS[r.completeness]}
                  {r.attachments.length > 0 && (
                    <span className={styles.muted}> · вложения не прочитаны: {r.attachments.map(a => a.kind).join(', ')}</span>
                  )}
                </td>
                <td className={styles.muted}>
                  {CHRONOLOGY_LABELS[r.chronology] ?? r.chronology}
                  {r.sameContentAsRevisionId !== null && ' · текст совпадает с более ранней'}
                </td>
                <td>
                  <div className={styles.actions}>
                    <button type="button" className={styles.button} onClick={() => setShown(r.id)}>
                      Текст
                    </button>
                    <button
                      type="button"
                      className={styles.button}
                      disabled={r.id === shownId}
                      onClick={() => setCompareFrom(r.id)}
                    >
                      Сравнить с показанной
                    </button>
                    {/* Первый запуск по известной редакции ставится отсюда: существующий запуск для этого не нужен. */}
                    <EnqueueRunButton revisionId={r.id} className={styles.button} label="Поставить на разбор" />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {compareFrom !== null && compareFrom !== shownId && (
        <div className={styles.panel}>
          <div className={styles.panelHead}>
            Изменения: редакция {diffQuery.data?.from ?? '…'} → {diffQuery.data?.to ?? '…'}
            <button type="button" className={styles.button} onClick={() => setCompareFrom(null)}>
              Закрыть
            </button>
          </div>
          {diff && !diff.ok && <p className={styles.muted}>Сравнение недоступно: {diff.reason}</p>}
          {diff?.ok && (
            <pre className={styles.diff}>
              {diff.ops.map((op, index) =>
                op.op === 'skip' ? (
                  <span key={index} className={styles.skip}>
                    … без изменений: {op.count} стр.{'\n'}
                  </span>
                ) : (
                  op.lines.map((line, lineIndex) => (
                    <span
                      key={`${index}-${lineIndex}`}
                      className={op.op === 'insert' ? styles.ins : op.op === 'delete' ? styles.del : undefined}
                    >
                      {op.op === 'insert' ? '+ ' : op.op === 'delete' ? '− ' : '  '}
                      {line}
                      {'\n'}
                    </span>
                  ))
                ),
              )}
            </pre>
          )}
        </div>
      )}

      {textQuery.data && (
        <div className={styles.panel}>
          <div className={styles.panelHead}>
            Редакция {textQuery.data.revision.revisionNo} · {textQuery.data.revision.representation}
          </div>
          <pre className={styles.text}>{textQuery.data.revision.body}</pre>
        </div>
      )}
    </div>
  );
};
