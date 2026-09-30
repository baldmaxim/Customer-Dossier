// Источники одного вида таблицей — на широком экране. Уже 900px таблица с переключателем,
// сроком сбора и состоянием не помещается: там те же строки карточками (SourceCards).

import { FC } from 'react';

import type { ISourceRow } from '../../api/types';
import { TableScroll } from '../ui/TableScroll';
import { VisuallyHidden } from '../ui/VisuallyHidden';
import { SourceCollectControls } from './SourceCollectControls';
import { SourceName } from './SourceName';
import { SourceRowActions } from './SourceRowActions';
import { SourceStatus } from './SourceStatus';
import { isSourceEnabled, type ISourceActions } from './useSourceActions';
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

export const SourcesTable: FC<ISourcesListProps> = ({ kind, sources, actions, label }) => (
  <TableScroll label={label} minWidth={820}>
    <thead>
      <tr>
        <th>{NAME_HEADER[kind]}</th>
        <th>{kind === 'manual' ? 'Включено' : 'Сбор'}</th>
        <th>Состояние</th>
        <th className={styles.actionsCol}>
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
          <td>
            <SourceCollectControls source={s} actions={actions} />
          </td>
          <td className={styles.statusCol}>
            <SourceStatus source={s} enabled={isSourceEnabled(s)} />
          </td>
          <td>
            <SourceRowActions source={s} actions={actions} />
          </td>
        </tr>
      ))}
    </tbody>
  </TableScroll>
);
