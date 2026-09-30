// Одно событие компании: вид и дата, объект (ссылкой), сумма, вторая сторона, источник.
// Название объекта переносится по словам: ярлык без переноса выталкивал страницу за край окна.

import { FC } from 'react';
import { Link } from 'react-router-dom';

import type { IEventRow } from '../../api/types';
import { EVENT_LABELS, formatDate, formatMoney, sourceLabel } from '../../lib/labels';
import { Icon } from '../ui/Icon';
import styles from './Company.module.css';

const sourceName = (event: IEventRow): string => {
  if (event.sourceTitle) {
    return sourceLabel({ sourceTitle: event.sourceTitle, sourceKey: event.sourceKey, sourceKind: event.sourceKind ?? '' });
  }
  if (event.url) {
    try {
      return new URL(event.url).hostname;
    } catch {
      return 'Публикация';
    }
  }
  return 'источник не указан';
};

export const EventItem: FC<{ event: IEventRow }> = ({ event }) => {
  const source = sourceName(event);
  return (
    <li className={styles.event}>
      <div className={styles.eventHead}>
        <span className={styles.eventType}>{EVENT_LABELS[event.type] ?? event.type}</span>
        {event.occurredOn ? (
          <time className={styles.eventDate} dateTime={event.occurredOn}>
            {formatDate(event.occurredOn)}
          </time>
        ) : (
          <span className={styles.eventDate}>дата неизвестна</span>
        )}
      </div>
      {(event.projectName || event.amountRub !== null || event.counterpartyName) && (
        <p className={styles.eventMeta}>
          {event.projectName &&
            (event.projectId !== null ? (
              <Link className={styles.refLink} to={`/projects/${event.projectId}`} viewTransition>
                {event.projectName}
              </Link>
            ) : (
              <span>{event.projectName}</span>
            ))}
          {event.counterpartyName && (
            <span>
              {' '}
              с{' '}
              {event.counterpartyId !== null ? (
                <Link className={styles.refLink} to={`/company/${event.counterpartyId}`} viewTransition>
                  {event.counterpartyName}
                </Link>
              ) : (
                event.counterpartyName
              )}
            </span>
          )}
          {event.amountRub !== null && <span className={styles.eventAmount}>{formatMoney(event.amountRub)}</span>}
        </p>
      )}
      {/* Источник со ссылкой — строка целиком: на телефоне это цель нажатия, а не 20px текста. */}
      {event.url ? (
        <a
          className={styles.sourceRow}
          href={event.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${source} — открыть публикацию`}
        >
          <span className={styles.sourceLabel} aria-hidden="true">
            Источник:
          </span>{' '}
          <span className={styles.sourceName}>{source}</span>
          <Icon name="external" size="sm" className={styles.external} />
        </a>
      ) : (
        <p className={styles.eventSource}>Источник: {source}</p>
      )}
    </li>
  );
};
