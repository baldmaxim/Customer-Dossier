// Реквизиты под именем компании — плотной шапкой (05.10.2026, просьба владельца «много воздуха»), три
// строки вместо сетки в пять:
//  1. ярлыки: статус в ЕГРЮЛ и роли компании на её объектах — то, что ищут глазом первым;
//  2. короткие реквизиты в строку, подпись над значением: ИНН и ОГРН копируются нажатием, дальше
//     имя из публикаций, город, вид лица, сайт;
//  3. длинные — руководитель и юридический адрес, с 900px рядом.
// Под ними — одна строка, откуда статус, руководитель и адрес и на какую дату (ADR-015). Сведений Фокуса
// нет — этих строк нет, а не «не указано». Адрес из реестра — только когда адреса ЕГРЮЛ нет: обычно это
// тот же юридический адрес, дважды подряд он только занимал место.
//
// compact — на читалке («Публикации»): ярлыки и короткие реквизиты; каждая строка шапки отнята у поста.

import { FC, ReactNode } from 'react';

import type { ICompanyObject, ICompanyResponse, IFocusView } from '../../api/types';
import { ASSERTION_ROLE_LABELS, ENTITY_TYPE_LABELS, IDENTIFIER_TYPE_LABELS, formatDate } from '../../lib/labels';
import { Badge } from '../ui/Badge';
import { CopyValue } from '../ui/CopyValue';
import styles from './Company.module.css';

/** ИНН и ОГРН — первыми: по ним компанию опознают; КПП и прочее — после. */
const IDENTIFIER_ORDER: Record<string, number> = { inn: 0, ogrn: 1, ogrnip: 2, bin: 3, kpp: 4 };
/** Ярлыков ролей — не больше: остальные одной пилюлей «+N», их названия — диктору. */
const ROLE_BADGES = 4;

interface IRequisite {
  key: string;
  label: string;
  value: ReactNode;
}

export interface IObjectRoleCount {
  role: string;
  count: number;
}

/** Сколько своих объектов у компании в каждой роли; объекты СЗ группы — их роль, не её. */
export const objectRoleCounts = (objects: ICompanyObject[]): IObjectRoleCount[] => {
  const counts = new Map<string, number>();
  for (const o of objects) {
    if (o.via) continue;
    for (const role of new Set(o.roles.map(r => r.role))) counts.set(role, (counts.get(role) ?? 0) + 1);
  }
  return [...counts.entries()].map(([role, count]) => ({ role, count })).sort((a, b) => b.count - a.count || a.role.localeCompare(b.role));
};

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

const roleLabel = ({ role, count }: IObjectRoleCount): string => `${ASSERTION_ROLE_LABELS[role] ?? role} · ${count}`;

const Requisites: FC<{ rows: IRequisite[]; className?: string }> = ({ rows, className }) => (
  <dl className={className}>
    {rows.map(row => (
      <div key={row.key} className={styles.requisite}>
        <dt className={styles.reqLabel}>{row.label}</dt>
        <dd className={styles.reqValue}>{row.value}</dd>
      </div>
    ))}
  </dl>
);

export interface ICompanyRequisitesProps {
  data: ICompanyResponse;
  focus?: IFocusView | null;
  /** Роли компании на своих объектах — ярлыками рядом со статусом. */
  roles?: IObjectRoleCount[];
  /** Только ярлыки и короткие реквизиты (читалка). */
  compact?: boolean;
}

export const CompanyRequisites: FC<ICompanyRequisitesProps> = ({ data, focus = null, roles = [], compact = false }) => {
  const { company } = data;
  const identifiers = data.identifiers ?? [];
  const short: IRequisite[] =
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
  if (egrulName && egrulName !== company.name && !company.namePending) short.push({ key: 'text-name', label: 'В публикациях', value: company.name });
  const kind = company.entityType && company.entityType !== 'unknown' ? ENTITY_TYPE_LABELS[company.entityType] : null;
  if (company.city) short.push({ key: 'city', label: 'Город', value: company.city });
  if (kind || company.legalForm) short.push({ key: 'kind', label: 'Вид', value: [kind, company.legalForm].filter(Boolean).join(' · ') });
  if (company.website) short.push({ key: 'site', label: 'Сайт', value: websiteLink(company.website) });

  const egrul = focus?.summary ?? null;
  const wide: IRequisite[] = [];
  if (egrul?.head) wide.push({ key: 'egrul-head', label: 'Руководитель', value: egrul.head });
  if (egrul?.address) wide.push({ key: 'egrul-address', label: 'Юридический адрес', value: egrul.address });
  else if (data.registry?.address) wide.push({ key: 'address', label: 'Адрес в реестре', value: data.registry.address });
  const checkedAt = focus?.check?.checkedAt ?? focus?.fetchedAt ?? null;
  const shownRoles = roles.slice(0, ROLE_BADGES);
  const restRoles = roles.slice(ROLE_BADGES);

  return (
    <div className={styles.reqBlock} role="group" aria-label="Реквизиты">
      {(egrul?.status || shownRoles.length > 0) && (
        // Ярлыки без подсказок-кнопок: в шапке кнопки — только копирование реквизитов. Что за роли — сказано
        // подписью списка (роль на своих объектах, по публикациям и реестру; объекты СЗ группы не входят).
        <ul className={styles.reqBadges} aria-label="Статус и роли на своих объектах">
          {egrul?.status && (
            <li>
              {/* Нейтральный тон при любом статусе: ликвидация — факт реестра, а не вердикт (ADR-009). */}
              <Badge>
                <span className="visually-hidden">Статус в ЕГРЮЛ</span> {egrul.status}
              </Badge>
            </li>
          )}
          {shownRoles.map(r => (
            <li key={r.role}>
              <Badge tone="accent">{roleLabel(r)}</Badge>
            </li>
          ))}
          {restRoles.length > 0 && (
            <li>
              <Badge tone="accent">
                <span aria-hidden="true">+{restRoles.length}</span>
                <span className="visually-hidden">ещё: {restRoles.map(roleLabel).join(', ')}</span>
              </Badge>
            </li>
          )}
        </ul>
      )}
      <Requisites rows={short} className={styles.requisites} />
      {!compact && wide.length > 0 && <Requisites rows={wide} className={styles.requisitesWide} />}
      {!compact && egrul && (
        <p className={styles.reqSource}>
          ЕГРЮЛ по данным Контур.Фокуса{checkedAt ? `, проверено ${formatDate(checkedAt)}` : ''}: статус, руководитель и адрес.
        </p>
      )}
    </div>
  );
};
