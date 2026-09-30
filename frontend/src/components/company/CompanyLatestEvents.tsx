// «Последние события» на обзоре: три самых свежих по дате события — главный ответ на
// «как дела у компании». Все события — во вкладке «Подробно».

import { FC } from 'react';

import { formatCount } from '../../lib/format';
import { describeLoadError } from '../../lib/loadError';
import { LoadingSkeleton } from '../LoadingSkeleton';
import { Button } from '../ui/Button';
import { ButtonLink } from '../ui/ButtonLink';
import { Callout } from '../ui/Callout';
import { EmptyState } from '../ui/EmptyState';
import { Section } from '../ui/Section';
import { EventItem } from './EventItem';
import { EVENTS_SECTION_ID, byEventDate } from './eventOrder';
import { useCompanyEvents } from './useCompanyQueries';
import styles from './Company.module.css';

const LATEST = 3;

export const CompanyLatestEvents: FC<{ companyId: number }> = ({ companyId }) => {
  const query = useCompanyEvents(companyId);
  const events = query.data?.items ?? [];
  const latest = byEventDate(events).slice(0, LATEST);

  return (
    <Section
      title="Последние события"
      note={events.length > 0 ? `всего ${formatCount(events.length)}` : undefined}
      actions={
        events.length > LATEST && (
          // Настоящая ссылка на вкладку «Подробно» к разделу событий: её можно открыть в новой вкладке.
          <ButtonLink to={{ search: '?tab=details', hash: EVENTS_SECTION_ID }} viewTransition={false} variant="link" iconEnd="forward">
            Все события
          </ButtonLink>
        )
      }
    >
      {query.isLoading && (
        <LoadingSkeleton label="Загружаю события…" lines={3} height="48px" />
      )}
      {query.isError && (
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
      )}
      {query.isSuccess && events.length === 0 && (
        <EmptyState size="sm">В собранных публикациях событий компании не найдено.</EmptyState>
      )}
      {latest.length > 0 && (
        <ol className={styles.events}>
          {latest.map(event => (
            <EventItem key={event.id} event={event} />
          ))}
        </ol>
      )}
    </Section>
  );
};
