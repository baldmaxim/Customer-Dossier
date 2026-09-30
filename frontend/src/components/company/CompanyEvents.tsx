// Все события компании во вкладке «Подробно» — по дате события, без даты — в конце.

import { FC } from 'react';

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
        Сначала новые по дате события; события без даты — в конце. Событие объекта — сообщение источника, а не вывод о компании.
      </p>
    </>
  );
};
