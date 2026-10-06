// «События» во вкладке «Подробно»: по дате события, без даты — в конце. Строка — одна линия «что, когда,
// где»; нажатие открывает событие окном (объект, вторая сторона, цитата и источник). Сервер отдаёт последние
// 100 и общее число: усечённый список так и подписан, а не выдаётся за все.

import { FC, useState } from 'react';

import type { IEventRow } from '../../api/types';
import { formatCount } from '../../lib/format';
import { EVENT_LABELS, formatDate, formatMoney } from '../../lib/labels';
import { describeLoadError } from '../../lib/loadError';
import { LoadingSkeleton } from '../LoadingSkeleton';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { EmptyState } from '../ui/EmptyState';
import { Icon } from '../ui/Icon';
import { EventDialog, eventSourceName } from './EventDialog';
import { byEventDate } from './eventOrder';
import { useCompanyEvents } from './useCompanyQueries';
import styles from './CompanyDetails.module.css';

/** Подробности строки: объект, вторая сторона, сумма, источник — через «·». */
const eventMeta = (event: IEventRow): string =>
  [
    event.projectName,
    event.counterpartyName && `с ${event.counterpartyName}`,
    event.amountRub !== null && formatMoney(event.amountRub),
    eventSourceName(event),
  ]
    .filter(Boolean)
    .join(' · ');

export const CompanyEvents: FC<{ companyId: number }> = ({ companyId }) => {
  const query = useCompanyEvents(companyId);
  const [selected, setSelected] = useState<IEventRow | null>(null);
  const [open, setOpen] = useState(false);
  const events = byEventDate(query.data?.items ?? []);

  if (query.isLoading) {
    return <LoadingSkeleton label="Загружаю события…" lines={4} height="48px" />;
  }
  if (query.isError) {
    return (
      <Callout
        tone="danger"
        title="События не загрузились"
        action={
          <Button size="sm" onClick={() => void query.refetch()}>
            Повторить
          </Button>
        }
      >
        {describeLoadError(query.error)}
      </Callout>
    );
  }
  if (events.length === 0) {
    return <EmptyState size="sm">В собранных публикациях событий компании не найдено.</EmptyState>;
  }
  return (
    <div className={styles.panel}>
      <ul className={styles.rows} aria-label="События компании">
        {events.map(event => {
          const label = EVENT_LABELS[event.type] ?? 'событие';
          return (
            <li key={event.id} className={styles.row}>
              <button
                type="button"
                className={styles.eventRow}
                aria-haspopup="dialog"
                onClick={() => {
                  setSelected(event);
                  setOpen(true);
                }}
              >
                <span className={styles.eventText}>
                  <span className={styles.eventHead}>
                    <span className={styles.eventType}>{label}</span>
                    <span className={styles.eventDate}>{event.occurredOn ? formatDate(event.occurredOn) : 'дата неизвестна'}</span>
                  </span>
                  <span className={styles.rowMeta}>{eventMeta(event)}</span>
                </span>
                <Icon name="forward" size="sm" className={styles.eventArrow} />
              </button>
            </li>
          );
        })}
      </ul>
      <p className={styles.note}>
        {query.data?.truncated && query.data.total !== undefined
          ? `Показаны последние ${formatCount(events.length)} из ${formatCount(query.data.total)} по дате события. `
          : ''}
        Сначала новые; без даты — в конце. Событие объекта — сообщение источника, а не вывод о компании.
      </p>
      <EventDialog event={selected} open={open} onClose={() => setOpen(false)} />
    </div>
  );
};
