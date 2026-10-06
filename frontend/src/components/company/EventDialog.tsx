// Событие компании окном: вид, дата, объект и вторая сторона ссылками, сумма и откуда известно. У события
// нового конвейера — цитаты сведения (AssertionDetail: в проекции card_events_v его id — минус id
// утверждения), у события прежней обработки — сохранённая цитата и ссылка на оригинал.

import { FC } from 'react';
import { Link } from 'react-router-dom';

import type { IEventRow } from '../../api/types';
import { EVENT_LABELS, formatDate, formatMoney, sourceLabel } from '../../lib/labels';
import { AssertionDetail } from '../AssertionDetail';
import { DescriptionList, type IDescriptionItem } from '../ui/DescriptionList';
import { Dialog } from '../ui/Dialog';
import { Heading } from '../ui/Heading';
import { HeadingLevelContext } from '../ui/headingLevel';
import { Icon } from '../ui/Icon';
import { VisuallyHidden } from '../ui/VisuallyHidden';
import styles from './CompanyDetails.module.css';

/** Название источника события: канал или сайт, иначе — адрес. */
export const eventSourceName = (event: IEventRow): string => {
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

const LegacyQuote: FC<{ event: IEventRow }> = ({ event }) => (
  <div>
    {event.quote && <blockquote className={styles.quote}>«{event.quote}»</blockquote>}
    {event.url ? (
      <a className={styles.quoteSource} href={event.url} target="_blank" rel="noopener noreferrer">
        {eventSourceName(event)}
        <Icon name="external" size="sm" />
        <VisuallyHidden> (откроется в новой вкладке)</VisuallyHidden>
      </a>
    ) : (
      <p className={styles.note}>Источник: {eventSourceName(event)}</p>
    )}
  </div>
);

interface IEventDialogProps {
  /** Последнее открытое событие: остаётся, пока окно доигрывает закрытие. */
  event: IEventRow | null;
  open: boolean;
  onClose: () => void;
}

export const EventDialog: FC<IEventDialogProps> = ({ event, open, onClose }) => {
  if (!event) return null;
  const assertionId = event.id < 0 ? -event.id : null;
  const items: IDescriptionItem[] = [{ label: 'Дата события', value: event.occurredOn ? formatDate(event.occurredOn) : 'неизвестна' }];
  if (event.projectName) {
    items.push({
      label: 'Объект',
      value: event.projectId !== null ? <Link to={`/projects/${event.projectId}`}>{event.projectName}</Link> : event.projectName,
    });
  }
  if (event.counterpartyName) {
    items.push({
      label: 'Вторая сторона',
      value: event.counterpartyId !== null ? <Link to={`/company/${event.counterpartyId}`}>{event.counterpartyName}</Link> : event.counterpartyName,
    });
  }
  if (event.amountRub !== null) items.push({ label: 'Сумма', value: formatMoney(event.amountRub) });

  return (
    <Dialog open={open} onClose={onClose} title={EVENT_LABELS[event.type] ?? 'Событие'} size="lg">
      <DescriptionList items={items} />
      <Heading className={styles.dialogHeading}>Откуда известно</Heading>
      <HeadingLevelContext.Provider value={4}>
        {assertionId !== null ? <AssertionDetail assertionId={assertionId} showSummary={false} /> : <LegacyQuote event={event} />}
      </HeadingLevelContext.Provider>
      <p className={styles.note}>Событие — сообщение источника, а не вывод о компании.</p>
    </Dialog>
  );
};
