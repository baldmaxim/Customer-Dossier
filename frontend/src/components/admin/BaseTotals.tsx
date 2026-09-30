// Строка итогов «В базе: N компаний, M объектов, K текстов» и когда посчитаны показатели.
// Раньше те же числа стояли на «Конвейере» и на «Результате» — по одному разу на каждом.

import { FC } from 'react';
import { useQuery } from '@tanstack/react-query';

import { api } from '../../api/client';
import type { ISummaryResponse } from '../../api/types';
import { formatCountWord } from '../../lib/format';
import { formatDateTime } from '../../lib/labels';
import { describeLoadError } from '../../lib/loadError';
import { Loading } from '../ui/Loading';
import { Skeleton } from '../ui/Skeleton';
import styles from './Runs.module.css';

export const BaseTotals: FC = () => {
  const summary = useQuery({
    queryKey: ['summary'],
    queryFn: () => api.get<ISummaryResponse>('/api/contractors/summary'),
  });

  if (summary.isLoading) {
    return (
      <Loading label="Считаю, что в базе…">
        <Skeleton width="24rem" height="1.25em" />
      </Loading>
    );
  }
  if (summary.isError) return <p className={styles.totalsMuted}>Итоги по базе не получены: {describeLoadError(summary.error)}</p>;

  const totals = summary.data?.totals;
  const refresh = summary.data?.refresh;
  return (
    <div className={styles.totalsBlock}>
      <p className={styles.totals}>
        {totals ? (
          <>
            <span className={styles.totalsLead}>В базе:</span> {formatCountWord(totals.companies, ['компания', 'компании', 'компаний'])},{' '}
            {formatCountWord(totals.projects, ['объект', 'объекта', 'объектов'])},{' '}
            {formatCountWord(totals.documents, ['текст', 'текста', 'текстов'])}.
          </>
        ) : (
          'В базе пока пусто.'
        )}
      </p>
      <p className={styles.totalsMuted}>
        {refresh?.active
          ? `Показатели компаний посчитаны ${formatDateTime(refresh.active.cutoffAt)}${refresh.stale ? ' — устарели' : ''}.`
          : 'Показатели компаний ещё не считались.'}
      </p>
    </div>
  );
};
