import { FC } from 'react';

import type { IProjectDossier } from '../../api/types';
import { CONTEXT_STATE_LABELS } from '../../lib/labels';
import { formatPreciseDate } from '../../lib/period';
import styles from '../ProjectPage.module.css';

/** Смена состояний объекта по датам событий — от ранних к поздним. */
export const ProjectStateHistory: FC<{ history: IProjectDossier['state']['history'] }> = ({ history }) => (
  <ol className={styles.history}>
    {history.map(h => (
      <li key={h.assertionId}>
        <span className="nowrap">{formatPreciseDate(h.validFrom, h.periodPrecision)}</span> —{' '}
        {h.building ? `${h.building}: ` : ''}
        {CONTEXT_STATE_LABELS[h.state] ?? 'состояние не названо'}
      </li>
    ))}
  </ol>
);
