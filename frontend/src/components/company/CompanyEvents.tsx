// События компании во вкладке «Подробно» — по дате события, без даты — в конце. Сервер отдаёт последние 100
// и общее число: усечённый список так и подписан, а не выдаётся за все.

import { FC } from 'react';

import { formatCount } from '../../lib/format';
import { describeLoadError } from '../../lib/loadError';
import { LoadingSkeleton } from '../LoadingSkeleton';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { EmptyState } from '../ui/EmptyState';
import { EventItem } from './EventItem';
import { byEventDate } from './eventOrder';
import { useCompanyEvents } from './useCompanyQueries';
import styles from './Company.module.css';

export const CompanyEvents: FC<{ companyId: number }> = ({ companyId }) => {
  const query = useCompanyEvents(companyId);
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
    <>
      <ol className={styles.events}>
        {events.map(event => (
          <EventItem key={event.id} event={event} />
        ))}
      </ol>
      <p className={styles.note}>
        {query.data?.truncated && query.data.total !== undefined
          ? `Показаны последние ${formatCount(events.length)} из ${formatCount(query.data.total)} по дате события. `
          : ''}
        Сначала новые по дате события; события без даты — в конце. Событие объекта — сообщение источника, а не вывод о компании.
      </p>
    </>
  );
};
