// Журнал: что ушло в карточки, что не ушло и почему.
//
// Перенос разобранного в карточки автоматический, поэтому единственное место, где
// видно его работу, — этот журнал. Отказ здесь не ошибка портала: «допуск отозван»
// и «разбор устарел» — законные исходы, и они названы словами.

import { FC } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { api } from '../../api/client';
import { formatDateTime } from '../../lib/labels';
import { describeLoadError } from '../../lib/loadError';
import { Badge } from '../ui/Badge';
import { EmptyState } from '../ui/Section';
import { TableScroll } from '../ui/TableScroll';

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
  runId: number | null;
}

const ACTION_LABELS: Record<string, string> = {
  publish: 'попало в карточки',
  rejected_policy: 'отказ: нет допуска',
  rejected_stale: 'отказ: разбор устарел',
};

const ACTION_HINTS: Record<string, string> = {
  publish: 'набор кандидатов перенесён в утверждения и доказательства карточек',
  rejected_policy:
    'ИИ-допуск источника отозван или истёк на момент переноса — набор сохранён и уйдёт в карточки после решения оператора по допуску',
  rejected_stale:
    'публикация успела измениться после разбора: набор остаётся кандидатом, нужен новый запуск по последней редакции',
};

const ACTOR_LABELS: Record<string, string> = {
  auto: 'автоматически',
  operator: 'оператор',
};

export const PublicationLog: FC = () => {
  const log = useQuery({
    queryKey: ['publications'],
    queryFn: () => api.get<{ items: IPublicationRow[] }>('/api/reprocess/publications?limit=50'),
  });

  const items = log.data?.items ?? [];

  if (log.isError) return <p role="alert">{describeLoadError(log.error)}</p>;
  if (log.isSuccess && items.length === 0) {
    return (
      <EmptyState>
        В карточки пока ничего не переносилось. Набор кандидатов появляется после полного разбора
        редакции — неполный и упавший запуск в карточки не идут ни при каком флаге.
      </EmptyState>
    );
  }

  return (
    <TableScroll minWidth={760}>
      <thead>
        <tr>
          <th>Когда</th>
          <th>Исход</th>
          <th>Кто</th>
          <th>Источник</th>
          <th>Запуск</th>
          <th>Причина</th>
        </tr>
      </thead>
      <tbody>
        {items.map(row => (
          <tr key={row.id}>
            <td>{formatDateTime(row.createdAt)}</td>
            <td>
              <Badge
                tone={row.action === 'publish' ? 'positive' : 'warn'}
                hint={ACTION_HINTS[row.action] ?? row.action}
              >
                {ACTION_LABELS[row.action] ?? row.action}
              </Badge>
            </td>
            <td>{ACTOR_LABELS[row.actor] ?? row.actor}</td>
            <td>{row.sourceTitle}</td>
            <td>
              {row.runId !== null ? <Link to={`/admin/process/${row.runId}`}>запуск #{row.runId}</Link> : 'не указан'}
            </td>
            <td>{row.note ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </TableScroll>
  );
};
