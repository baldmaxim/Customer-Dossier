// Карточка публикации в списке читалки — одна кнопка целиком: нажатие в любом месте открывает
// пост. Дата крупнее всего (ленту читают по времени), канал — всегда своей строкой, сведения о
// компании — по строке на сведение, остальное числом («и ещё 3 сведения»).

import { CSSProperties, FC, Ref } from 'react';

import { formatCountWord } from '../../lib/format';
import { formatPostDate, formatTime, sourceLabel } from '../../lib/labels';
import { factViewText } from '../../lib/publicationFacts';
import type { IPublicationListItem } from '../PublicationBrowser';
import styles from '../PublicationBrowser.module.css';

/** В карточке — две строки сведений, остальное числом. */
const FACTS_IN_CARD = 2;
const FACT_FORMS = ['сведение', 'сведения', 'сведений'] as const;

interface IPublicationCardProps {
  item: IPublicationListItem;
  active: boolean;
  onOpen: () => void;
  buttonRef: Ref<HTMLButtonElement>;
}

export const PublicationCard: FC<IPublicationCardProps> = ({ item, active, onOpen, buttonRef }) => {
  const heading = item.title ?? item.topic;
  const when = item.publishedAt ?? item.observedAt;
  const lines = item.factViews?.map(factViewText) ?? item.facts ?? [];
  const rest = Math.max(0, lines.length - FACTS_IN_CARD) + (item.moreFacts ?? 0);
  const appear = item.appearIndex !== undefined;

  return (
    <li
      className={appear ? 'appear' : undefined}
      // Номер в догруженной порции — динамическое значение: инлайн разрешён.
      style={appear ? ({ '--i': item.appearIndex } as CSSProperties) : undefined}
    >
      <button
        type="button"
        ref={buttonRef}
        className={`${styles.item} ${active ? styles.itemActive : ''}`}
        // Имя кнопки — дата, канал и тема: весь текст карточки диктор читал бы минуту.
        aria-label={[formatPostDate(when), sourceLabel(item), heading].filter(Boolean).join(', ')}
        aria-current={active ? 'true' : undefined}
        onClick={onOpen}
      >
        <span className={styles.itemHead}>
          <span className={styles.itemDate}>{formatPostDate(when)}</span>
          <span className={styles.itemTime}>{formatTime(when)}</span>
        </span>
        {/* Канал — всегда своей строкой: раньше он прыгал то вправо, то вниз. */}
        <span className={styles.itemSource}>{sourceLabel(item)}</span>
        {heading && (
          <span className={styles.itemTitle}>
            {heading}
            {/* Тема — подпись модели, не заголовок источника: говорим это прямо. */}
            {item.title === null && <span className={styles.itemMark}> · тема от модели</span>}
          </span>
        )}
        {item.snippet && <span className={styles.itemSnippet}>{item.snippet}</span>}
        {lines.length > 0 && (
          <span className={styles.itemFacts}>
            {lines.slice(0, FACTS_IN_CARD).map((line, i) => (
              <span key={i} className={styles.itemFact}>
                {line}
              </span>
            ))}
            {rest > 0 && <span className={styles.itemMore}>и ещё {formatCountWord(rest, FACT_FORMS)}</span>}
          </span>
        )}
      </button>
    </li>
  );
};
