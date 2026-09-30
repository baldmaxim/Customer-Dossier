import { FC } from 'react';

import type { IReviewRow } from '../../api/types';
import { ASSERTION_STATUS_LABELS, REVIEW_SCOPE_LABELS, formatDateTime } from '../../lib/labels';
import { ASSERTION_STATUS_TONE, toneOf } from '../../lib/statusTone';
import { Badge } from '../ui/Badge';
import { Heading } from '../ui/Heading';
import styles from '../AssertionDetail.module.css';

/** Решения по сведению — только добавляются (ADR-003): прежние видны, даже если сведение изменилось. */
export const DecisionHistory: FC<{ reviews: IReviewRow[] }> = ({ reviews }) => (
  <section className={styles.group}>
    <Heading className={styles.groupTitle}>
      История решений <span className="num">({reviews.length})</span>
    </Heading>
    {reviews.length === 0 ? (
      <p className={styles.muted}>Решений ещё не было.</p>
    ) : (
      <ul className={styles.history}>
        {reviews.map(r => (
          <li key={r.id} className={styles.historyItem}>
            <div className={styles.meta}>
              <Badge tone={toneOf(ASSERTION_STATUS_TONE, r.decision)}>{ASSERTION_STATUS_LABELS[r.decision]}</Badge>
              <span>{REVIEW_SCOPE_LABELS[r.scope] ?? ''}</span>
              <span>{r.reviewer}</span>
              <time dateTime={r.decidedAt} className="nowrap">
                {formatDateTime(r.decidedAt)}
              </time>
            </div>
            {r.provenanceGap && <p className={styles.warn}>Обоснование этого решения не сохранилось.</p>}
            {r.reason && <p className={styles.reason}>{r.reason}</p>}
          </li>
        ))}
      </ul>
    )}
  </section>
);
