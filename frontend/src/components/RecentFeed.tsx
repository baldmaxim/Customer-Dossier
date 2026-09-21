// Лента «Последнее»: что вообще пришло в портал.
//
// Порядок — по дате публикации, а если её нет, по моменту наблюдения. Момент,
// когда портал увидел текст, датой публикации не притворяется: об этом сказано
// в самой строке.

import { FC } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { api } from '../api/client';
import { COMPLETENESS_LABELS, SOURCE_KIND_LABELS, formatDateTime } from '../lib/labels';
import { describeLoadError } from '../lib/loadError';
import { EmptyState, Section } from './ui/Section';
import { TableScroll } from './ui/TableScroll';
import { Badge } from './ui/Badge';

interface IFeedItem {
  id: number;
  sourceTitle: string;
  sourceKind: string;
  sourceKey: string;
  publishedAt: string | null;
  firstObservedAt: string;
  canonicalUrl: string | null;
  state: string;
  title: string | null;
  completeness: string | null;
  revisionNo: number | null;
  documentId: number | null;
  bodyChars: number | null;
  revisionCount: number;
}

export const RecentFeed: FC = () => {
  const feed = useQuery({
    queryKey: ['feed'],
    queryFn: () => api.get<{ items: IFeedItem[] }>('/api/feed?limit=50'),
  });

  const items = feed.data?.items ?? [];

  return (
    <Section title="Последнее" note="50 самых свежих публикаций из всех источников">
      {feed.isError && <p role="alert">{describeLoadError(feed.error)}</p>}
      {feed.isSuccess && items.length === 0 && (
        <EmptyState>
          Публикаций пока нет. Сбор идёт только по источникам с подтверждённым допуском; текст можно
          вставить вручную в админке.
        </EmptyState>
      )}
      {items.length > 0 && (
        <TableScroll minWidth={820}>
          <thead>
            <tr>
              <th>Публикация</th>
              <th>Источник</th>
              <th>Когда</th>
              <th>Текст</th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => (
              // Строка ведёт к публикации целиком; без документа вести некуда (index.css).
              <tr key={item.id} className={item.documentId !== null ? 'row-link' : undefined}>
                <td>
                  {item.documentId !== null ? (
                    <Link className="row-link-target" to={`/documents/${item.documentId}`}>
                      {item.title ?? 'без заголовка'}
                    </Link>
                  ) : (
                    (item.title ?? 'без заголовка')
                  )}
                  {item.revisionCount > 1 && (
                    <Badge
                      className="row-link-above"
                      hint="публикацию правили: у неё несколько редакций, цитаты привязаны к конкретной"
                    >
                      редакций {item.revisionCount}
                    </Badge>
                  )}
                </td>
                <td>
                  {item.sourceTitle}
                  <br />
                  {SOURCE_KIND_LABELS[item.sourceKind] ?? item.sourceKind}
                </td>
                <td>
                  {item.publishedAt !== null
                    ? formatDateTime(item.publishedAt)
                    : `${formatDateTime(item.firstObservedAt)} — момент наблюдения, дата публикации неизвестна`}
                </td>
                <td>
                  {item.completeness !== null && (
                    <Badge
                      className="row-link-above"
                      tone={item.completeness === 'full' ? 'positive' : 'warn'}
                      hint="полнота определяется происхождением текста, а не его длиной"
                    >
                      {COMPLETENESS_LABELS[item.completeness as keyof typeof COMPLETENESS_LABELS] ?? item.completeness}
                    </Badge>
                  )}
                  {item.bodyChars !== null && ` · ${item.bodyChars} симв.`}
                </td>
              </tr>
            ))}
          </tbody>
        </TableScroll>
      )}
    </Section>
  );
};
