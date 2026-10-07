// Найденные компании: таблица (компания · город · объектов · публикаций) или карточки на телефоне.
//
// Под названием — чем компания отличается от одноимённых: форма, вид, ИНН, группа и число застройщиков
// в ней. Четыре «СЗ ДОНСТРОЙ» из Самары, Иркутска и Ростова — разные юрлица, и без этой строки они
// выглядели одним и тем же, повторённым четыре раза. Город — из карточки, иначе из юридического адреса
// со страницы застройщика ДОМ.РФ. Похожие по написанию («Дострой» на «донстрой») — после совпавших.
// Если нашлось по другому написанию — сказано, по какому: иначе непонятно, почему строка здесь.
//
// Название — по ЕГРЮЛ, как заголовок карточки и строка каталога; числа объектов и публикаций — те же, что в каталоге и
// на вкладках карточки (сервер, companies/counters.ts, с семьёй). Имя из публикаций — пояснением, если отличается.

import { FC, Fragment } from 'react';
import { Link } from 'react-router-dom';

import type { ICompanySearchItem } from '../../api/types';
import { formatCount, pluralize } from '../../lib/format';
import { ENTITY_TYPE_LABELS } from '../../lib/labels';
import { CardList } from '../ui/CardList';
import { CardListItem } from '../ui/CardListItem';
import { TableScroll } from '../ui/TableScroll';
import { CountPair } from './CountPair';
import styles from './Search.module.css';

interface ICompanyResultsProps {
  items: ICompanySearchItem[];
  wide: boolean;
}

/** «Самарская область, г Самара, ул …» → «Самара»; без «г» — первая часть адреса. */
export const placeFromAddress = (address: string | null | undefined): string | null => {
  if (!address) return null;
  const city = /(?:^|,\s*)(?:город|г\.?)\s+([^,]+)/iu.exec(address);
  if (city?.[1]) return city[1].trim();
  const first = address.split(',').map(part => part.trim()).find(part => part !== '' && !/^\d+$/.test(part));
  return first ?? null;
};

const placeOf = (item: ICompanySearchItem): string | null => item.city ?? placeFromAddress(item.registryAddress);

/** Название — по ЕГРЮЛ (как заголовок карточки), иначе имя из публикаций. */
const titleOf = (item: ICompanySearchItem): string => item.egrulName ?? item.name;

/** Строка под названием: что отличает компанию от одноимённых. Только известное — пустых «—» нет. */
export const companyFacts = (item: ICompanySearchItem): string | null => {
  const inn = item.identifiers?.find(id => id.startsWith('inn '))?.slice(4) ?? null;
  const kind = item.entityType && item.entityType !== 'legal_entity' && item.entityType !== 'unknown' ? ENTITY_TYPE_LABELS[item.entityType] : null;
  const group = item.memberOf ? `входит в группу «${item.memberOf}»` : item.registryGroup ? `группа «${item.registryGroup}»` : null;
  const members = item.members && item.members > 0
    ? `${formatCount(item.members)} ${pluralize(item.members, ['застройщик', 'застройщика', 'застройщиков'])} в группе`
    : null;
  const alias = item.matchedAlias && item.matchedAlias !== item.name ? `найдено по «${item.matchedAlias}»` : null;
  const textName = item.egrulName && item.egrulName !== item.name ? `в публикациях — «${item.name}»` : null;
  const facts = [item.legalForm, kind, inn ? `ИНН ${inn}` : null, group, members, textName, alias].filter(Boolean);
  return facts.length > 0 ? facts.join(' · ') : null;
};

export const CompanyResults: FC<ICompanyResultsProps> = ({ items, wide }) => {
  // Совпавшие по началу названия — первыми; похожие по написанию — отдельно, с подписью.
  const similarFrom = items.some(item => item.exact) ? items.findIndex(item => !item.exact) : -1;

  if (!wide) {
    return (
      <CardList label="Найденные компании">
        {items.map(item => (
          <CardListItem
            key={item.id}
            to={`/company/${item.id}`}
            title={titleOf(item)}
            meta={[placeOf(item), companyFacts(item)].filter(Boolean).join(' · ') || undefined}
            aside={<CountPair projects={item.projects ?? null} publications={item.publications ?? null} />}
          />
        ))}
      </CardList>
    );
  }

  return (
    <TableScroll label="Найденные компании" minWidth={560}>
      <thead>
        <tr>
          <th>Компания</th>
          <th className={styles.colCity}>Город</th>
          <th className="num">Объектов</th>
          <th className="num">Публикаций</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item, index) => {
          const facts = companyFacts(item);
          return (
            <Fragment key={item.id}>
              {index === similarFrom && (
                <tr className={styles.groupRow}>
                  <th colSpan={4} scope="colgroup">
                    Похожие по написанию
                  </th>
                </tr>
              )}
              <tr className={`row-link ${styles.row}`}>
                <td>
                  <Link className={`row-link-target ${styles.rowName}`} to={`/company/${item.id}`} viewTransition>
                    {titleOf(item)}
                  </Link>
                  {facts && <span className={styles.rowNote}>{facts}</span>}
                </td>
                <td className={styles.muted}>{placeOf(item) ?? '—'}</td>
                <td className="num">{formatCount(item.projects)}</td>
                <td className="num">{formatCount(item.publications)}</td>
              </tr>
            </Fragment>
          );
        })}
      </tbody>
    </TableScroll>
  );
};
