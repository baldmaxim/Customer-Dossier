// Вкладка «Обзор»: плитки-итоги, последние события, первые объекты карточками; с 900px справа —
// «С кем связана». Все объекты — на вкладке «Объекты»; реестр, опознание, показатели и схема — в «Подробно».

import { FC } from 'react';

import { CompanyBrief } from '../CompanyBrief';
import { CompanyPartners } from '../CompanyPartners';
import { Stack } from '../ui/Stack';
import { CompanyLatestEvents } from './CompanyLatestEvents';
import { CompanyObjectsPreview } from './CompanyObjectsPreview';
import { useCompany, useCompanyObjects } from './useCompanyQueries';
import styles from './Company.module.css';

export const CompanyOverview: FC<{ companyId: number }> = ({ companyId }) => {
  const objects = useCompanyObjects(companyId);
  // Карточка уже загружена страницей: ответ берётся из кэша, второго запроса нет.
  const company = useCompany(companyId, true).data;
  const items = objects.data?.items ?? [];

  return (
    <div className={styles.overview}>
      <Stack gap={4} className={styles.overviewMain}>
        <CompanyBrief
          companyId={companyId}
          objects={items}
          objectsTotal={objects.data?.coverage.total ?? items.length}
          objectsKnown={objects.isSuccess}
          company={company}
        />
        <CompanyLatestEvents companyId={companyId} />
        <CompanyObjectsPreview companyId={companyId} />
      </Stack>
      <div className={styles.overviewAside}>
        <CompanyPartners companyId={companyId} />
      </div>
    </div>
  );
};
