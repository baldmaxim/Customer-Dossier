import { FC, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';

import { api } from '../api/client';
import type { ISourceItem } from '../api/types';
import { ItemExtraction } from '../components/ItemExtraction';
import { PublicationText } from '../components/PublicationText';
import { RevisionHistory } from '../components/RevisionHistory';
import { Badge } from '../components/ui/Badge';
import { COMPLETENESS_LABELS, SOURCE_KIND_LABELS, formatDateTime } from '../lib/labels';
import styles from './DocumentPage.module.css';

/**
 * Публикация целиком: сам текст, что портал из него взял и какие были редакции.
 *
 * Порядок — от новости к служебному: сначала текст источника (за этим сюда и приходят
 * из карточки компании), потом разбор, и только потом история редакций. Раньше текст
 * лежал последним, под таблицей версий, и страница выглядела как отчёт о разборе
 * вместо самой публикации. Действий здесь нет — обработка идёт сама.
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
  // Заголовок источника важнее машинной темы: у telegram-постов его просто нет.
  const title = current?.title ?? current?.topic ?? `Документ #${documentId}`;
  const fromModel = current !== null && current.title === null && current.topic !== null;

  return (
    <>
      <header className={styles.head}>
        <h1 className={styles.title}>{title}</h1>
        {fromModel && (
          <Badge hint="тему составила локальная модель по началу текста; это подпись для списка, а не заголовок источника и не доказательство">
            тема составлена моделью
          </Badge>
        )}
        {current && (
          <p className={styles.meta}>
            {current.sourceTitle} · {SOURCE_KIND_LABELS[current.sourceKind] ?? current.sourceKind}
            {current.publishedAt !== null
              ? ` · опубликовано ${formatDateTime(current.publishedAt)}`
              : ` · дата публикации неизвестна, впервые увидели ${formatDateTime(current.firstObservedAt)}`}
            {current.latestCompleteness && ` · ${COMPLETENESS_LABELS[current.latestCompleteness]}`}
            {current.originalUrl && (
              <>
                {' · '}
                <a href={current.originalUrl} target="_blank" rel="noreferrer noopener">
                  оригинал
                </a>
              </>
            )}
          </p>
        )}
      </header>

      {items.length === 0 ? (
        <p className={styles.empty}>
          Истории публикаций для этого документа нет: он собран до учёта версий, а перенос старых данных
          (backfill) не выполнялся.
        </p>
      ) : (
        <>
          {current && <PublicationText revisionId={current.latestRevisionId} originalUrl={current.originalUrl} />}

          {current && <ItemExtraction itemId={current.id} />}

          {items.length > 1 && (
            <section className={styles.section}>
              <h2>Один текст в нескольких источниках</h2>
              <p className={styles.hint}>
                Одна и та же новость в трёх каналах — три публикации со своей историей, а не три подтверждения.
              </p>
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
            </section>
          )}

          {current && (
            <section className={styles.section}>
              <div className={styles.sectionHead}>
                <h2>Редакции публикации</h2>
                {current.state === 'deleted_observed' && (
                  <span className={styles.warn}>удаление наблюдалось {formatDateTime(current.deletedObservedAt)}</span>
                )}
              </div>
              <p className={styles.hint}>
                Выше показана редакция, к которой привязаны цитаты. Здесь — все сохранённые версии: правку
                поста можно открыть и сравнить. В карточки правки автоматически не попадают — портал
                разберёт их отдельно.
              </p>
              <RevisionHistory itemId={current.id} latestRevisionId={current.latestRevisionId} />
            </section>
          )}
        </>
      )}

    </>
  );
};
