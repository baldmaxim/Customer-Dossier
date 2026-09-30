// Число показателя с правилом, окном, знаменателем и основанием — ничего не прячется за
// цифрой. Основание — числом («12 публикаций»), а не списком внутренних номеров: номера
// нужны оператору в админке, читателю они ничего не говорят.

import { FC } from 'react';

import type { ISignalAggregate } from '../api/types';
import { formatCount, formatCountWord, type PluralForms } from '../lib/format';
import { formatDate, formatPercent } from '../lib/labels';
import styles from './CompanySignals.module.css';

/** На чём стоит число: чего столько-то. */
export type SignalBasis = 'publications' | 'projects' | 'assertions' | 'companies' | 'families';

const BASIS_FORMS: Record<SignalBasis, PluralForms> = {
  publications: ['публикация', 'публикации', 'публикаций'],
  projects: ['объект', 'объекта', 'объектов'],
  assertions: ['сведение', 'сведения', 'сведений'],
  companies: ['компания', 'компании', 'компаний'],
  families: ['текст', 'текста', 'текстов'],
};

interface ISignalAggregateProps {
  label: string;
  aggregate: ISignalAggregate;
  /** Доля (0…1) вместо количества. */
  asShare?: boolean;
  basis: SignalBasis;
}

export const SignalAggregate: FC<ISignalAggregateProps> = ({ label, aggregate, asShare = false, basis }) => {
  const insufficient = aggregate.status === 'insufficient_data';
  const value = insufficient ? 'недостаточно данных' : asShare ? formatPercent(aggregate.value) : formatCount(aggregate.value);
  const count = aggregate.ids.length;
  return (
    <details className={styles.aggregate}>
      <summary className={styles.aggregateSummary}>
        <span className={`${styles.aggregateValue} ${insufficient ? styles.insufficient : ''}`}>{value}</span>
        <span className={styles.aggregateLabel}>
          {label}
          {aggregate.denominator !== null && !insufficient && ` · из ${formatCount(aggregate.denominator)}`}
        </span>
      </summary>
      <div className={styles.aggregateBody}>
        <p>Как считается: {aggregate.rule}.</p>
        {aggregate.window && (
          <p>
            {aggregate.window.basis === 'event_date' ? 'По дате события' : 'По дате публикации'}: с{' '}
            {formatDate(aggregate.window.from)} по {formatDate(aggregate.window.to)}.
          </p>
        )}
        <p>
          Основание: {count === 0 ? 'нет' : formatCountWord(count, BASIS_FORMS[basis])}
          {aggregate.idsTruncated && ' и больше — список сокращён'}.
        </p>
      </div>
    </details>
  );
};
