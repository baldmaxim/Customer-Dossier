import { FC } from 'react';

import type { IStatement } from '../api/types';
import { AssertionDetail } from './AssertionDetail';
import { StatementQuotes } from './StatementQuotes';
import styles from './StatementList.module.css';

/**
 * «Откуда известно» у фразы сводки или строки участника: цитаты её сведений (и решение
 * оператора — у того, кому можно решать); без сведений — приложенные к фразе цитаты.
 */
export const StatementEvidence: FC<{ statement: IStatement; id?: string }> = ({ statement, id }) => (
  <div id={id} className={styles.evidence}>
    {statement.assertionIds.length > 0 ? (
      statement.assertionIds.map(assertionId => <AssertionDetail key={assertionId} assertionId={assertionId} showSummary={false} />)
    ) : (
      <StatementQuotes quotes={statement.quotes} />
    )}
  </div>
);
