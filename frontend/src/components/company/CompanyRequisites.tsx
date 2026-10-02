// Реквизиты под именем компании — сеткой «подпись над значением», как в карточках
// реестров: ИНН и ОГРН ищут глазом первыми и копируют нажатием, дальше город, вид лица,
// сайт и адрес из реестра. Колонки складываются сами по ширине (auto-fill), без медиазапросов.
//
// Адрес реестра — из снимка проектной декларации, подпись говорит об этом прямо. Статус, руководитель
// и юридический адрес — из ЕГРЮЛ по данным Контур.Фокуса (ADR-015): под сеткой строка, откуда они и на
// какую дату. Сведений Фокуса нет — этих строк нет, а не «не указано».

import { FC, ReactNode } from 'react';

import type { ICompanyResponse, IFocusView } from '../../api/types';
import { ENTITY_TYPE_LABELS, IDENTIFIER_TYPE_LABELS, formatDate } from '../../lib/labels';
import { CopyValue } from '../ui/CopyValue';
import styles from './Company.module.css';

/** ИНН и ОГРН — первыми: по ним компанию опознают; КПП и прочее — после. */
const IDENTIFIER_ORDER: Record<string, number> = { inn: 0, ogrn: 1, ogrnip: 2, bin: 3, kpp: 4 };

interface IRequisite {
  key: string;
  label: string;
  value: ReactNode;
  wide?: boolean;
}

/** Сайт из карточки — ссылкой, только http(s): строка из базы не должна стать javascript:-адресом. */
const websiteLink = (raw: string): ReactNode => {
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return raw;
    return (
      <a href={url.href} target="_blank" rel="noopener noreferrer">
        {url.host + (url.pathname === '/' ? '' : url.pathname)}
      </a>
    );
  } catch {
    return raw;
  }
};

export const CompanyRequisites: FC<{ data: ICompanyResponse; focus?: IFocusView | null }> = ({ data, focus = null }) => {
  const { company } = data;
  const identifiers = data.identifiers ?? [];
  const rows: IRequisite[] =
    identifiers.length > 0
      ? [...identifiers]
          .sort((a, b) => (IDENTIFIER_ORDER[a.type] ?? 9) - (IDENTIFIER_ORDER[b.type] ?? 9))
          .map(i => {
            const label = IDENTIFIER_TYPE_LABELS[i.type] ?? 'реквизит';
            return { key: `${i.type}:${i.value}`, label, value: <CopyValue label={label} value={i.value} /> };
          })
      : company.taxId
        ? [{ key: 'tax', label: 'ИНН/ОГРН', value: <CopyValue label="ИНН/ОГРН" value={company.taxId} /> }]
        : [{ key: 'tax', label: 'Реквизиты', value: 'не установлены' }];

  // Заголовок — наименование ЕГРЮЛ (ADR-016); под каким именем компания в публикациях — здесь.
  const egrulName = data.egrul?.name ?? null;
  if (egrulName && egrulName !== company.name && !company.namePending) rows.push({ key: 'text-name', label: 'В публикациях', value: company.name });
  const kind = company.entityType && company.entityType !== 'unknown' ? ENTITY_TYPE_LABELS[company.entityType] : null;
  const egrul = focus?.summary ?? null;
  if (egrul?.status) rows.push({ key: 'egrul-status', label: 'Статус в ЕГРЮЛ', value: egrul.status });
  if (company.city) rows.push({ key: 'city', label: 'Город', value: company.city });
  if (kind || company.legalForm) rows.push({ key: 'kind', label: 'Вид', value: [kind, company.legalForm].filter(Boolean).join(' · ') });
  if (company.website) rows.push({ key: 'site', label: 'Сайт', value: websiteLink(company.website) });
  if (egrul?.head) rows.push({ key: 'egrul-head', label: 'Руководитель', value: egrul.head, wide: true });
  if (egrul?.address) rows.push({ key: 'egrul-address', label: 'Юридический адрес', value: egrul.address, wide: true });
  if (data.registry?.address) rows.push({ key: 'address', label: 'Адрес в реестре', value: data.registry.address, wide: true });
  const checkedAt = focus?.check?.checkedAt ?? focus?.fetchedAt ?? null;

  return (
    <>
      <dl className={styles.requisites} aria-label="Реквизиты">
        {rows.map(row => (
          <div key={row.key} className={row.wide ? `${styles.requisite} ${styles.requisiteWide}` : styles.requisite}>
            <dt className={styles.reqLabel}>{row.label}</dt>
            <dd className={styles.reqValue}>{row.value}</dd>
          </div>
        ))}
      </dl>
      {egrul && (
        <p className={styles.reqSource}>
          Статус, руководитель и юридический адрес — ЕГРЮЛ по данным Контур.Фокуса{checkedAt ? `, проверено ${formatDate(checkedAt)}` : ''}.
        </p>
      )}
    </>
  );
};
