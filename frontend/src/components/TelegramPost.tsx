// Публикация так, как её видят в Telegram: канал с аватаркой, пузырь с текстом, время.
//
// Показывается сохранённая версия текста, к которой привязаны цитаты, а не живая страница
// канала: правки после сбора сюда не попадают. Текст выводится как текст — React экранирует
// всё, разметка источника не исполняется; http(s)-адреса становятся ссылками (PostText).
//
// У поста есть заголовок (для глаз скрыт, для диктора — первая строка): на телефоне пост
// открывается вместо списка, и фокус переводится на него (PublicationBrowser).

import { FC, ReactNode, useId, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';

import { api } from '../api/client';
import type { IRevision } from '../api/types';
import { SOURCE_KIND_LABELS, formatPostDate, formatTime, sourceLabel } from '../lib/labels';
import { describeLoadError } from '../lib/loadError';
import { PostText } from './publication/PostText';
import { useScrollable } from './publication/useScrollable';
import { RegistryPublicationBody } from './RegistryPublicationBody';
import { Button } from './ui/Button';
import { Callout } from './ui/Callout';
import { Heading } from './ui/Heading';
import { Icon } from './ui/Icon';
import { Loading } from './ui/Loading';
import { Skeleton } from './ui/Skeleton';
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
  /** Под текстом, в той же прокрутке: что портал нашёл в публикации (карточка компании). */
  footer?: ReactNode;
  /** card — отдельной карточкой (по умолчанию); plain — без рамки и своей высоты, внутри диалога. */
  variant?: 'card' | 'plain';
}

/** Вложения портал не читает: вид вложения — словами. */
const ATTACHMENT_LABELS: Record<string, string> = {
  photo: 'фото',
  video: 'видео',
  document: 'файл',
  voice: 'голосовое',
  poll: 'опрос',
};

/** Снимки реестра раскладываются на поля (RegistryPublicationBody), остальное — текст поста. */
const REGISTRY_REPRESENTATIONS = new Set(['registry_object_browser@1', 'registry_object@1']);

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
  footer,
  variant = 'card',
}) => {
  const query = useQuery({
    queryKey: ['revision', revisionId],
    queryFn: () => api.get<{ revision: IRevision }>(`/api/revisions/${revisionId}`),
    enabled: revisionId !== null,
  });
  const headingId = useId();
  const chatRef = useRef<HTMLDivElement>(null);
  const scrollable = useScrollable(chatRef);

  const channel = sourceLabel({ sourceTitle, sourceKey, sourceKind });
  const initial = channel.replace(/^@/, '').trim().charAt(0).toUpperCase() || '?';
  const when = publishedAt ?? observedAt;
  const kind = SOURCE_KIND_LABELS[sourceKind] ?? 'источник';
  const revision = query.data?.revision;
  const attachments = revision?.attachments ?? [];
  const whenText = [formatPostDate(when), formatTime(when)].filter(Boolean).join(', ');

  return (
    <article className={`${styles.post} ${styles[variant]}`} aria-labelledby={headingId}>
      <Heading id={headingId} tabIndex={-1} data-post-heading className="visually-hidden">
        {`Публикация: ${channel}${whenText ? `, ${whenText}` : ''}`}
      </Heading>
      <header className={styles.head}>
        {onClose && (
          <Button variant="ghost" size="sm" icon="back" className={styles.close} onClick={onClose}>
            К списку
          </Button>
        )}
        {/* Шапка канала — и есть ссылка на оригинал: отдельная кнопка внизу поста терялась под текстом. */}
        {url ? (
          <a
            className={`${styles.channel} ${styles.channelLink}`}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${channel} — открыть оригинал ${sourceKind === 'telegram' ? 'в Telegram' : 'в источнике'}`}
          >
            <span className={styles.avatar} aria-hidden="true">
              {initial}
            </span>
            <span className={styles.channelText}>
              <span className={styles.channelName}>
                {channel} <Icon name="external" size="sm" className={styles.external} />
              </span>
              <span className={styles.channelMeta}>{kind} · открыть оригинал</span>
            </span>
          </a>
        ) : (
          <div className={styles.channel}>
            <span className={styles.avatar} aria-hidden="true">
              {initial}
            </span>
            <span className={styles.channelText}>
              <span className={styles.channelName}>{channel}</span>
              <span className={styles.channelMeta}>{kind}</span>
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

      <div
        ref={chatRef}
        className={styles.chat}
        {...(scrollable ? { tabIndex: 0, role: 'region', 'aria-label': 'Текст публикации' } : {})}
      >
        {revisionId === null && <p className={styles.note}>Сохранённого текста нет — открыть можно только оригинал.</p>}
        {query.isLoading && (
          <Loading label="Загружаю текст публикации…" className={styles.bubble}>
            <Skeleton lines={4} />
          </Loading>
        )}
        {query.isError && (
          <Callout
            tone="danger"
            title="Текст не загрузился"
            action={
              <Button size="sm" onClick={() => void query.refetch()}>
                Повторить
              </Button>
            }
          >
            {describeLoadError(query.error)}
          </Callout>
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
              <div className={styles.text}>
                {REGISTRY_REPRESENTATIONS.has(revision.representation) ? (
                  <RegistryPublicationBody body={revision.body} representation={revision.representation} />
                ) : (
                  <PostText text={revision.body} />
                )}
              </div>
            )}
            <span className={styles.stamp}>{formatTime(when)}</span>
          </div>
        )}
        {footer}
      </div>
    </article>
  );
};
