import { FC, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';

import { api } from '../api/client';
import type { ISourceItem } from '../api/types';
import { RevisionHistory } from '../components/RevisionHistory';
import { COMPLETENESS_LABELS, SOURCE_KIND_LABELS, formatDateTime } from '../lib/labels';
import styles from './DocumentPage.module.css';

/**
 * Публикации, связанные с документом из карточки: где текст появлялся, какие
 * редакции видели, насколько он полный. Один текст в разных каналах — разные
 * публикации со своей историей.
 */
export const DocumentPage: FC = () => {
  const { id } = useParams<{ id: string }>();
  const documentId = Number(id);
  const [selected, setSelected] = useState<number | null>(null);

  const itemsQuery = useQuery({
    queryKey: ['document', documentId, 'items'],
    queryFn: () => api.get<{ items: ISourceItem[] }>(`/api/documents/${documentId}/items`),
    enabled: Number.isFinite(documentId),
  });

  if (!Number.isFinite(documentId)) return <p className={styles.empty}>Некорректный адрес.</p>;
  if (itemsQuery.isLoading) return <p className={styles.empty}>Загрузка…</p>;
  if (itemsQuery.isError) return <p className={styles.empty}>Не удалось загрузить публикации.</p>;

  const items = itemsQuery.data?.items ?? [];
  const current = items.find(i => i.id === selected) ?? items[0] ?? null;

  return (
    <>
      <h1 className={styles.title}>Документ #{documentId}: публикации и версии</h1>
      <p className={styles.hint}>
        Цитаты в карточках привязаны к первой сохранённой редакции. Более поздние правки публикации
        видны здесь и в карточки автоматически не попадают.
      </p>

      {items.length === 0 ? (
        <p className={styles.empty}>
          Истории публикаций для этого документа нет: он собран до учёта версий, а перенос старых данных
          (backfill) не выполнялся.
        </p>
      ) : (
        <div className={styles.items} role="list">
          {items.map(item => (
            <button
              key={item.id}
              type="button"
              role="listitem"
              aria-pressed={current?.id === item.id}
              className={`${styles.item} ${current?.id === item.id ? styles.itemActive : ''}`}
              onClick={() => setSelected(item.id)}
            >
              <span className={styles.itemSource}>
                {item.sourceTitle} · {SOURCE_KIND_LABELS[item.sourceKind] ?? item.sourceKind}
              </span>
              <span className={styles.itemKey}>{item.externalId ?? item.canonicalUrl ?? item.itemKey}</span>
              <span className={styles.itemMeta}>
                редакций: {item.revisionCount} ·{' '}
                {item.latestCompleteness ? COMPLETENESS_LABELS[item.latestCompleteness] : 'полнота неизвестна'} ·
                последнее наблюдение {formatDateTime(item.lastObservedAt)}
              </span>
              {item.state === 'deleted_observed' && (
                <span className={styles.warn}>удаление наблюдалось {formatDateTime(item.deletedObservedAt)}</span>
              )}
              {item.historyBeforeImport === 'unknown' && (
                <span className={styles.warn}>история до начала учёта версий неизвестна</span>
              )}
            </button>
          ))}
        </div>
      )}

      {current && (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2>Редакции</h2>
            {current.originalUrl && (
              <a href={current.originalUrl} target="_blank" rel="noreferrer noopener">
                оригинал
              </a>
            )}
          </div>
          <RevisionHistory itemId={current.id} latestRevisionId={current.latestRevisionId} />
        </section>
      )}

      <p className={styles.back}>
        <Link to="/">← к поиску</Link>
      </p>
    </>
  );
};
