import { FC, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import type { IReviewQueueItem } from '../api/types';
import { AmbiguityDetail } from '../components/AmbiguityDetail';
import { AmbiguityList } from '../components/AmbiguityList';
import { AssertionDetail } from '../components/AssertionDetail';
import { REVIEW_QUEUE_KIND_LABELS, formatDateTime } from '../lib/labels';
import styles from './Dossier.module.css';

const KINDS = ['all', 'identity', 'polarity_conflict', 'role_period_conflict', 'correction', 'dispute'] as const;

/** Вторая сторона противоречия — рядом, со своими доказательствами и историей решений. */
const otherAssertion = (item: IReviewQueueItem): number | null => {
  const value = item.detail.negativeAssertionId ?? item.detail.otherAssertionId;
  return typeof value === 'number' ? value : null;
};

/**
 * Очередь проверки: нерешённая идентификация, противоречие источников, изменившаяся доказательная база, спор.
 * Обе версии рядом с точными цитатами и прошлыми решениями; решение пишется с версией (две вкладки не затирают друг друга).
 */
export const ReviewQueuePage: FC = () => {
  const [kind, setKind] = useState<(typeof KINDS)[number]>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['review-queue', kind],
    queryFn: () => api.get<{ items: IReviewQueueItem[] }>(`/api/review-queue?limit=100${kind === 'all' ? '' : `&kind=${kind}`}`),
    // Идентичность разбирается постраничным списком неоднозначностей (этап 15A): первые 100 — не весь backlog.
    enabled: kind !== 'identity',
  });
  const items = query.data?.items ?? [];

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Очередь проверки</h1>
        <p className={styles.meta}>По приоритету: идентичность → противоречие источников → изменилась доказательная база → спор.</p>
        <label className={styles.field}>
          <span>Вид</span>
          <select value={kind} onChange={e => setKind(e.target.value as (typeof KINDS)[number])}>
            {KINDS.map(k => (
              <option key={k} value={k}>
                {k === 'all' ? 'все' : REVIEW_QUEUE_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
      </header>

      {kind === 'identity' ? (
        <AmbiguityList />
      ) : (
      <section className={styles.section}>
        {query.isLoading && <p className={styles.meta}>Загрузка…</p>}
        {query.isError && (
          <p className={styles.error} role="alert">
            Очередь недоступна: {(query.error as Error).message}
          </p>
        )}
        {query.isSuccess && items.length === 0 && <p className={styles.meta}>Очередь пуста.</p>}
        <ul className={styles.list}>
          {items.map(item => {
            const key = `${item.kind}:${item.refId}:${otherAssertion(item) ?? ''}`;
            const open = selected === key;
            const other = otherAssertion(item);
            return (
              <li key={key} className={styles.listItem}>
                <div className={styles.row}>
                  <strong>
                    П{item.priority} · {REVIEW_QUEUE_KIND_LABELS[item.kind] ?? item.kind}
                  </strong>
                  <span className={styles.meta}>с {formatDateTime(item.since)}</span>
                  {item.kind === 'identity' ? (
                    <button type="button" className={styles.linkButton} aria-expanded={open} onClick={() => setSelected(open ? null : key)}>
                      {open ? 'свернуть' : 'разобрать упоминание'}
                    </button>
                  ) : (
                    <button type="button" className={styles.linkButton} aria-expanded={open} onClick={() => setSelected(open ? null : key)}>
                      {open ? 'свернуть' : other ? 'сравнить версии' : 'открыть'}
                    </button>
                  )}
                </div>
                {item.kind === 'identity' && (
                  <p className={styles.meta}>
                    «{String(item.detail.surface ?? '')}» — кандидатов: {Array.isArray(item.detail.candidates) ? item.detail.candidates.length : '—'}
                  </p>
                )}
                {item.kind === 'identity' && open && <AmbiguityDetail ambiguityId={item.refId} />}
                {item.kind === 'identity' && (
                  <p className={styles.meta}>
                    Глобальное слияние одноимённых сущностей — только в <Link to="/admin">очереди слияний</Link> после предпросмотра.
                  </p>
                )}
                {item.kind === 'correction' && open && (
                  <p className={styles.meta}>
                    Набор доказательств изменился после последнего решения. Редакции публикации и их различия — по ссылке «версии» у доказательства.
                  </p>
                )}
                {open && item.assertionId !== null && (
                  <div className={styles.columns}>
                    <div>
                      <p className={styles.statusLine}>{other ? 'Утверждение' : 'Утверждение и основания'}</p>
                      <AssertionDetail assertionId={item.assertionId} />
                    </div>
                    {other && (
                      <div>
                        <p className={styles.statusLine}>{item.kind === 'polarity_conflict' ? 'Отрицание' : 'Другая компания в той же роли'}</p>
                        <AssertionDetail assertionId={other} />
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
      )}
    </div>
  );
};
