// Текст публикации как он есть в источнике — первое, что видно на странице.
//
// Раньше сюда приходили из карточки компании и видели только разбор: «что портал взял
// из текста». Самого текста на экране не было — он лежал внизу, под таблицей редакций
// и сравнением версий. Человек, который пришёл прочитать новость, её не находил.
//
// Показывается сохранённая редакция, к которой привязаны цитаты, а не живая страница
// источника: правки после сбора видны в «Редакциях». Текст выводится как текст —
// React экранирует всё, разметка источника не исполняется.

import { FC } from 'react';
import { useQuery } from '@tanstack/react-query';

import { api } from '../api/client';
import type { IRevision } from '../api/types';
import { COMPLETENESS_HINTS, COMPLETENESS_LABELS, formatDateTime } from '../lib/labels';
import { describeLoadError } from '../lib/loadError';
import { Badge } from './ui/Badge';
import { EmptyState, Section } from './ui/Section';
import styles from './PublicationText.module.css';

interface IPublicationTextProps {
  revisionId: number | null;
  /** Ссылка на пост в источнике: рядом с текстом, а не только в шапке. */
  originalUrl: string | null;
}

export const PublicationText: FC<IPublicationTextProps> = ({ revisionId, originalUrl }) => {
  const query = useQuery({
    queryKey: ['revision', revisionId],
    queryFn: () => api.get<{ revision: IRevision }>(`/api/revisions/${revisionId}`),
    enabled: revisionId !== null,
  });

  if (revisionId === null) {
    return (
      <Section title="Текст публикации">
        <EmptyState>
          Сохранённого текста нет: публикация собрана до учёта редакций. Открыть можно только оригинал
          в источнике.
        </EmptyState>
      </Section>
    );
  }

  if (query.isError) {
    return (
      <Section title="Текст публикации">
        <p role="alert">{describeLoadError(query.error)}</p>
      </Section>
    );
  }

  const revision = query.data?.revision;

  return (
    <Section
      title="Текст публикации"
      note={
        originalUrl ? (
          <a href={originalUrl} target="_blank" rel="noreferrer noopener">
            открыть в источнике
          </a>
        ) : undefined
      }
    >
      {query.isLoading && <p className={styles.muted}>Загрузка…</p>}

      {revision && (
        <>
          <div className={styles.meta}>
            <Badge hint={COMPLETENESS_HINTS[revision.completeness]}>
              {COMPLETENESS_LABELS[revision.completeness] ?? revision.completeness}
            </Badge>
            <span className={styles.mutedInline}>
              редакция №{revision.revisionNo}
              {revision.publishedAt !== null
                ? ` · опубликовано ${formatDateTime(revision.publishedAt)}`
                : ` · впервые увидели ${formatDateTime(revision.firstObservedAt)}`}
            </span>
          </div>

          {revision.completenessReason && <p className={styles.muted}>{revision.completenessReason}</p>}

          {/* Telegram-пост часто состоит из фото и подписи: молчать о непрочитанном нельзя. */}
          {revision.attachments.length > 0 && (
            <p className={styles.muted}>
              Вложения портал не читает: {revision.attachments.map(a => a.kind).join(', ')}. Их содержимое
              в разбор не попало.
            </p>
          )}

          {revision.body.trim() === '' ? (
            <EmptyState>Текста в этой редакции нет — источник отдал пустое тело.</EmptyState>
          ) : (
            <pre className={styles.text}>{revision.body}</pre>
          )}
        </>
      )}
    </Section>
  );
};
