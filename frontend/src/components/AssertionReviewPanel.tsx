import { FC, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { api } from '../api/client';
import type { IAssertion } from '../api/types';
import { describeAssertion } from '../lib/describeAssertion';
import { ASSERTION_STATUS_LABELS } from '../lib/labels';
import { AssertionDetail } from './AssertionDetail';
import styles from './AssertionReviewPanel.module.css';

type Filter = 'revalidation' | 'text_grounded' | 'disputed' | 'reviewed_supported' | 'all';

const FILTERS: Array<{ value: Filter; label: string; query: string }> = [
  { value: 'revalidation', label: 'Нужен пересмотр', query: 'needsRevalidation=true' },
  { value: 'text_grounded', label: 'Есть в тексте', query: 'status=text_grounded' },
  { value: 'disputed', label: 'Спорные', query: 'status=disputed' },
  { value: 'reviewed_supported', label: 'Подтверждённые', query: 'status=reviewed_supported' },
  { value: 'all', label: 'Все', query: '' },
];

/** Очередь проверки утверждений: что написано в источниках и что решил аналитик. */
export const AssertionReviewPanel: FC = () => {
  const [filter, setFilter] = useState<Filter>('revalidation');
  const [selected, setSelected] = useState<number | null>(null);
  const query = FILTERS.find(f => f.value === filter)?.query ?? '';

  const listQuery = useQuery({
    queryKey: ['assertions', filter],
    queryFn: () => api.get<{ items: IAssertion[] }>(`/api/assertions?limit=50${query ? `&${query}` : ''}`),
  });
  const items = listQuery.data?.items ?? [];

  return (
    <div className={styles.panel}>
      <div className={styles.filters} role="group" aria-label="Фильтр утверждений">
        {FILTERS.map(f => (
          <button
            key={f.value}
            type="button"
            aria-pressed={filter === f.value}
            className={`${styles.filter} ${filter === f.value ? styles.filterActive : ''}`}
            onClick={() => {
              setFilter(f.value);
              setSelected(null);
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {listQuery.isLoading && <p className={styles.muted}>Загрузка…</p>}
      {listQuery.isSuccess && items.length === 0 && <p className={styles.muted}>Утверждений нет.</p>}

      <div className={styles.list} role="list">
        {items.map(a => (
          <button
            key={a.id}
            type="button"
            role="listitem"
            aria-pressed={selected === a.id}
            className={`${styles.item} ${selected === a.id ? styles.itemActive : ''}`}
            onClick={() => setSelected(selected === a.id ? null : a.id)}
          >
            <span className={styles.itemText}>{describeAssertion(a)}</span>
            <span className={styles.itemMeta}>
              {ASSERTION_STATUS_LABELS[a.status]}
              {a.needsRevalidation && ' · нужен пересмотр'} · за {a.supportsCount}
              {a.contradictsCount > 0 && ` · против ${a.contradictsCount}`}
            </span>
          </button>
        ))}
      </div>

      {selected !== null && <AssertionDetail assertionId={selected} />}
    </div>
  );
};
