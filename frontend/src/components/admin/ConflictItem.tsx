// Одно противоречие: строка — о чём сведение, вид словами и дата; раскрытие — обе версии
// рядом с цитатами и решение оператора «Да / Нет» (AssertionDetail в режиме «Проверки»: форма
// решения раскрыта сразу, но видна только тому, у кого есть review.decide). Раньше строка была
// «П2 · противоречие источников», и чтобы узнать, о какой компании речь, её надо было раскрыть.

import { FC } from 'react';
import { useQuery } from '@tanstack/react-query';

import { api } from '../../api/client';
import type { IAssertion, IReviewQueueItem } from '../../api/types';
import { describeAssertion } from '../../lib/describeAssertion';
import { REVIEW_QUEUE_KIND_LABELS, formatDate } from '../../lib/labels';
import { AssertionDetail } from '../AssertionDetail';
import { Callout } from '../ui/Callout';
import { Disclosure } from '../ui/Disclosure';
import { Heading } from '../ui/Heading';
import { HeadingLevelContext } from '../ui/headingLevel';
import { Stack } from '../ui/Stack';
import styles from './Review.module.css';

/** Вторая сторона противоречия — рядом, со своими цитатами и историей решений. */
export const otherAssertion = (item: IReviewQueueItem): number | null => {
  const value = item.detail.negativeAssertionId ?? item.detail.otherAssertionId;
  return typeof value === 'number' ? value : null;
};

export const conflictKey = (item: IReviewQueueItem): string => `${item.kind}-${item.refId}-${otherAssertion(item) ?? ''}`;

interface IConflictItemProps {
  item: IReviewQueueItem;
  open: boolean;
  onToggle: (open: boolean) => void;
}

export const ConflictItem: FC<IConflictItemProps> = ({ item, open, onToggle }) => {
  const other = otherAssertion(item);
  // Тот же ключ и тот же запрос, что у AssertionDetail: раскрытие не загружает сведение второй раз.
  const main = useQuery({
    queryKey: ['assertion', item.assertionId],
    queryFn: () => api.get<{ assertion: IAssertion }>(`/api/assertions/${item.assertionId}`),
    enabled: item.assertionId !== null,
  });
  const kindLabel = REVIEW_QUEUE_KIND_LABELS[item.kind] ?? item.kind;
  const title =
    item.assertionId === null
      ? typeof item.detail.surface === 'string'
        ? `«${item.detail.surface}»`
        : kindLabel
      : main.data
        ? describeAssertion(main.data.assertion)
        : main.isError
          ? 'Сведение не загрузилось'
          : 'Загружаю сведение…';

  return (
    <li>
      <Disclosure
        variant="card"
        level={2}
        open={open}
        onToggle={onToggle}
        summary={
          <span className={styles.summary}>
            <span className={styles.summaryTitle}>{title}</span>
            <span className={styles.summaryMeta}>
              {kindLabel} · с {formatDate(item.since)}
            </span>
          </span>
        }
      >
        {open && item.assertionId !== null && (
          <Stack gap={4}>
            {item.kind === 'correction' && (
              <Callout tone="info">После решения появились новые цитаты — проверьте сведение ещё раз.</Callout>
            )}
            <div className={other ? styles.columns : undefined}>
              <HeadingLevelContext.Provider value={3}>
                <Stack gap={2}>
                  {other && <Heading className={styles.columnTitle}>Сведение</Heading>}
                  <HeadingLevelContext.Provider value={other ? 4 : 3}>
                    <AssertionDetail assertionId={item.assertionId} mode="review" showSummary={other !== null} />
                  </HeadingLevelContext.Provider>
                </Stack>
                {other && (
                  <Stack gap={2}>
                    <Heading className={styles.columnTitle}>
                      {item.kind === 'polarity_conflict' ? 'Отрицание' : 'Другая компания в той же роли'}
                    </Heading>
                    <HeadingLevelContext.Provider value={4}>
                      <AssertionDetail assertionId={other} mode="review" />
                    </HeadingLevelContext.Provider>
                  </Stack>
                )}
              </HeadingLevelContext.Provider>
            </div>
          </Stack>
        )}
      </Disclosure>
    </li>
  );
};
