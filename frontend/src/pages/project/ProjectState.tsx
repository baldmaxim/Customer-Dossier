// Состояние объекта — одной строкой, по дате события (а не по последней записанной статье);
// история смены состояний — отдельно, под раскрытием.

import { FC } from 'react';

import type { IProjectDossier } from '../../api/types';
import { Card } from '../../components/ui/Card';
import { CONTEXT_STATE_LABELS } from '../../lib/labels';
import { formatPreciseDate } from '../../lib/period';
import styles from '../ProjectPage.module.css';

type State = IProjectDossier['state']['current'][number];

const stateText = (s: State): string =>
  `${s.building ? `${s.building}: ` : ''}${CONTEXT_STATE_LABELS[s.state] ?? 'состояние не названо'} с ${formatPreciseDate(s.validFrom, s.periodPrecision)}`;

export const ProjectStateLine: FC<{ state: IProjectDossier['state'] }> = ({ state }) => (
  <Card padding="sm" className={styles.stateCard}>
    <span className={styles.stateLabel}>Состояние (по дате события)</span>
    {state.current.length === 0 ? (
      <span className={styles.muted}>в публикациях не установлено</span>
    ) : (
      <span className={styles.stateItems}>
        {state.current.map(s => (
          <span key={`${s.building ?? ''}|${s.validFrom}|${s.state}`} className={styles.stateItem}>
            {stateText(s)}
          </span>
        ))}
      </span>
    )}
  </Card>
);
