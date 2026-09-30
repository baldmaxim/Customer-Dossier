// Вкладка «Противоречия»: источники спорят друг с другом, две компании в одной роли, цитаты
// изменились после решения, сведение оспаривается. Вид и раскрытая строка — в адресе.

import { FC, useState } from 'react';
import { useQueries } from '@tanstack/react-query';

import { LoadingSkeleton } from '../LoadingSkeleton';
import { enumParam, stringParam, useUrlState } from '../../hooks/useUrlState';
import { formatCount } from '../../lib/format';
import { REVIEW_QUEUE_KIND_LABELS } from '../../lib/labels';
import { describeLoadError } from '../../lib/loadError';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { EmptyState } from '../ui/EmptyState';
import { Field } from '../ui/Field';
import { Select } from '../ui/Select';
import { Stack } from '../ui/Stack';
import { ConflictItem, conflictKey } from './ConflictItem';
import { CONFLICT_KINDS, QUEUE_LIMIT, reviewQueueQuery, type ConflictKind } from './reviewQueries';
import styles from './Review.module.css';

/** Сколько строк показывать за раз: каждая строка загружает своё сведение для заголовка. */
const STEP = 20;
const KIND_VALUES: readonly ('all' | ConflictKind)[] = ['all', ...CONFLICT_KINDS];

export const ConflictsPanel: FC = () => {
  const [kind, setKind] = useUrlState('kind', enumParam(KIND_VALUES, 'all'));
  const [open, setOpen] = useUrlState('open', stringParam());
  const [shown, setShown] = useState(STEP);
  const results = useQueries({ queries: CONFLICT_KINDS.map(reviewQueueQuery) });

  if (results.some(r => r.isLoading)) {
    return (
      <LoadingSkeleton label="Загружаю противоречия…" lines={4} height="56px" />
    );
  }
  const failed = results.find(r => r.isError);
  if (failed) {
    return (
      <Callout
        tone="danger"
        title="Противоречия не загрузились"
        action={<Button onClick={() => results.forEach(r => void r.refetch())}>Повторить</Button>}
      >
        {describeLoadError(failed.error)}
      </Callout>
    );
  }

  const all = results
    .flatMap(r => r.data?.items ?? [])
    .sort((a, b) => a.priority - b.priority || Date.parse(b.since) - Date.parse(a.since));
  const items = kind === 'all' ? all : all.filter(i => i.kind === kind);
  const truncated = results.some(r => (r.data?.items.length ?? 0) >= QUEUE_LIMIT);

  return (
    <Stack gap={4}>
      <div className={styles.filters}>
        <Field label="Вид">
          {control => (
            <Select
              {...control}
              block={false}
              value={kind}
              onChange={e => {
                setKind(e.target.value as 'all' | ConflictKind);
                setShown(STEP);
              }}
            >
              <option value="all">все</option>
              {CONFLICT_KINDS.map(k => (
                <option key={k} value={k}>
                  {REVIEW_QUEUE_KIND_LABELS[k]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <span className={styles.count}>
          {formatCount(items.length)}
          {truncated ? ' — показаны первые по каждому виду' : ''}
        </span>
      </div>

      {items.length === 0 ? (
        <EmptyState size="sm">{kind === 'all' ? 'Противоречий нет.' : 'Такого вида противоречий нет.'}</EmptyState>
      ) : (
        <ul className={styles.list}>
          {items.slice(0, shown).map(item => {
            const key = conflictKey(item);
            return (
              <ConflictItem
                key={key}
                item={item}
                open={open === key}
                onToggle={next => {
                  if (next) setOpen(key);
                  else if (open === key) setOpen('');
                }}
              />
            );
          })}
        </ul>
      )}
      {items.length > shown && (
        <div>
          <Button onClick={() => setShown(n => n + STEP)}>Показать ещё {formatCount(Math.min(STEP, items.length - shown))}</Button>
        </div>
      )}
    </Stack>
  );
};
