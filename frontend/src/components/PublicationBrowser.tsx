// Публикации: список слева, выбранная — справа, как в мессенджере.
//
// Раньше публикация открывалась отдельной страницей со служебным разбором, и чтобы
// прочитать пять новостей, приходилось пять раз уходить и возвращаться. Здесь список
// остаётся на месте. Карточка в списке — одна кнопка целиком: нажимать можно в любое
// место, а не только в заголовок.
//
// На телефоне (и в низком окне) двух колонок нет: выбранная публикация открывается вместо
// списка. Возврат один — «К списку» у самого поста; возврат оболочки (BackBar) на это время
// спрятан: его «Назад» читался бы как «уйти со страницы». С urlParam пост живёт в адресе,
// и системное «Назад» тоже закрывает его (usePostSelection).

import { FC, ReactNode, useEffect, useRef } from 'react';

import { useMediaQuery } from '../hooks/useMediaQuery';
import { describeLoadError } from '../lib/loadError';
import { MQ } from '../lib/media';
import type { IFactView } from '../lib/publicationFacts';
import { PublicationCard } from './publication/PublicationCard';
import { PublicationFacts } from './publication/PublicationFacts';
import { usePostSelection } from './publication/usePostSelection';
import { TelegramPost } from './TelegramPost';
import { LoadingSkeleton } from './LoadingSkeleton';
import { Button } from './ui/Button';
import { Callout } from './ui/Callout';
import { EmptyState } from './ui/EmptyState';
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
  /** Что сказано о компании — строками (карточка компании). */
  facts?: string[];
  /** То же по частям — под постом ссылками на объект и компанию. Есть — строки берутся отсюда. */
  factViews?: IFactView[];
  /** Сколько сведений сервер к публикации не прислал. */
  moreFacts?: number;
  /** Номер в догруженной порции: элемент входит лесенкой (.appear, --i). */
  appearIndex?: number;
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
  emptyTitle?: string;
  /** Параметр адреса для открытого поста ('post'). Без него выбор живёт только в памяти. */
  urlParam?: string;
  /** Повторить загрузку после ошибки. */
  onRetry?: () => void;
  /** Заголовок сведений под постом. */
  factsTitle?: string;
}

export const PublicationBrowser: FC<IPublicationBrowserProps> = ({
  items,
  isLoading,
  error,
  hasMore,
  loadingMore,
  onLoadMore,
  empty,
  emptyTitle,
  urlParam,
  onRetry,
  factsTitle = 'Что портал нашёл в публикации',
}) => {
  const wide = useMediaQuery(MQ.reader);
  const selection = usePostSelection(urlParam, wide);
  // На широком экране справа сразу первая публикация: пустая панель — лишний клик.
  const selected = items.find(i => i.key === selection.key) ?? (wide ? (items[0] ?? null) : null);
  const selectedKey = selected?.key ?? null;
  const detailOpen = !wide && selected !== null;

  const listScroll = useRef(0);
  const detailRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<number, HTMLButtonElement>());
  const openedKey = useRef<number | null>(null);

  // Телефон: пост открыт вместо списка — фокус на его заголовок (диктор слышит, что открылось);
  // закрыт — место в списке и фокус на ту карточку, с которой открывали. Зависимость — ключ,
  // а не объект: строки списка пересобираются на каждой отрисовке, и фокус прыгал бы назад.
  useEffect(() => {
    if (detailOpen && selectedKey !== null) {
      openedKey.current = selectedKey;
      detailRef.current?.querySelector<HTMLElement>('[data-post-heading]')?.focus({ preventScroll: true });
      // С адресом наверх страницу поднимает ScrollRestoration (новая запись истории).
      if (!urlParam) detailRef.current?.scrollIntoView?.({ block: 'start' });
      return;
    }
    if (!detailOpen && openedKey.current !== null) {
      const key = openedKey.current;
      openedKey.current = null;
      window.scrollTo?.(0, listScroll.current);
      itemRefs.current.get(key)?.focus({ preventScroll: true });
    }
  }, [detailOpen, selectedKey, urlParam]);

  const open = (key: number): void => {
    if (!wide) listScroll.current = window.scrollY;
    selection.open(key);
  };

  // data-fill-screen и в загрузке, ошибке, пустоте: раскладка страницы не прыгает между
  // обычной прокруткой и «одним экраном», когда данные приходят.
  if (error && items.length === 0) {
    return (
      <div className={styles.state} data-fill-screen>
        <Callout
          tone="danger"
          title="Публикации не загрузились"
          action={onRetry && <Button onClick={onRetry}>Повторить</Button>}
        >
          {describeLoadError(error)}
        </Callout>
      </div>
    );
  }
  if (isLoading) {
    return (
      <div className={styles.state} data-fill-screen>
        <LoadingSkeleton label="Загружаю публикации…" lines={5} height="88px" radius="md" />
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className={styles.state} data-fill-screen>
        <EmptyState title={emptyTitle}>{empty}</EmptyState>
      </div>
    );
  }

  const factViews = selected?.factViews ?? null;

  return (
    <div
      className={`${styles.layout} ${detailOpen ? styles.detailOpen : ''}`}
      data-fill-screen
      {...(detailOpen ? { 'data-hide-backbar': true } : {})}
    >
      <div className={styles.list}>
        <ul className={styles.items} aria-label="Публикации">
          {items.map(item => (
            <PublicationCard
              key={item.key}
              item={item}
              active={selected?.key === item.key}
              onOpen={() => open(item.key)}
              buttonRef={el => {
                if (el) itemRefs.current.set(item.key, el);
                else itemRefs.current.delete(item.key);
              }}
            />
          ))}
        </ul>
        {error !== null && error !== undefined && (
          <Callout tone="danger" title="Не удалось загрузить ещё" action={onRetry && <Button onClick={onRetry}>Повторить</Button>}>
            {describeLoadError(error)}
          </Callout>
        )}
        {hasMore && (
          <div className={styles.more}>
            <Button variant="secondary" onClick={onLoadMore} loading={loadingMore} block>
              Показать ещё
            </Button>
          </div>
        )}
      </div>

      <div className={styles.detail} ref={detailRef}>
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
            onClose={wide ? undefined : selection.close}
            footer={
              factViews && factViews.length + (selected.moreFacts ?? 0) > 0 ? (
                <PublicationFacts title={factsTitle} facts={factViews} more={selected.moreFacts} />
              ) : undefined
            }
          />
        )}
      </div>
    </div>
  );
};
