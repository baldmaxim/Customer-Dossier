// Найденные объекты: таблица (объект · город · уровень) или карточки на телефоне. Корпус
// и очередь подписаны родителем — «корпус 12 · ЖК „Северная долина“», иначе одинаковые
// названия корпусов не различить.

import { FC } from 'react';
import { Link } from 'react-router-dom';

import type { IProjectSearchItem } from '../../api/types';
import { PROJECT_LEVEL_LABELS } from '../../lib/labels';
import { CardList } from '../ui/CardList';
import { CardListItem } from '../ui/CardListItem';
import { TableScroll } from '../ui/TableScroll';
import styles from './Search.module.css';

interface IProjectResultsProps {
  items: IProjectSearchItem[];
  wide: boolean;
}

const levelText = (item: IProjectSearchItem): string => {
  const level = PROJECT_LEVEL_LABELS[item.level] ?? item.level;
  return item.levelLabel ? `${level} ${item.levelLabel}` : level;
};

const parentNote = (item: IProjectSearchItem): string | null => (item.parentName ? `входит в ${item.parentName}` : null);

export const ProjectResults: FC<IProjectResultsProps> = ({ items, wide }) => {
  if (!wide) {
    return (
      <CardList label="Найденные объекты">
        {items.map(item => (
          <CardListItem
            key={item.id}
            to={`/projects/${item.id}`}
            title={item.name}
            meta={[item.city, levelText(item), parentNote(item)].filter(Boolean).join(' · ')}
          />
        ))}
      </CardList>
    );
  }

  return (
    <TableScroll label="Найденные объекты" minWidth={480}>
      <thead>
        <tr>
          <th>Объект</th>
          <th className={styles.colCity}>Город</th>
          <th className={styles.colLevel}>Уровень</th>
        </tr>
      </thead>
      <tbody>
        {items.map(item => {
          const note = parentNote(item);
          return (
            <tr key={item.id} className={`row-link ${styles.row}`}>
              <td>
                <Link className={`row-link-target ${styles.rowName}`} to={`/projects/${item.id}`} viewTransition>
                  {item.name}
                </Link>
                {note && <span className={styles.rowNote}>{note}</span>}
              </td>
              <td className={styles.muted}>{item.city ?? '—'}</td>
              <td>{levelText(item)}</td>
            </tr>
          );
        })}
      </tbody>
    </TableScroll>
  );
};
