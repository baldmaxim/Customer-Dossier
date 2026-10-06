// Вкладка «Сведения» — первая в карточке (ADR-016): портал строится от компании. Главное о юрлице —
// уже в шапке (статус, руководитель, адрес, реквизиты); здесь сначала итоги плитками во всю ширину
// (объекты, события, публикации, связи, суды — ведут на свои вкладки), под ними слева — кто строит для
// компании (генподрядчики её объектов, 24D), финансы и налоги (ГИР БО и ФНС, 24B), суды, ФССП и банкротство (24C), сроки и продажи по домам ДОМ.РФ (24E), объекты по
// данным ДОМ.РФ с записью застройщика, публикации и события по месяцам и разбивки (роли, события, тексты),
// справа — остальное ЕГРЮЛ, сайт компании (25A) и
// «С кем связана» (05.10.2026: раньше длинные списки ЕГРЮЛ и реестра шли первыми, а итоги — последними).
//
// У имени без ИНН и у группы сведений ЕГРЮЛ нет: об этом — надпись с подсказкой над названием, а назначение
// имени компании — в шапке под ярлыком «Назначить компании» (CompanyPage).
//
// Без повторов (05.10.2026): что стоит в шапке (статус, руководитель, адрес, реквизиты), разделы ЕГРЮЛ и
// реестра не печатают ещё раз; оговорки источников — одним блоком внизу (CompanySources).

import { FC, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';

import type { ICompanyResponse } from '../../api/types';
import { scrollBehavior } from '../../lib/motion';
import { CompanyBrief } from '../CompanyBrief';
import { CompanyPartners } from '../CompanyPartners';
import { Section } from '../ui/Section';
import { CompanyActivity } from './CompanyActivity';
import { CompanyBuilders } from './CompanyBuilders';
import { CompanyChecks } from './CompanyChecks';
import { CompanyDelivery } from './CompanyDelivery';
import { CompanyFinance } from './CompanyFinance';
import { CompanyFocus } from './CompanyFocus';
import { CompanyPortfolio } from './CompanyPortfolio';
import { CompanySite } from './CompanySite';
import { CompanySources } from './CompanySources';
import { CompanyStructure } from './CompanyStructure';
import { useCompanyFocus, useCompanyObjects } from './useCompanyQueries';
import styles from './Company.module.css';

const LEGAL_IDENTIFIERS = new Set(['inn', 'ogrn', 'ogrnip']);

/** У карточки есть реквизит юрлица с верной контрольной суммой — Фокусу есть что спросить. */
export const hasLegalIdentifier = (data: ICompanyResponse): boolean =>
  (data.identifiers ?? []).some(i => LEGAL_IDENTIFIERS.has(i.type) && i.validationStatus === 'checksum_valid');

/** Строки Фокуса, которые шапка карточки уже показала: статус, руководитель, адрес — всегда (шапка берёт их
 * из того же ответа), наименование — если оно заголовок, КПП — если он среди реквизитов. */
const headerFocusKeys = (data: ICompanyResponse): ReadonlySet<string> => {
  const keys = new Set(['status', 'heads', 'address']);
  if (data.egrul?.name) keys.add('name');
  if ((data.identifiers ?? []).some(i => i.type === 'kpp')) keys.add('kpp');
  return keys;
};

/** Строки карточки застройщика, которые уже стоят на странице: застройщик — сама компания, его ИНН/ОГРН/КПП —
 * в реквизитах шапки, юридический адрес — в шапке (адрес ЕГРЮЛ или, если его нет, этот же). */
const shownRegistryRows = (data: ICompanyResponse, headerAddress: string | null): ReadonlySet<string> => {
  const registry = data.registry;
  const omit = new Set<string>(['developer']);
  if (!registry) return omit;
  const ids = new Set((data.identifiers ?? []).map(i => i.value));
  if (registry.developer?.inn && ids.has(registry.developer.inn)) omit.add('inn');
  if (registry.developer?.ogrn && ids.has(registry.developer.ogrn)) omit.add('ogrn');
  const kpp = registry.fields.find(f => f.label === 'КПП');
  if (kpp && ids.has(kpp.value)) omit.add('КПП');
  const legal = registry.fields.find(f => f.label === 'Юридический адрес');
  if (legal && legal.value === registry.address) omit.add('Юридический адрес');
  if (registry.address && registry.address === headerAddress) omit.add('address');
  return omit;
};

export const CompanyInfo: FC<{ companyId: number; data: ICompanyResponse }> = ({ companyId, data }) => {
  const objects = useCompanyObjects(companyId);
  const identified = hasLegalIdentifier(data);
  const focus = useCompanyFocus(companyId, identified);
  const headerAddress = focus.data?.summary?.address ?? data.registry?.address ?? null;
  const focusHidden = useMemo(() => headerFocusKeys(data), [data]);
  const registryOmit = useMemo(() => shownRegistryRows(data, headerAddress), [data, headerAddress]);
  const items = objects.data?.items ?? [];
  const location = useLocation();
  const target = location.hash ? decodeURIComponent(location.hash.slice(1)) : '';

  // Плитка «Реестр» ведёт якорем сюда же: довести взгляд до раздела.
  useEffect(() => {
    if (!target) return;
    document.getElementById(target)?.scrollIntoView?.({ behavior: scrollBehavior(), block: 'start' });
  }, [location.key, target]);

  return (
    <>
      <CompanyBrief
        companyId={companyId}
        objects={items}
        objectsTotal={objects.data?.coverage.total ?? items.length}
        objectsKnown={objects.isSuccess}
        company={data}
      />
      <div className={styles.overview}>
        <div className={styles.overviewMain}>
          <CompanyBuilders companyId={companyId} />
          <CompanyFinance companyId={companyId} />
          <CompanyChecks companyId={companyId} />
          <CompanyDelivery companyId={companyId} />
          <CompanyPortfolio companyId={companyId} data={data} registryOmit={registryOmit} />
          <CompanyActivity companyId={companyId} />
          <CompanyStructure companyId={companyId} />
        </div>
        <div className={styles.overviewAside}>
          {identified && (
            <Section id="company-egrul" title="ЕГРЮЛ — Контур.Фокус">
              <CompanyFocus companyId={companyId} hideKeys={focusHidden} layout="stacked" />
            </Section>
          )}
          <CompanySite companyId={companyId} companyName={data.egrul?.name ?? data.company.name} />
          <CompanyPartners companyId={companyId} />
        </div>
      </div>
      <CompanySources companyId={companyId} data={data} identified={identified} />
    </>
  );
};
