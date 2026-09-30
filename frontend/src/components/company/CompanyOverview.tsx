// Вкладка «Обзор»: коротко о компании, последние события, объекты; с 900px справа —
// «С кем связана». Реестр, опознание, показатели и схема — во вкладке «Подробно».

import { FC } from 'react';

import { CompanyBrief } from '../CompanyBrief';
import { CompanyPartners } from '../CompanyPartners';
import { CompanyProjects } from '../CompanyProjects';
import { Stack } from '../ui/Stack';
import { CompanyLatestEvents } from './CompanyLatestEvents';
import { useCompanyProjects } from './useCompanyQueries';
import styles from './Company.module.css';

export const CompanyOverview: FC<{ companyId: number }> = ({ companyId }) => {
  const projects = useCompanyProjects(companyId);
  const rows = projects.data?.items ?? [];

  return (
    <div className={styles.overview}>
      <Stack gap={4} className={styles.overviewMain}>
        <CompanyBrief companyId={companyId} projects={rows} projectsKnown={projects.isSuccess} />
        <CompanyLatestEvents companyId={companyId} />
        <CompanyProjects
          projects={rows}
          isLoading={projects.isLoading}
          error={projects.error}
          onRetry={() => void projects.refetch()}
        />
      </Stack>
      <div className={styles.overviewAside}>
        <CompanyPartners companyId={companyId} />
      </div>
    </div>
  );
};
