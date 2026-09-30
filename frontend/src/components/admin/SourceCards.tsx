// Источники карточками — на телефоне и планшете (< 900px). Те же части, что в таблице, в три
// строки: название и переключатель · состояние · срок и действия. Подписей над контролами нет:
// что это за контрол, говорят его место и доступное имя. На телефоне из действий в строке —
// одно «Подробнее» (окно несёт все): пять кнопок переносились бы на вторую строку.

import { FC } from 'react';

import { useMediaQuery } from '../../hooks/useMediaQuery';
import { MQ } from '../../lib/media';
import { CardList } from '../ui/CardList';
import { SourceDepth, SourceToggle } from './SourceCollectControls';
import { SourceName } from './SourceName';
import { SourceRowActions } from './SourceRowActions';
import { SourceStatus } from './SourceStatus';
import type { ISourcesListProps } from './SourcesTable';
import styles from './Sources.module.css';

export const SourceCards: FC<ISourcesListProps> = ({ sources, actions, label }) => {
  const roomy = useMediaQuery(MQ.sm);
  return (
    <CardList label={label}>
      {sources.map(s => (
        <li key={s.id} className={styles.card}>
          <div className={styles.cardName}>
            <SourceName source={s} />
          </div>
          <div className={styles.cardToggle}>
            <SourceToggle source={s} actions={actions} />
          </div>
          <div className={styles.cardStatus}>
            <SourceStatus source={s} />
          </div>
          <div className={styles.cardControls}>
            <SourceDepth source={s} actions={actions} />
            <SourceRowActions source={s} actions={actions} place={roomy ? 'row' : 'compact'} />
          </div>
        </li>
      ))}
    </CardList>
  );
};
