// Источники одного вида плотной таблицей — на экране от 900px: строка обычного источника ≈ 48px,
// на первом экране 1280×800 — около девяти строк. Уже 900px те же части идут карточками (SourceCards).
//
// Колонки: название (остаток ширины, многоточие) · сбор · срок · состояние · действия; у ручных
// способов срока нет. Уже 1280px в колонке действий — одно «Подробнее» (остальное — в его окне):
// пять кнопок не оставляли места названию, и таблица уходила в прокрутку вбок.

import { FC } from 'react';

import type { ISourceRow } from '../../api/types';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { MQ } from '../../lib/media';
import { TableScroll } from '../ui/TableScroll';
import { VisuallyHidden } from '../ui/VisuallyHidden';
import { SourceDepth, SourceToggle } from './SourceCollectControls';
import { SourceName } from './SourceName';
import { SourceRowActions } from './SourceRowActions';
import { SourceStatus } from './SourceStatus';
import type { ISourceActions } from './useSourceActions';
import styles from './Sources.module.css';

const NAME_HEADER: Record<ISourceRow['kind'], string> = {
  telegram: 'Канал',
  website: 'Сайт',
  manual: 'Способ',
};

export interface ISourcesListProps {
  kind: ISourceRow['kind'];
  sources: ISourceRow[];
  actions: ISourceActions;
  /** Имя списка для диктора: «Telegram-каналы». */
  label: string;
}

export const SourcesTable: FC<ISourcesListProps> = ({ kind, sources, actions, label }) => {
  const manual = kind === 'manual';
  const roomy = useMediaQuery(MQ.lg);
  return (
    // minWidth 0: минимумы задают сами колонки (название от 11rem); уже них — прокрутка внутри.
    <TableScroll label={label} minWidth={0} className={styles.table}>
      <thead>
        <tr>
          <th className={styles.nameCol}>{NAME_HEADER[kind]}</th>
          <th className={styles.fitCol}>{manual ? 'Приём' : 'Сбор'}</th>
          {!manual && <th className={styles.fitCol}>Срок</th>}
          <th className={styles.fitCol}>Состояние</th>
          <th className={styles.fitCol}>
            <VisuallyHidden>Действия</VisuallyHidden>
          </th>
        </tr>
      </thead>
      <tbody>
        {sources.map(s => (
          <tr key={s.id}>
            <td className={styles.nameCol}>
              <SourceName source={s} />
            </td>
            <td className={styles.fitCol}>
              <SourceToggle source={s} actions={actions} />
            </td>
            {!manual && (
              <td className={styles.fitCol}>
                <SourceDepth source={s} actions={actions} />
              </td>
            )}
            <td className={styles.fitCol}>
              <SourceStatus source={s} />
            </td>
            <td className={styles.fitCol}>
              <SourceRowActions source={s} actions={actions} place={roomy ? 'row' : 'compact'} />
            </td>
          </tr>
        ))}
      </tbody>
    </TableScroll>
  );
};
