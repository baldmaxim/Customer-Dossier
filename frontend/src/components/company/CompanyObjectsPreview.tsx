// «Объекты» на «Обзоре»: первые карточки и «Все объекты — N» — переход на вкладку «Объекты»,
// а не прокрутка вниз. Порядок — тот же, что на вкладке: свои и со сведениями ДОМ.РФ первыми.

import { FC } from 'react';

import { formatCount } from '../../lib/format';
import { describeLoadError } from '../../lib/loadError';
import { LoadingSkeleton } from '../LoadingSkeleton';
import { Button } from '../ui/Button';
import { ButtonLink } from '../ui/ButtonLink';
import { Callout } from '../ui/Callout';
import { EmptyState } from '../ui/EmptyState';
import { Section } from '../ui/Section';
import { ObjectCard } from './ObjectCard';
import { useCompanyObjects } from './useCompanyQueries';
import styles from './CompanyObjects.module.css';

/** Карточек в превью: два ряда по две на широком экране. */
const PREVIEW = 4;

export const CompanyObjectsPreview: FC<{ companyId: number }> = ({ companyId }) => {
  const query = useCompanyObjects(companyId);
  const items = query.data?.items ?? [];
  const total = query.data?.coverage.total ?? items.length;

  return (
    <Section
      title="Объекты"
      note={total > 0 ? formatCount(total) : undefined}
      footer={
        total > 0 && (
          <ButtonLink to={{ search: '?tab=objects' }} viewTransition={false} variant="link" iconEnd="forward">
            Все объекты — {formatCount(total)}
          </ButtonLink>
        )
      }
    >
      {query.isLoading && <LoadingSkeleton label="Загружаю объекты…" lines={2} height="140px" radius="md" />}
      {query.isError && (
        <Callout
          tone="danger"
          title="Объекты не загрузились"
          action={
            <Button size="sm" onClick={() => void query.refetch()}>
              Повторить
            </Button>
          }
        >
          {describeLoadError(query.error)}
        </Callout>
      )}
      {query.isSuccess && items.length === 0 && (
        <EmptyState size="sm">
          Ни в публикациях, ни в ДОМ.РФ компания не названа участником объекта. Это не значит, что объектов у неё нет.
        </EmptyState>
      )}
      {items.length > 0 && (
        <ul className={`${styles.grid} ${styles.preview}`}>
          {items.slice(0, PREVIEW).map(o => (
            <li key={o.projectId} className={styles.cell}>
              <ObjectCard object={o} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
};
