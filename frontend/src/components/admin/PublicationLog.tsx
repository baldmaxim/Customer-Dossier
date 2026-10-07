// Журнал переноса в карточки: что ушло, что не ушло и почему.
//
// Перенос разобранного в карточки автоматический, поэтому единственное место, где видно
// его работу, — этот журнал. Отказ здесь не ошибка портала: «источник выключен» и «текст
// изменился» — законные исходы, и они названы словами. Строка — ссылка на разбор.

import { FC, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { api } from '../../api/client';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { PUBLICATION_ACTION_HINTS, PUBLICATION_ACTION_LABELS, formatDateTime, sourceLabel } from '../../lib/labels';
import { describeLoadError } from '../../lib/loadError';
import { MQ } from '../../lib/media';
import { PUBLICATION_ACTION_TONE, toneOf } from '../../lib/statusTone';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { CardList } from '../ui/CardList';
import { CardListItem } from '../ui/CardListItem';
import { EmptyState } from '../ui/EmptyState';
import { Loading } from '../ui/Loading';
import { TableScroll } from '../ui/TableScroll';
import { VisuallyHidden } from '../ui/VisuallyHidden';
import styles from './Runs.module.css';

interface IPublicationRow {
  id: number;
  action: 'publish' | 'rejected_policy' | 'rejected_stale';
  actor: string;
  note: string | null;
  createdAt: string;
  fromSetId: number | null;
  toSetId: number | null;
  sourceItemId: number;
  sourceTitle: string;
  sourceKey: string;
  sourceKind?: string;
  runId: number | null;
}

const ACTOR_LABELS: Record<string, string> = {
  auto: 'автоматически',
  operator: 'оператор',
};

/**
 * Исход переноса ярлыком. Пояснение — подсказкой только в таблице: на телефоне ярлык с подсказкой
 * становится кнопкой в 24px, а смысл и так сказан подписью.
 */
const actionBadge = (action: string, withHint: boolean): ReactNode => (
  <Badge tone={toneOf(PUBLICATION_ACTION_TONE, action)} hint={withHint ? PUBLICATION_ACTION_HINTS[action] : undefined}>
    {PUBLICATION_ACTION_LABELS[action] ?? action}
  </Badge>
);

export const PublicationLog: FC = () => {
  // Таблица из пяти колонок — от 900px: на планшете она уезжала вбок, там — карточки.
  const wide = useMediaQuery(MQ.md);
  const log = useQuery({
    queryKey: ['publications'],
    queryFn: () => api.get<{ items: IPublicationRow[] }>('/api/reprocess/publications?limit=50'),
  });

  if (log.isLoading) return <Loading label="Загружаю журнал…" />;
  if (log.isError) {
    return (
      <Callout tone="danger" title="Журнал не загрузился" action={<Button onClick={() => void log.refetch()}>Повторить</Button>}>
        {describeLoadError(log.error)}
      </Callout>
    );
  }
  const items = log.data?.items ?? [];
  if (items.length === 0) {
    return <EmptyState size="sm">В карточки пока ничего не переносилось. Туда попадает только полностью разобранный текст.</EmptyState>;
  }

  const actor = (row: IPublicationRow): string => ACTOR_LABELS[row.actor] ?? row.actor;

  if (!wide) {
    return (
      <CardList label="Журнал переноса в карточки">
        {items.map(row => (
          <CardListItem
            key={row.id}
            to={row.runId !== null ? `/admin/process/${row.runId}` : undefined}
            title={row.sourceTitle}
            meta={`${formatDateTime(row.createdAt)} · ${actor(row)}`}
            aside={actionBadge(row.action, false)}
          >
            {row.note && <span className={styles.note}>{row.note}</span>}
          </CardListItem>
        ))}
      </CardList>
    );
  }

  return (
    <TableScroll label="Журнал переноса в карточки" minWidth={720}>
      <thead>
        <tr>
          <th>Когда</th>
          <th>Итог</th>
          <th>Источник</th>
          <th>Кто</th>
          <th>Причина</th>
        </tr>
      </thead>
      <tbody>
        {items.map(row => (
          <tr key={row.id} className={row.runId !== null ? 'row-link' : undefined}>
            <td className={`nowrap ${styles.whenCell}`}>
              {row.runId !== null ? (
                <Link to={`/admin/process/${row.runId}`} viewTransition className={`row-link-target ${styles.rowLink}`}>
                  <VisuallyHidden>Разбор от </VisuallyHidden>
                  {formatDateTime(row.createdAt)}
                </Link>
              ) : (
                formatDateTime(row.createdAt)
              )}
            </td>
            <td>
              <span className="row-link-above">{actionBadge(row.action, true)}</span>
            </td>
            <td className={styles.sourceCell}>{sourceLabel({ sourceTitle: row.sourceTitle, sourceKey: row.sourceKey, sourceKind: row.sourceKind ?? '' })}</td>
            <td>{actor(row)}</td>
            <td>{row.note ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </TableScroll>
  );
};
