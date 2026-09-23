// Публикации: список слева, выбранная — справа, как в мессенджере.
//
// Раньше публикация открывалась отдельной страницей со служебным разбором, и чтобы
// прочитать пять новостей, приходилось пять раз уходить и возвращаться. Здесь список
// остаётся на месте. Карточка в списке — одна кнопка целиком: нажимать можно в любое
// место, а не только в заголовок.
//
// На телефоне двух колонок нет: выбранная публикация открывается вместо списка, и
// «← К списку» возвращает к тому же месту.

import { FC, ReactNode, useEffect, useRef, useState } from 'react';

import { useMediaQuery } from '../hooks/useMediaQuery';
import { formatPostDate, formatTime, sourceLabel } from '../lib/labels';
import { describeLoadError } from '../lib/loadError';
import { TelegramPost } from './TelegramPost';
import { Button } from './ui/Button';
import { EmptyState } from './ui/Section';
import styles from './PublicationBrowser.module.css';

export interface IPublicationListItem {
  key: number;
  revisionId: number | null;
  title: string | null;
  /** Тема, составленная моделью: подпись строки, когда заголовка нет. */
  topic: string | null;
  publishedAt: string | null;
  observedAt: string;
  sourceTitle: string;
  sourceKey: string | null;
  sourceKind: string;
  url: string | null;
  snippet: string | null;
  /** Что сказано о компании — только в карточке компании. */
  facts?: string[];
}

interface IPublicationBrowserProps {
  items: IPublicationListItem[];
  isLoading: boolean;
  error: unknown;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  /** Почему пусто — словами: «ничего не найдено» и «ещё не собрано» разные вещи. */
  empty: ReactNode;
}

/** Две колонки — с этой ширины: уже список и текст мешают друг другу. */
const WIDE = '(min-width: 900px)';

export const PublicationBrowser: FC<IPublicationBrowserProps> = ({
  items,
  isLoading,
  error,
  hasMore,
  loadingMore,
  onLoadMore,
  empty,
}) => {
  const wide = useMediaQuery(WIDE);
  const [selectedKey, setSelectedKey] = useState<number | null>(null);
  // На широком экране справа сразу первая публикация: пустая панель — лишний клик.
  const selected = items.find(i => i.key === selectedKey) ?? (wide ? (items[0] ?? null) : null);
  const detailOpen = !wide && selected !== null;

  // Телефон: пост открывается вместо списка. Без этого фокус падал на body, пост мог
  // оказаться выше экрана, а «← К списку» теряло место, где человек читал список.
  const listScroll = useRef(0);
  const detailRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<number, HTMLButtonElement>());
  const returnTo = useRef<number | null>(null);

  useEffect(() => {
    if (!detailOpen) return;
    detailRef.current?.scrollIntoView?.({ block: 'start' });
    detailRef.current?.focus({ preventScroll: true });
  }, [detailOpen, selected?.key]);

  useEffect(() => {
    if (detailOpen || returnTo.current === null) return;
    const key = returnTo.current;
    returnTo.current = null;
    window.scrollTo?.(0, listScroll.current);
    itemRefs.current.get(key)?.focus({ preventScroll: true });
  }, [detailOpen]);

  const open = (key: number): void => {
    if (!wide) listScroll.current = window.scrollY;
    setSelectedKey(key);
  };

  const close = (): void => {
    returnTo.current = selected?.key ?? null;
    setSelectedKey(null);
  };

  if (error) return <p role="alert">{describeLoadError(error)}</p>;
  if (isLoading) return <p className={styles.muted}>Загрузка…</p>;
  if (items.length === 0) return <EmptyState>{empty}</EmptyState>;

  return (
    <div className={`${styles.layout} ${detailOpen ? styles.detailOpen : ''}`}>
      <div className={styles.list}>
        <ul className={styles.items}>
          {items.map(item => {
            const heading = item.title ?? item.topic;
            const when = item.publishedAt ?? item.observedAt;
            return (
              <li key={item.key}>
                <button
                  type="button"
                  ref={el => {
                    if (el) itemRefs.current.set(item.key, el);
                    else itemRefs.current.delete(item.key);
                  }}
                  className={`${styles.item} ${selected?.key === item.key ? styles.itemActive : ''}`}
                  // Имя кнопки — дата, канал и тема: весь текст карточки диктор читал бы минуту.
                  aria-label={[formatPostDate(when), sourceLabel(item), heading].filter(Boolean).join(', ')}
                  aria-current={selected?.key === item.key ? 'true' : undefined}
                  onClick={() => open(item.key)}
                >
                  <span className={styles.itemHead}>
                    <span className={styles.itemDate}>{formatPostDate(when)}</span>
                    <span className={styles.itemTime}>{formatTime(when)}</span>
                    <span className={styles.itemSource}>{sourceLabel(item)}</span>
                  </span>
                  {heading && (
                    <span className={styles.itemTitle}>
                      {heading}
                      {/* Тема — подпись модели, не заголовок источника: говорим это прямо. */}
                      {item.title === null && <span className={styles.itemMark}> · тема от модели</span>}
                    </span>
                  )}
                  {item.snippet && <span className={styles.itemSnippet}>{item.snippet}</span>}
                  {item.facts && item.facts.length > 0 && (
                    <span className={styles.itemFacts}>{item.facts.join(' · ')}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        {hasMore && (
          <div className={styles.more}>
            <Button variant="ghost" onClick={onLoadMore} disabled={loadingMore} block>
              {loadingMore ? 'Загрузка…' : 'Показать ещё'}
            </Button>
          </div>
        )}
      </div>

      <div className={styles.detail} ref={detailRef} tabIndex={-1}>
        {selected && (
          <TelegramPost
            key={selected.key}
            revisionId={selected.revisionId}
            sourceTitle={selected.sourceTitle}
            sourceKey={selected.sourceKey}
            sourceKind={selected.sourceKind}
            publishedAt={selected.publishedAt}
            observedAt={selected.observedAt}
            url={selected.url}
            title={selected.title}
            onClose={wide ? undefined : close}
          />
        )}
      </div>
    </div>
  );
};
