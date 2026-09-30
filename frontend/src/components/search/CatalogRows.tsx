// Строки каталога: таблица из пяти колонок с 600px, список-карточки на телефоне. Строка
// кликается целиком настоящей ссылкой (.row-link / .row-link-target), а не onClick на <tr>.
// Под названием в таблице ничего нет — город своей колонкой, остальные числа — в карточке.

import { FC } from 'react';
import { Link } from 'react-router-dom';

import type { IContractorRow } from '../../api/types';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { formatCount } from '../../lib/format';
import { ASSERTION_ROLE_LABELS } from '../../lib/labels';
import { MQ } from '../../lib/media';
import { Card } from '../ui/Card';
import { CardList } from '../ui/CardList';
import { CardListItem } from '../ui/CardListItem';
import { TableScroll } from '../ui/TableScroll';
import { CountPair } from './CountPair';
import styles from './Search.module.css';

const rolesText = (roles: string[]): string => roles.map(r => ASSERTION_ROLE_LABELS[r] ?? r).join(', ');

export const CatalogRows: FC<{ rows: IContractorRow[] }> = ({ rows }) => {
  const wide = useMediaQuery(MQ.sm);

  if (!wide) {
    return (
      <CardList label="Компании">
        {rows.map(row => (
          <CardListItem
            key={row.companyId}
            to={`/company/${row.companyId}`}
            title={row.name}
            meta={[row.city, rolesText(row.roles)].filter(Boolean).join(' · ') || undefined}
            aside={<CountPair projects={row.projects} publications={row.publications} />}
          />
        ))}
      </CardList>
    );
  }

  return (
    <Card padding="none" className={styles.tableCard}>
      <TableScroll label="Компании" minWidth={560}>
        <thead>
          <tr>
            <th>Компания</th>
            <th className={styles.colCity}>Город</th>
            <th className={styles.colRole}>Роль</th>
            <th className="num">Объектов</th>
            <th className="num">Публикаций</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.companyId} className={`row-link ${styles.row}`}>
              <td>
                <Link className={`row-link-target ${styles.rowName}`} to={`/company/${row.companyId}`} viewTransition>
                  {row.name}
                </Link>
              </td>
              <td className={styles.muted}>{row.city ?? '—'}</td>
              <td>{row.roles.length === 0 ? <span className={styles.muted}>—</span> : rolesText(row.roles)}</td>
              <td className="num">{formatCount(row.projects)}</td>
              <td className="num">{formatCount(row.publications)}</td>
            </tr>
          ))}
        </tbody>
      </TableScroll>
    </Card>
  );
};
