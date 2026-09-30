// Найденные компании: таблица (компания · город · объектов) или карточки на телефоне.
// Если нашлось по другому написанию — сказано, по какому: иначе непонятно, почему строка здесь.

import { FC } from 'react';
import { Link } from 'react-router-dom';

import type { ICompanySearchItem } from '../../api/types';
import { formatCount } from '../../lib/format';
import { CardList } from '../ui/CardList';
import { CardListItem } from '../ui/CardListItem';
import { TableScroll } from '../ui/TableScroll';
import { CountPair } from './CountPair';
import styles from './Search.module.css';

interface ICompanyResultsProps {
  items: ICompanySearchItem[];
  wide: boolean;
}

const aliasNote = (item: ICompanySearchItem): string | null =>
  item.matchedAlias && item.matchedAlias !== item.name ? `найдено по «${item.matchedAlias}»` : null;

export const CompanyResults: FC<ICompanyResultsProps> = ({ items, wide }) => {
  if (!wide) {
    return (
      <CardList label="Найденные компании">
        {items.map(item => (
          <CardListItem
            key={item.id}
            to={`/company/${item.id}`}
            title={item.name}
            meta={[item.city, aliasNote(item)].filter(Boolean).join(' · ') || undefined}
            aside={<CountPair projects={item.projects ?? null} />}
          />
        ))}
      </CardList>
    );
  }

  return (
    <TableScroll label="Найденные компании" minWidth={480}>
      <thead>
        <tr>
          <th>Компания</th>
          <th className={styles.colCity}>Город</th>
          <th className="num">Объектов</th>
        </tr>
      </thead>
      <tbody>
        {items.map(item => {
          const note = aliasNote(item);
          return (
            <tr key={item.id} className={`row-link ${styles.row}`}>
              <td>
                <Link className={`row-link-target ${styles.rowName}`} to={`/company/${item.id}`} viewTransition>
                  {item.name}
                </Link>
                {note && <span className={styles.rowNote}>{note}</span>}
              </td>
              <td className={styles.muted}>{item.city ?? '—'}</td>
              <td className="num">{formatCount(item.projects)}</td>
            </tr>
          );
        })}
      </tbody>
    </TableScroll>
  );
};
