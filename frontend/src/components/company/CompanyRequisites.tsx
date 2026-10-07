// Реквизиты под именем компании — плотной шапкой (05.10.2026, просьба владельца «много воздуха»), три
// строки вместо сетки в пять:
//  1. ярлыки: статус в ЕГРЮЛ и роли компании на её объектах — то, что ищут глазом первым;
//  2. короткие реквизиты в строку, подпись над значением: ИНН и ОГРН копируются нажатием, дальше
//     имя из публикаций, вид лица;
//  3. длинные — руководитель и юридический адрес, с 900px рядом.
// Под ними — одна строка, откуда статус, руководитель и адрес и на какую дату (ADR-015). Сведений Фокуса
// нет — этих строк нет, а не «не указано». Адрес из реестра — только когда адреса ЕГРЮЛ нет: обычно это
// тот же юридический адрес, дважды подряд он только занимал место.
//
// Один источник на сведение (07.10.2026): реквизиты — только реестр entity_identifiers (устаревшей проекции
// companies.tax_id здесь нет); форма собственности — из ЕГРЮЛ, а из текста — только пока ЕГРЮЛ её не назвал;
// город из публикаций — только когда адреса нет ни в ЕГРЮЛ, ни в реестре; сайт — блоком «Сайт компании»
// (подтверждённый оператором), колонку companies.website никто не пишет.
//
// compact — на читалке («Публикации»): ярлыки и короткие реквизиты; каждая строка шапки отнята у поста.

import { FC, ReactNode } from 'react';

import type { ICompanyResponse, IFocusView } from '../../api/types';
import { ENTITY_TYPE_LABELS, IDENTIFIER_TYPE_LABELS, formatDate } from '../../lib/labels';
import { RoleBadges } from '../RoleBadges';
import { Badge } from '../ui/Badge';
import { CopyValue } from '../ui/CopyValue';
import styles from './Company.module.css';

/** Реквизиты юрлица: их контрольная сумма проверяется (КПП и прочее — нет). */
const LEGAL_TYPES = new Set(['inn', 'ogrn', 'ogrnip']);

/** Форма собственности по ЕГРЮЛ — строка «Организационно-правовая форма» ответа Фокуса; раздел ЕГРЮЛ её не повторяет. */
export const focusOpf = (focus: IFocusView | null | undefined): string | null => focus?.fields.find(f => f.key === 'opf')?.value ?? null;

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
  /** Роли компании на своих объектах (сервер, по всему списку «Объектов») — ярлыками рядом со статусом. */
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
            // Реквизит с несошедшейся контрольной суммой не выдаём за проверенный: ЕГРЮЛ по нему не спрашивается.
            const checked = i.validationStatus === 'checksum_valid' || !LEGAL_TYPES.has(i.type);
            return { key: `${i.type}:${i.value}`, label: checked ? label : `${label} (не сходится контрольная сумма)`, value: <CopyValue label={label} value={i.value} /> };
          })
      : [{ key: 'tax', label: 'Реквизиты', value: 'не установлены' }];

  const egrul = focus?.summary ?? null;
  // Заголовок — наименование ЕГРЮЛ (ADR-016); под каким именем компания в публикациях — здесь.
  const egrulName = data.egrul?.name ?? null;
  if (egrulName && egrulName !== company.name && !company.namePending) short.push({ key: 'text-name', label: 'В публикациях', value: company.name });
  const kind = company.entityType && company.entityType !== 'unknown' ? ENTITY_TYPE_LABELS[company.entityType] : null;
  const form = focusOpf(focus) ?? company.legalForm;
  if (kind || form) short.push({ key: 'kind', label: 'Вид', value: [kind, form].filter(Boolean).join(' · ') });
  if (company.city && !egrul?.address && !data.registry?.address) short.push({ key: 'city', label: 'Город в публикациях', value: company.city });

  const wide: IRequisite[] = [];
  if (egrul?.head) wide.push({ key: 'egrul-head', label: 'Руководитель', value: egrul.head });
  if (egrul?.address) wide.push({ key: 'egrul-address', label: 'Юридический адрес', value: egrul.address });
  else if (data.registry?.address) wide.push({ key: 'address', label: 'Адрес в реестре', value: data.registry.address });
  const checkedAt = focus?.check?.checkedAt ?? focus?.fetchedAt ?? null;

  return (
    <div className={styles.reqBlock} role="group" aria-label="Реквизиты">
      {(egrul?.status || roles.length > 0) && (
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
          <RoleBadges roles={roles} max={ROLE_BADGES} item="li" />
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
