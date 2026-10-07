// Состояние источника в строке: ярлык словами (+ пометка о сборе истории), одна строка сведений
// «24 817 публ. · 30.09, 11:58 · +3 новых» и — только при сбое — причина одной строкой.
// Всё остальное (проход, где остановился сбор, попытка и успех) — в «Подробнее», окном.

import { FC } from 'react';

import type { ISourceRow } from '../../api/types';
import type { StatusTone } from '../../lib/statusTone';
import { Badge } from '../ui/Badge';
import { historyNote, sourceStateView, sourceStatsLine, sourceStatsTitle } from './sourceFacts';
import styles from './Sources.module.css';

/** Причина видна в строке только у сбоя: «ещё не собирался» и «собрана не вся история» ярлык говорит сам. */
const REASON_CLASS: Partial<Record<StatusTone, string>> = {
  warning: styles.toneWarning,
  danger: styles.toneDanger,
};

export const SourceStatus: FC<{ source: ISourceRow }> = ({ source }) => {
  const view = sourceStateView(source);
  const reasonClass = REASON_CLASS[view.tone];
  const reason = reasonClass ? view.reason : null;
  const note = reason ? null : historyNote(source);
  const stats = sourceStatsLine(source);

  return (
    <div className={styles.status}>
      <div className={styles.statusHead}>
        <Badge tone={view.tone} className={styles.badge}>
          {view.label}
        </Badge>
        {note && (
          <span className={styles.note} title={note}>
            {note}
          </span>
        )}
      </div>
      {stats && (
        <span className={styles.stats} title={sourceStatsTitle(source)}>
          {stats}
        </span>
      )}
      {reason && (
        <span className={`${styles.reason} ${reasonClass}`} title={reason}>
          {reason}
        </span>
      )}
    </div>
  );
};
