// Дата из собранных публикаций: первая и последняя публикация. Дата неизвестна — так и
// сказано: «дата неизвестна» не значит «давно» и не значит «сведений нет».

import { FC } from 'react';

import type { ISignalDate } from '../api/types';
import { formatDate } from '../lib/labels';
import styles from './CompanySignals.module.css';

export const SignalDate: FC<{ label: string; date: ISignalDate }> = ({ label, date }) => {
  const unknown = date.status === 'insufficient_data' || date.value === null;
  return (
    <details className={styles.aggregate}>
      <summary className={styles.aggregateSummary}>
        <span className={`${styles.aggregateValue} ${unknown ? styles.insufficient : ''}`}>
          {unknown ? 'дата неизвестна' : formatDate(date.value)}
        </span>
        <span className={styles.aggregateLabel}>{label}</span>
      </summary>
      <div className={styles.aggregateBody}>
        <p>Как считается: {date.rule}.</p>
      </div>
    </details>
  );
};
