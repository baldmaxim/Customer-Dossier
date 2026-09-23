// Публикация так, как её видят в Telegram: канал с аватаркой, пузырь с текстом, время.
//
// Показывается сохранённая редакция, к которой привязаны цитаты, а не живая страница
// канала: правки после сбора сюда не попадают. Текст выводится как текст — React
// экранирует всё, разметка источника не исполняется.

import { FC } from 'react';
import { useQuery } from '@tanstack/react-query';

import { api } from '../api/client';
import type { IRevision } from '../api/types';
import { formatPostDate, formatTime, sourceLabel } from '../lib/labels';
import { describeLoadError } from '../lib/loadError';
import styles from './TelegramPost.module.css';

export interface ITelegramPostProps {
  revisionId: number | null;
  sourceTitle: string;
  sourceKey: string | null;
  sourceKind: string;
  publishedAt: string | null;
  observedAt: string;
  url: string | null;
  /** Заголовок источника. У Telegram-постов его нет; тему от модели сюда не подставляем. */
  title: string | null;
  /** На телефоне панель открыта вместо списка: вернуться к нему. */
  onClose?: () => void;
}

/** Вложения портал не читает: вид вложения — словами. */
const ATTACHMENT_LABELS: Record<string, string> = {
  photo: 'фото',
  video: 'видео',
  document: 'файл',
  voice: 'голосовое',
  poll: 'опрос',
};

export const TelegramPost: FC<ITelegramPostProps> = ({
  revisionId,
  sourceTitle,
  sourceKey,
  sourceKind,
  publishedAt,
  observedAt,
  url,
  title,
  onClose,
}) => {
  const query = useQuery({
    queryKey: ['revision', revisionId],
    queryFn: () => api.get<{ revision: IRevision }>(`/api/revisions/${revisionId}`),
    enabled: revisionId !== null,
  });

  const channel = sourceLabel({ sourceTitle, sourceKey, sourceKind });
  const initial = channel.replace(/^@/, '').trim().charAt(0).toUpperCase() || '?';
  const when = publishedAt ?? observedAt;
  const revision = query.data?.revision;
  const attachments = revision?.attachments ?? [];

  return (
    <article className={styles.post} aria-label={`Публикация: ${channel}`}>
      <header className={styles.head}>
        {onClose && (
          <button type="button" className={styles.close} onClick={onClose}>
            ← К списку
          </button>
        )}
        {/* Шапка канала — и есть ссылка на оригинал: отдельная кнопка внизу поста терялась под текстом. */}
        {url ? (
          <a
            className={`${styles.channel} ${styles.channelLink}`}
            href={url}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={`${channel} — открыть оригинал ${sourceKind === 'telegram' ? 'в Telegram' : 'в источнике'}`}
          >
            <span className={styles.avatar} aria-hidden="true">
              {initial}
            </span>
            <span className={styles.channelText}>
              <span className={styles.channelName}>
                {channel} <span aria-hidden="true">↗</span>
              </span>
              <span className={styles.channelMeta}>
                {sourceKind === 'telegram' ? 'Telegram-канал · открыть оригинал' : 'открыть оригинал'}
              </span>
            </span>
          </a>
        ) : (
          <div className={styles.channel}>
            <span className={styles.avatar} aria-hidden="true">
              {initial}
            </span>
            <span className={styles.channelText}>
              <span className={styles.channelName}>{channel}</span>
              <span className={styles.channelMeta}>{sourceKind === 'telegram' ? 'Telegram-канал' : 'вставлено вручную'}</span>
            </span>
          </div>
        )}
        <time className={styles.date} dateTime={when}>
          {formatPostDate(when)}
          <span className={styles.time}>{formatTime(when)}</span>
        </time>
        {publishedAt === null && (
          <p className={styles.note}>Дата публикации неизвестна — показан момент, когда портал увидел текст.</p>
        )}
      </header>

      <div className={styles.chat}>
        {revisionId === null && (
          <p className={styles.note}>Сохранённого текста нет — открыть можно только оригинал.</p>
        )}
        {query.isLoading && <p className={styles.note}>Загрузка…</p>}
        {query.isError && (
          <p className={styles.note} role="alert">
            {describeLoadError(query.error)}
          </p>
        )}

        {revision && (
          <div className={styles.bubble}>
            {attachments.length > 0 && (
              <div className={styles.media}>
                {attachments.map(a => ATTACHMENT_LABELS[a.kind] ?? 'вложение').join(', ')} — не сохраняется,
                открыть можно в оригинале
              </div>
            )}
            {title && <p className={styles.title}>{title}</p>}
            {revision.body.trim() === '' ? (
              <p className={styles.note}>Текста в публикации нет.</p>
            ) : (
              <p className={styles.text}>{revision.body}</p>
            )}
            <span className={styles.stamp}>{formatTime(when)}</span>
          </div>
        )}
      </div>
    </article>
  );
};
