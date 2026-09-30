// Вкладка «Дубли»: возможные дубли карточек и история объединений.
//
// Объединить легко, разделить почти невозможно — поэтому в спорных случаях портал заводит
// отдельную карточку и кладёт пару сюда, а не объединяет сам. Решает оператор: одна это
// компания или разные. Раскрытое сравнение — в адресе.

import { FC } from 'react';
import { useQuery } from '@tanstack/react-query';

import { LoadingSkeleton } from './LoadingSkeleton';
import { stringParam, useUrlState } from '../hooks/useUrlState';
import { formatCount } from '../lib/format';
import { describeLoadError } from '../lib/loadError';
import { MergeHistory } from './admin/MergeHistory';
import { MergePair } from './admin/MergePair';
import { mergesQuery } from './admin/reviewQueries';
import { Button } from './ui/Button';
import { Callout } from './ui/Callout';
import { EmptyState } from './ui/EmptyState';
import { Section } from './ui/Section';
import { Stack } from './ui/Stack';
import styles from './admin/Merge.module.css';

export const MergeQueuePanel: FC = () => {
  const [open, setOpen] = useUrlState('open', stringParam());
  const merges = useQuery(mergesQuery);
  const items = merges.data?.items ?? [];

  return (
    <Stack gap={5}>
      <p className={styles.intro}>
        Портал не объединяет похожие карточки сам: решите, одна это компания (или объект) или разные. Разные реквизиты, бренд и юрлицо,
        разные города и корпуса не объединяются — сравнение это покажет.
      </p>

      <Section title="Возможные дубли" note={merges.isSuccess ? formatCount(items.length) : undefined} variant="plain">
        {merges.isLoading && (
          <LoadingSkeleton label="Загружаю возможные дубли…" lines={3} height="96px" />
        )}
        {merges.isError && (
          <Callout tone="danger" title="Список не загрузился" action={<Button onClick={() => void merges.refetch()}>Повторить</Button>}>
            {describeLoadError(merges.error)}
          </Callout>
        )}
        {merges.isSuccess && items.length === 0 && <EmptyState size="sm">Возможных дублей нет.</EmptyState>}
        {items.length > 0 && (
          <ul className={styles.pairs}>
            {items.map(m => (
              <MergePair key={m.id} pair={m} open={open === String(m.id)} onToggle={next => setOpen(next ? String(m.id) : '')} />
            ))}
          </ul>
        )}
      </Section>

      <Section title="История объединений" variant="plain">
        <MergeHistory />
      </Section>
    </Stack>
  );
};
