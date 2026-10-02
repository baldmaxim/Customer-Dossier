// Вкладка «Сведения» — первая в карточке (ADR-016): портал строится от компании. Сначала юрлицо —
// ЕГРЮЛ из Контур.Фокуса, затем реестр застройщика, затем коротко о том, что дальше: объекты, события,
// публикации (плитки ведут на свои вкладки). Справа от 900px — «С кем связана».
//
// У имени без ИНН сведений ЕГРЮЛ быть не может: вместо них — «Юрлицо не установлено» (CompanyUnidentified),
// у группы компаний — пояснение, что своего ИНН у группы нет.

import { FC, useEffect } from 'react';
import { useLocation } from 'react-router-dom';

import type { ICompanyResponse } from '../../api/types';
import { scrollBehavior } from '../../lib/motion';
import { CompanyBrief } from '../CompanyBrief';
import { CompanyPartners } from '../CompanyPartners';
import { RegistryPanel } from '../RegistryPanel';
import { Callout } from '../ui/Callout';
import { Section } from '../ui/Section';
import { Stack } from '../ui/Stack';
import { CompanyFocus } from './CompanyFocus';
import { CompanyUnidentified } from './CompanyUnidentified';
import { useCompanyObjects } from './useCompanyQueries';
import styles from './Company.module.css';

const LEGAL_IDENTIFIERS = new Set(['inn', 'ogrn', 'ogrnip']);

/** У карточки есть реквизит юрлица с верной контрольной суммой — Фокусу есть что спросить. */
export const hasLegalIdentifier = (data: ICompanyResponse): boolean =>
  (data.identifiers ?? []).some(i => LEGAL_IDENTIFIERS.has(i.type) && i.validationStatus === 'checksum_valid');

export const CompanyInfo: FC<{ companyId: number; data: ICompanyResponse }> = ({ companyId, data }) => {
  const objects = useCompanyObjects(companyId);
  const items = objects.data?.items ?? [];
  const location = useLocation();
  const target = location.hash ? decodeURIComponent(location.hash.slice(1)) : '';

  // Плитка «Реестр» ведёт якорем сюда же: довести взгляд до раздела.
  useEffect(() => {
    if (!target) return;
    document.getElementById(target)?.scrollIntoView?.({ behavior: scrollBehavior(), block: 'start' });
  }, [location.key, target]);

  const group = data.company.entityType === 'group';
  return (
    <div className={styles.overview}>
      <Stack gap={4} className={styles.overviewMain}>
        {hasLegalIdentifier(data) ? (
          <Section id="company-egrul" title="ЕГРЮЛ — Контур.Фокус">
            <CompanyFocus companyId={companyId} />
          </Section>
        ) : group ? (
          <Callout tone="neutral" title="Группа компаний">
            У группы нет своего ИНН: сведения ЕГРЮЛ — у её юрлиц. Юрлица группы — в «С кем связана» и на вкладке «Объекты».
          </Callout>
        ) : (
          <CompanyUnidentified companyId={companyId} data={data} />
        )}
        {data.registry && (
          <div id="company-registry">
            <RegistryPanel registry={data.registry} title="Сведения реестра о застройщике" />
          </div>
        )}
        <CompanyBrief
          companyId={companyId}
          objects={items}
          objectsTotal={objects.data?.coverage.total ?? items.length}
          objectsKnown={objects.isSuccess}
          company={data}
        />
      </Stack>
      <div className={styles.overviewAside}>
        <CompanyPartners companyId={companyId} />
      </div>
    </div>
  );
};
