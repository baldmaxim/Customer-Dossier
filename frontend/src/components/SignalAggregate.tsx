import { FC } from 'react';

import type { ISignalAggregate, ISignalDate } from '../api/types';
import { formatDate, formatPercent } from '../lib/labels';
import styles from './CompanySignals.module.css';

interface ISignalAggregateProps {
  label: string;
  aggregate: ISignalAggregate;
  /** Доля (0…1) вместо количества. */
  asShare?: boolean;
  /** Подпись исходных id: «утверждения», «публикации», «объекты». */
  idsLabel: string;
}

/** Число сигнала с правилом, окном, знаменателем и списком исходных id — ничего не прячется за цифрой. */
export const SignalAggregate: FC<ISignalAggregateProps> = ({ label, aggregate, asShare = false, idsLabel }) => {
  const insufficient = aggregate.status === 'insufficient_data';
  const value = insufficient ? 'недостаточно данных' : asShare ? formatPercent(aggregate.value) : String(aggregate.value ?? '—');
  return (
    <details className={styles.aggregate}>
      <summary className={styles.aggregateSummary}>
        <span className={`${styles.aggregateValue} ${insufficient ? styles.insufficient : ''}`}>{value}</span>
        <span className={styles.aggregateLabel}>
          {label}
          {aggregate.denominator !== null && !insufficient && ` · из ${aggregate.denominator}`}
        </span>
      </summary>
      <div className={styles.aggregateBody}>
        <p>Правило: {aggregate.rule}.</p>
        {aggregate.window && (
          <p>
            Окно {aggregate.window.basis === 'event_date' ? 'по дате события' : 'по дате публикации'}: {formatDate(aggregate.window.from)} —{' '}
            {formatDate(aggregate.window.to)}.
          </p>
        )}
        <p>
          {idsLabel}: {aggregate.ids.length === 0 ? 'нет' : aggregate.ids.map(id => `#${id}`).join(', ')}
          {aggregate.idsTruncated && ' … (список сокращён)'}
        </p>
      </div>
    </details>
  );
};

/**
 * Дата из выборки (signals@2): первая и последняя публикация. Дата неизвестна — так и
 * сказано: «дата неизвестна» не значит «давно» и не значит «сведений нет».
 */
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
        <p>Правило: {date.rule}.</p>
        <p>Публикация: {date.sourceItemId === null ? 'нет' : `#${date.sourceItemId}`}</p>
      </div>
    </details>
  );
};
