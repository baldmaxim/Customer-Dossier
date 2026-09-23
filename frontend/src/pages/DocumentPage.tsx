// Публикация отдельной страницей — только сам пост, в том же виде, что и в списках.
//
// Раньше здесь был служебный разбор («что портал взял из текста»: упоминания объектов,
// модальность, номера символов цитат) и таблица редакций. Решение владельца 23.09.2026:
// оператору это не нужно — он приходит прочитать новость. Разбор и редакции остались
// в API (`/api/items/:id/extraction`, `/api/items/:id/revisions`) и в CLI, данные целы.

import { FC, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';

import { api } from '../api/client';
import type { ISourceItem } from '../api/types';
import { TelegramPost } from '../components/TelegramPost';
import { Segmented } from '../components/ui/Segmented';
import { sourceLabel } from '../lib/labels';
import { describeLoadError } from '../lib/loadError';
import styles from './DocumentPage.module.css';

export const DocumentPage: FC = () => {
  const { id } = useParams<{ id: string }>();
  const documentId = Number(id);
  const [selected, setSelected] = useState<string | null>(null);

  const itemsQuery = useQuery({
    queryKey: ['document', documentId, 'items'],
    queryFn: () => api.get<{ items: ISourceItem[] }>(`/api/documents/${documentId}/items`),
    enabled: Number.isFinite(documentId),
  });

  if (!Number.isFinite(documentId)) return <p className={styles.empty}>Некорректный адрес.</p>;
  if (itemsQuery.isLoading) return <p className={styles.empty}>Загрузка…</p>;
  if (itemsQuery.isError) {
    return (
      <p className={styles.empty} role="alert">
        {describeLoadError(itemsQuery.error)}
      </p>
    );
  }

  const items = itemsQuery.data?.items ?? [];
  const current = items.find(i => String(i.id) === selected) ?? items[0] ?? null;
  if (!current) {
    return <p className={styles.empty}>Публикация собрана до учёта версий, её текста в портале нет.</p>;
  }

  return (
    <div className={styles.page}>
      <h1 className="visually-hidden">{current.title ?? current.topic ?? 'Публикация'}</h1>

      {/* Один текст в нескольких каналах — несколько публикаций, а не несколько подтверждений. */}
      {items.length > 1 && (
        <div className={styles.sources}>
          <span className={styles.sourcesLabel}>Эта же новость в:</span>
          <Segmented
            label="Источник"
            items={items.map(i => ({ value: String(i.id), label: sourceLabel(i) }))}
            value={String(current.id)}
            onChange={setSelected}
            size="md"
          />
        </div>
      )}

      <TelegramPost
        key={current.id}
        revisionId={current.latestRevisionId}
        sourceTitle={current.sourceTitle}
        sourceKey={current.sourceKey}
        sourceKind={current.sourceKind}
        publishedAt={current.publishedAt}
        observedAt={current.firstObservedAt}
        url={current.originalUrl ?? current.canonicalUrl}
        title={current.title}
      />
    </div>
  );
};
