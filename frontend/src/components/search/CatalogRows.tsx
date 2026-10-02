// Строки каталога (ADR-016): юрлица и группы — с реквизитом и статусом ЕГРЮЛ, имена без ИНН — с числом
// публикаций и датой последней (сначала те, о ком больше пишут). С 600px — таблица, на телефоне —
// список-карточки. Строка кликается целиком настоящей ссылкой (.row-link / .row-link-target).
//
// Название юрлица — по ЕГРЮЛ, если Контур.Фокус его прислал: каталог от компании, а не от того, как её
// назвали в посте. Статус — словами, без цвета (ADR-009).

import { FC, ReactNode } from 'react';
import { Link } from 'react-router-dom';

import type { CatalogView, ICatalogRow } from '../../api/types';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { formatCount } from '../../lib/format';
import { ASSERTION_ROLE_LABELS, formatDate } from '../../lib/labels';
import { MQ } from '../../lib/media';
import { Card } from '../ui/Card';
import { CardList } from '../ui/CardList';
import { CardListItem } from '../ui/CardListItem';
import { TableScroll } from '../ui/TableScroll';
import { CountPair } from './CountPair';
import styles from './Search.module.css';

const rolesText = (roles: string[]): string => roles.map(r => ASSERTION_ROLE_LABELS[r] ?? r).join(', ');

/** Название строки: по ЕГРЮЛ, если есть; у заведённой по ИНН без ответа Фокуса — временное «ИНН …». */
export const catalogTitle = (row: ICatalogRow): string => row.egrulName ?? row.name;

const identifierText = (row: ICatalogRow): string | null => (row.inn ? `ИНН ${row.inn}` : row.ogrn ? `ОГРН ${row.ogrn}` : null);

/** Пояснение под названием: под каким именем компания в публикациях, на контроле ли, ждёт ли наименования. */
const nameNote = (row: ICatalogRow): string | null => {
  const notes = [
    row.egrulName && row.egrulName !== row.name && !row.namePending ? `в публикациях — «${row.name}»` : null,
    row.namePending && !row.egrulName ? 'наименование из ЕГРЮЛ ещё не получено' : null,
    row.watched ? 'на контроле' : null,
    row.hints > 0 ? `кандидатов: ${formatCount(row.hints)}` : null,
  ].filter(Boolean);
  return notes.length > 0 ? notes.join(' · ') : null;
};

const dash = <span className={styles.muted}>—</span>;

interface ICatalogRowsProps {
  view: CatalogView;
  rows: ICatalogRow[];
}

export const CatalogRows: FC<ICatalogRowsProps> = ({ view, rows }) => {
  const wide = useMediaQuery(MQ.sm);
  const unidentified = view === 'unidentified';
  const groups = view === 'groups';

  if (!wide) {
    return (
      <CardList label="Компании">
        {rows.map(row => (
          <CardListItem
            key={row.companyId}
            to={`/company/${row.companyId}`}
            title={catalogTitle(row)}
            meta={
              [
                unidentified ? null : identifierText(row),
                unidentified ? null : row.egrulStatus,
                rolesText(row.roles),
                row.watched ? 'на контроле' : null,
                row.hints > 0 ? `кандидатов: ${formatCount(row.hints)}` : null,
              ]
                .filter(Boolean)
                .join(' · ') || undefined
            }
            aside={<CountPair projects={row.objects} publications={row.publications} />}
          />
        ))}
      </CardList>
    );
  }

  const name = (row: ICatalogRow): ReactNode => {
    const note = nameNote(row);
    return (
      <td>
        <Link className={`row-link-target ${styles.rowName}`} to={`/company/${row.companyId}`} viewTransition>
          {catalogTitle(row)}
        </Link>
        {note && <span className={styles.rowNote}>{note}</span>}
      </td>
    );
  };

  return (
    <Card padding="none" className={styles.tableCard}>
      <TableScroll label="Компании" minWidth={unidentified || groups ? 560 : 720}>
        <thead>
          <tr>
            <th>{unidentified ? 'Название в публикациях' : groups ? 'Группа' : 'Компания'}</th>
            {!unidentified && !groups && <th className={styles.colId}>ИНН / ОГРН</th>}
            {!unidentified && !groups && <th className={styles.colStatus}>Статус в ЕГРЮЛ</th>}
            <th className={styles.colRole}>Роль</th>
            <th className="num">Объектов</th>
            <th className="num">Публикаций</th>
            {unidentified && <th className={styles.colDate}>Последняя</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.companyId} className={`row-link ${styles.row}`}>
              {name(row)}
              {!unidentified && !groups && <td className={styles.muted}>{identifierText(row) ?? '—'}</td>}
              {!unidentified && !groups && <td>{row.egrulStatus ?? dash}</td>}
              <td>{row.roles.length === 0 ? dash : rolesText(row.roles)}</td>
              <td className="num">{formatCount(row.objects)}</td>
              <td className="num">{formatCount(row.publications)}</td>
              {unidentified && <td className={styles.muted}>{row.lastPublishedAt ? formatDate(row.lastPublishedAt) : '—'}</td>}
            </tr>
          ))}
        </tbody>
      </TableScroll>
    </Card>
  );
};
