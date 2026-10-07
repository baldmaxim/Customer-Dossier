// Строка итогов «В базе: N компаний, M групп, K имён без ИНН, объекты, тексты». Компании — те же числа, что вкладки
// каталога на главной (одно правило, что считается компанией), тексты — публикации, как в списке источников.

import { FC } from 'react';
import { useQuery } from '@tanstack/react-query';

import { api } from '../../api/client';
import type { ISummaryResponse } from '../../api/types';
import { formatCountWord } from '../../lib/format';
import { describeLoadError } from '../../lib/loadError';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { Loading } from '../ui/Loading';
import { Skeleton } from '../ui/Skeleton';
import styles from './Runs.module.css';

export const BaseTotals: FC = () => {
  const summary = useQuery({
    queryKey: ['summary'],
    queryFn: () => api.get<ISummaryResponse>('/api/admin/summary'),
  });

  if (summary.isLoading) {
    return (
      <Loading label="Считаю, что в базе…">
        <Skeleton width="24rem" height="1.25em" />
      </Loading>
    );
  }
  if (summary.isError) {
    return (
      <Callout
        tone="danger"
        title="Итоги по базе не получены"
        action={
          <Button size="sm" onClick={() => void summary.refetch()}>
            Повторить
          </Button>
        }
      >
        {describeLoadError(summary.error)}
      </Callout>
    );
  }

  const totals = summary.data?.totals;
  return (
    <div className={styles.totalsBlock}>
      <p className={styles.totals}>
        {totals ? (
          <>
            <span className={styles.totalsLead}>В базе:</span> {formatCountWord(totals.companies, ['компания', 'компании', 'компаний'])},{' '}
            {formatCountWord(totals.groups, ['группа', 'группы', 'групп'])},{' '}
            {formatCountWord(totals.unidentified, ['имя без ИНН', 'имени без ИНН', 'имён без ИНН'])},{' '}
            {formatCountWord(totals.projects, ['объект', 'объекта', 'объектов'])},{' '}
            {formatCountWord(totals.documents, ['текст', 'текста', 'текстов'])}.
          </>
        ) : (
          'В базе пока пусто.'
        )}
      </p>
    </div>
  );
};
