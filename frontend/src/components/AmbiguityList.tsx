// Вкладка «Неясные упоминания»: текст называет компанию или объект так, что подходит несколько
// карточек. Состояние, вид, страница и раскрытая строка — в адресе; «всего» — по фильтру, а не
// длина страницы.

import { FC, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';

import { LoadingSkeleton } from './LoadingSkeleton';
import type { AmbiguityStatus } from '../api/types';
import { enumParam, stringParam, useUrlPatch, useUrlState } from '../hooks/useUrlState';
import { formatCount, formatCountWord } from '../lib/format';
import { AMBIGUITY_STATUS_LABELS, formatDate } from '../lib/labels';
import { describeLoadError } from '../lib/loadError';
import { Pager } from './admin/Pager';
import { ambiguityPageQuery } from './admin/reviewQueries';
import { useCursorPaging } from './admin/useCursorPaging';
import { AmbiguityDetail } from './AmbiguityDetail';
import { Button } from './ui/Button';
import { Callout } from './ui/Callout';
import { Disclosure } from './ui/Disclosure';
import { EmptyState } from './ui/EmptyState';
import { Field } from './ui/Field';
import { Segmented } from './ui/Segmented';
import { Select } from './ui/Select';
import { Stack } from './ui/Stack';
import styles from './admin/Review.module.css';

const STATUSES: readonly AmbiguityStatus[] = ['open', 'resolved', 'dismissed'];
const WHAT: readonly ('' | 'company' | 'project')[] = ['', 'company', 'project'];

export const AmbiguityList: FC = () => {
  const [status] = useUrlState('status', enumParam(STATUSES, 'open'));
  const [what] = useUrlState('what', enumParam(WHAT, ''));
  const [open, setOpen] = useUrlState('open', stringParam());
  const patch = useUrlPatch();
  const listRef = useRef<HTMLDivElement>(null);
  const paging = useCursorPaging('cursor', listRef);
  const page = useQuery(ambiguityPageQuery(status, what, paging.cursor));
  const data = page.data;

  // Новый фильтр — список с начала: курсор прежней выборки к новой не относится.
  const filter = (next: { status?: AmbiguityStatus; what?: '' | 'company' | 'project' }): void =>
    patch({ ...next, cursor: null, open: null });

  return (
    <div ref={listRef}>
      <Stack gap={4}>
        <div className={styles.filters}>
          <Field label="Состояние">
            {control => (
              <Select {...control} block={false} value={status} onChange={e => filter({ status: e.target.value as AmbiguityStatus })}>
                {STATUSES.map(s => (
                  <option key={s} value={s}>
                    {AMBIGUITY_STATUS_LABELS[s] ?? s}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Segmented
            label="Что"
            items={[
              { value: '', label: 'всё' },
              { value: 'company', label: 'компании' },
              { value: 'project', label: 'объекты' },
            ]}
            value={what}
            onChange={value => filter({ what: value })}
          />
          {data && <span className={styles.count}>всего {formatCount(data.total)}</span>}
        </div>

        {page.isLoading && (
          <LoadingSkeleton label="Загружаю упоминания…" lines={4} height="56px" />
        )}
        {page.isError && (
          <Callout tone="danger" title="Упоминания не загрузились" action={<Button onClick={() => void page.refetch()}>Повторить</Button>}>
            {describeLoadError(page.error)}
          </Callout>
        )}
        {data && data.items.length === 0 && (
          <EmptyState size="sm">
            {status === 'open' ? 'Неясных упоминаний нет — решать нечего.' : 'По этому фильтру ничего нет.'}
          </EmptyState>
        )}
        {data && data.items.length > 0 && (
          <ul className={styles.list}>
            {data.items.map(item => {
              const key = String(item.id);
              const isOpen = open === key;
              return (
                <li key={item.id}>
                  <Disclosure
                    variant="card"
                    level={2}
                    open={isOpen}
                    onToggle={next => {
                      if (next) setOpen(key);
                      else if (isOpen) setOpen('');
                    }}
                    summary={
                      <span className={styles.summary}>
                        <span className={styles.summaryTitle}>«{item.surface}»</span>
                        <span className={styles.summaryMeta}>
                          {item.entityKind === 'company' ? 'компания' : 'объект'} ·{' '}
                          {formatCountWord(item.candidateIds.length, ['вариант', 'варианта', 'вариантов'])} · {formatDate(item.updatedAt)}
                        </span>
                      </span>
                    }
                  >
                    {isOpen && <AmbiguityDetail ambiguityId={item.id} />}
                  </Disclosure>
                </li>
              );
            })}
          </ul>
        )}
        <Pager
          label="Страницы упоминаний"
          hasNewer={paging.hasNewer}
          hasOlder={Boolean(data?.nextCursor)}
          onNewer={paging.newer}
          onOlder={() => data?.nextCursor && paging.older(data.nextCursor)}
        />
      </Stack>
    </div>
  );
};
