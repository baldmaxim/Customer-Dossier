// «Решение оператора» — свёрнуто на экранах чтения и раскрыто в очереди «Проверки». Только для
// тех, кому можно решать (review.decide): читатель видит цитаты, а не форму, которую сервер отклонит.

import { FC } from 'react';

import type { IAssertion, IReviewRow } from '../../api/types';
import { Callout } from '../ui/Callout';
import { Disclosure } from '../ui/Disclosure';
import { DecisionForm } from './DecisionForm';
import { DecisionHistory } from './DecisionHistory';
import styles from '../AssertionDetail.module.css';

interface IOperatorDecisionProps {
  assertion: IAssertion;
  reviews: IReviewRow[];
  open: boolean;
  onToggle: (open: boolean) => void;
}

export const OperatorDecision: FC<IOperatorDecisionProps> = ({ assertion, reviews, open, onToggle }) => (
  <Disclosure
    variant="card"
    summary="Решение оператора"
    meta={assertion.needsRevalidation ? 'нужна повторная проверка' : reviews.length > 0 ? `решений: ${reviews.length}` : undefined}
    open={open}
    onToggle={onToggle}
  >
    {/* Содержимое — только раскрытым: форма со своим состоянием не живёт в каждом свёрнутом сведении. */}
    {open && (
      <div className={styles.operator}>
        {assertion.needsRevalidation && <Callout tone="warning">Появились новые цитаты — проверьте сведение ещё раз.</Callout>}
        <DecisionForm assertion={assertion} />
        <DecisionHistory reviews={reviews} />
      </div>
    )}
  </Disclosure>
);
