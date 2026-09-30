// Вкладка «Подробно»: опознание → реестр → все события → показатели → резюме и
// противоречия → схема связей. На телефоне раскрыт только первый раздел; ссылка «Все
// события» с «Обзора» (#company-events) раскрывает события и прокручивает к ним.

import { FC, useEffect } from 'react';
import { useLocation } from 'react-router-dom';

import type { ICompanyResponse } from '../../api/types';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { MQ } from '../../lib/media';
import { scrollBehavior } from '../../lib/motion';
import { CompanySignals } from '../CompanySignals';
import { CompanySummary } from '../CompanySummary';
import { GraphPanel } from '../GraphPanel';
import { RegistryPanel } from '../RegistryPanel';
import { Stack } from '../ui/Stack';
import { CompanyEvents } from './CompanyEvents';
import { CompanyIdentity } from './CompanyIdentity';
import { DetailSection } from './DetailSection';
import { EVENTS_SECTION_ID } from './eventOrder';
import { useCompanyProjects } from './useCompanyQueries';

export const CompanyDetails: FC<{ companyId: number; data: ICompanyResponse }> = ({ companyId, data }) => {
  const wide = useMediaQuery(MQ.sm);
  const { hash } = useLocation();
  const toEvents = hash === `#${EVENTS_SECTION_ID}`;
  const projects = useCompanyProjects(companyId);
  const projectNames = new Map((projects.data?.items ?? []).map(p => [p.id, p.name]));

  // Пришли по «Все события»: раздел уже раскрыт (defaultOpen), остаётся довести до него взгляд.
  useEffect(() => {
    if (!toEvents) return;
    document.getElementById(EVENTS_SECTION_ID)?.scrollIntoView?.({ behavior: scrollBehavior(), block: 'start' });
  }, [toEvents]);

  return (
    <Stack gap={4}>
      <DetailSection id="company-identity" title="Опознание" defaultOpen>
        <CompanyIdentity companyId={companyId} data={data} />
      </DetailSection>
      {data.registry && (
        <DetailSection id="company-registry" title="Реестр" defaultOpen={wide} bare>
          <RegistryPanel registry={data.registry} title="Сведения реестра о застройщике" />
        </DetailSection>
      )}
      <DetailSection id={EVENTS_SECTION_ID} title="События" defaultOpen={wide || toEvents}>
        <CompanyEvents companyId={companyId} />
      </DetailSection>
      <DetailSection id="company-signals" title="Показатели" defaultOpen={wide}>
        <CompanySignals companyId={companyId} projectNames={projectNames} />
      </DetailSection>
      <DetailSection id="company-summary" title="Резюме и противоречия" defaultOpen={wide}>
        <CompanySummary companyId={companyId} />
      </DetailSection>
      {/* Схема — таким же разделом, как остальные, но граф грузится только после раскрытия. */}
      <DetailSection id="company-graph" title="Схема связей" defaultOpen={false} lazy>
        <GraphPanel companyId={companyId} defaultOpen title={null} variant="plain" linksPageLink />
      </DetailSection>
    </Stack>
  );
};
