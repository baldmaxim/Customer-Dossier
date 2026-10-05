// Вкладка «Подробно»: опознание → все события → показатели → резюме и противоречия → схема связей.
// ЕГРЮЛ и реестр застройщика — на первой вкладке «Сведения» (ADR-016). Сверху — липкое меню разделов (AnchorNav). На телефоне раскрыт
// только первый раздел; переход по якорю (меню, «Все события» и плитки «Обзора» —
// #company-events и т. п.) раскрывает раздел и прокручивает к нему.
//
// Разделы описаны одним списком: из него строятся и меню, и сами разделы — разойтись им негде.

import { FC, ReactNode, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

import type { ICompanyResponse } from '../../api/types';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { MQ } from '../../lib/media';
import { scrollBehavior } from '../../lib/motion';
import { CompanySignals } from '../CompanySignals';
import { CompanySummary } from '../CompanySummary';
import { GraphPanel } from '../GraphPanel';
import { AnchorNav } from '../ui/AnchorNav';
import { Stack } from '../ui/Stack';
import { CompanyEvents } from './CompanyEvents';
import { CompanyIdentity } from './CompanyIdentity';
import { DetailSection } from './DetailSection';
import { EVENTS_SECTION_ID } from './eventOrder';
import { useCompanyProjects } from './useCompanyQueries';

interface IDetailSpec {
  id: string;
  title: string;
  /** Короткая подпись в меню, если заголовок длинный. */
  navLabel?: string;
  /** Раскрыт всегда, а не только на широком экране. */
  alwaysOpen?: boolean;
  bare?: boolean;
  lazy?: boolean;
  render: () => ReactNode;
}

export const CompanyDetails: FC<{ companyId: number; data: ICompanyResponse }> = ({ companyId, data }) => {
  const wide = useMediaQuery(MQ.sm);
  const location = useLocation();
  const target = location.hash ? decodeURIComponent(location.hash.slice(1)) : '';
  const projects = useCompanyProjects(companyId);
  const projectNames = new Map((projects.data?.items ?? []).map(p => [p.id, p.name]));

  // Разделы, к которым переходили по якорю, остаются раскрытыми: множество только растёт,
  // поэтому следующий переход не захлопнет раздел, который человек уже читает.
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set(target ? [target] : []));
  if (target && !opened.has(target)) setOpened(new Set([...opened, target]));

  // Раздел уже раскрыт (defaultOpen), остаётся довести до него взгляд. Ключ перехода —
  // location.key: повторное нажатие того же пункта меню снова приводит к разделу.
  useEffect(() => {
    if (!target) return;
    document.getElementById(target)?.scrollIntoView?.({ behavior: scrollBehavior(), block: 'start' });
  }, [location.key, target]);

  const sections: IDetailSpec[] = [
    { id: 'company-identity', title: 'Опознание', alwaysOpen: true, render: () => <CompanyIdentity companyId={companyId} data={data} /> },
    { id: EVENTS_SECTION_ID, title: 'События', render: () => <CompanyEvents companyId={companyId} /> },
    { id: 'company-signals', title: 'Показатели', render: () => <CompanySignals companyId={companyId} projectNames={projectNames} /> },
    { id: 'company-summary', title: 'Резюме и противоречия', navLabel: 'Резюме', render: () => <CompanySummary companyId={companyId} /> },
    // Схема — таким же разделом, как остальные, но граф грузится только после раскрытия.
    {
      id: 'company-graph',
      title: 'Схема связей',
      lazy: true,
      render: () => <GraphPanel companyId={companyId} defaultOpen title={null} variant="plain" linksPageLink />,
    },
  ];

  return (
    <Stack gap={3}>
      <AnchorNav label="Разделы" items={sections.map(s => ({ id: s.id, label: s.navLabel ?? s.title }))} />
      {sections.map(s => (
        <DetailSection
          key={s.id}
          id={s.id}
          title={s.title}
          defaultOpen={Boolean(s.alwaysOpen) || (wide && !s.lazy) || opened.has(s.id)}
          bare={s.bare}
          lazy={s.lazy}
        >
          {s.render()}
        </DetailSection>
      ))}
    </Stack>
  );
};
