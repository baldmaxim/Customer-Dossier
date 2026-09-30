// Строка-описание сведения: что сказано, статус словами, модальность, период, «со слов».
// Без «версии N» и «уверенности модели»: это внутренняя кухня, а не ответ «откуда известно».

import { FC } from 'react';

import type { IAssertion } from '../../api/types';
import { describeAssertion } from '../../lib/describeAssertion';
import {
  AMOUNT_PURPOSE_LABELS,
  ASSERTION_STATUS_LABELS,
  EVENT_OUTCOME_LABELS,
  EVENT_STAGE_LABELS,
  MODALITY_LABELS,
  POLARITY_LABELS,
  formatMoney,
} from '../../lib/labels';
import { formatPeriod } from '../../lib/period';
import { ASSERTION_STATUS_TONE, toneOf } from '../../lib/statusTone';
import { Badge } from '../ui/Badge';
import { Heading } from '../ui/Heading';
import styles from '../AssertionDetail.module.css';

/** Стадия, исход, сумма и НДС — что сообщил источник, без пересчёта (ADR-008). */
const factsOf = (a: IAssertion): string[] =>
  [
    a.eventStage ? `стадия: ${EVENT_STAGE_LABELS[a.eventStage] ?? 'не названа'}` : null,
    a.eventOutcome ? `результат по источнику: ${EVENT_OUTCOME_LABELS[a.eventOutcome] ?? 'не назван'}` : null,
    a.valueNumeric ? `${AMOUNT_PURPOSE_LABELS[a.valueType ?? 'amount'] ?? 'сумма'}: ${formatMoney(a.valueNumeric, a.valueCurrency)}` : null,
    a.taxBasis ? (a.taxBasis === 'with_vat' ? 'с НДС' : 'без НДС') : null,
  ].filter((f): f is string => f !== null);

export const AssertionSummary: FC<{ assertion: IAssertion }> = ({ assertion: a }) => {
  const period = formatPeriod(a.validFrom, a.validTo, a.periodPrecision);
  const facts = factsOf(a);
  return (
    <div className={styles.summary}>
      <Heading className={styles.title}>{describeAssertion(a)}</Heading>
      <div className={styles.meta}>
        <Badge tone={toneOf(ASSERTION_STATUS_TONE, a.status)}>{ASSERTION_STATUS_LABELS[a.status]}</Badge>
        {a.modality !== 'reported_fact' && <span>{MODALITY_LABELS[a.modality] ?? MODALITY_LABELS.unknown}</span>}
        {a.polarity === 'negative' && <span>{POLARITY_LABELS.negative}</span>}
        {period && <span className="nowrap">{period}</span>}
        {a.attributedTo && <span>со слов: {a.attributedTo}</span>}
      </div>
      {facts.length > 0 && <p className={styles.facts}>{facts.join(' · ')}</p>}
    </div>
  );
};
